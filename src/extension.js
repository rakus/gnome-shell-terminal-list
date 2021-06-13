
/* Note to eslint: */
/* exported enable, disable */

"use strict";

const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Clutter = imports.gi.Clutter;
const PopupMenu = imports.ui.popupMenu;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const ExtensionUtils = imports.misc.extensionUtils;
const MySelf = ExtensionUtils.getCurrentExtension();

// The D-Bus interface of SearchProvider2 implemented by Gnome-Terminal
// as XML
const SearchProvider2Interface = '<node>\
  <interface name="org.gnome.Shell.SearchProvider2"> \
    <method name="GetInitialResultSet"> \
      <arg type="as" name="terms" direction="in"/> \
      <arg type="as" name="results" direction="out"/> \
    </method> \
    <method name="GetSubsearchResultSet"> \
      <arg type="as" name="previous_results" direction="in"/> \
      <arg type="as" name="terms" direction="in"/> \
      <arg type="as" name="results" direction="out"/> \
    </method> \
    <method name="GetResultMetas"> \
      <arg type="as" name="identifiers" direction="in"/> \
      <arg type="aa{sv}" name="metas" direction="out"/> \
    </method> \
    <method name="ActivateResult"> \
      <arg type="s" name="identifier" direction="in"/> \
      <arg type="as" name="terms" direction="in"/> \
      <arg type="u" name="timestamp" direction="in"/> \
    </method> \
    <method name="LaunchSearch"> \
      <arg type="as" name="terms" direction="in"/> \
      <arg type="u" name="timestamp" direction="in"/> \
    </method> \
  </interface> \
</node>';

// Declare the proxy class based on the interface
const SearchProvider2Proxy = Gio.DBusProxy.makeProxyWrapper(SearchProvider2Interface);


/*
 * The panel button
 */
let TermListMenuButton = GObject.registerClass(
    class TermListMenuButton extends PanelMenu.Button {

        _init() {
            super._init(0.5, "TermList", false);

            this.icon = new St.Icon({
                icon_name: "utilities-terminal",
                style_class: "system-status-icon",
            });
            this.add_actor(this.icon);

            // register our own event handler
            this._my_events_sigid = this.connect("event", this._onEvent.bind(this));

            this._prepareMenu();

            // Get instance of the search provider proxy
            this.spProxy = new SearchProvider2Proxy(
                Gio.DBus.session,
                "org.gnome.Terminal",
                "/org/gnome/Terminal/SearchProvider",
            );

            this._settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.term-list");

            Main.wm.addKeybinding("toggle-term-list", this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
                this._toggleMenu.bind(this));
        }

        _prepareMenu() {

            // the search entry field
            this._searchEntry = new St.Entry({
                name: "searchEntry",
                style_class: "search-entry",
                can_focus: true,
                hint_text: "Type here to search...",
                track_hover: true,
                x_expand: true,
                y_expand: true,
            });

            // connect entry field text change event to search method
            this._searchEntry.get_clutter_text().connect(
                "text-changed",
                this._onSearchText.bind(this));

            // create menu entry for search entry field
            let searchEntryItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });
            searchEntryItem.add(this._searchEntry);

            // add search entry to menu
            this.menu.addMenuItem(searchEntryItem);

            // Terminals in a submenu. Only this way we might get a scrollbar when needed
            this._terminalsSubMenu = new PopupMenu.PopupSubMenuMenuItem("Terminals", false);
            this.menu.addMenuItem(this._terminalsSubMenu);
        }

        /*
         * Event handler - on button open menu.
         */
        _onEvent(actor, event) {
            if(event.type() === Clutter.EventType.BUTTON_PRESS) {
                this._toggleMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        _toggleMenu() {

            if(!this.menu.isOpen) {
                // Get all terminal tabs by searching for 'nothing' which matches
                // everything
                this.spProxy.GetInitialResultSetRemote([], (result, error) => {
                    this._getInitialResultSetResult(result, error);
                });
            } else {
                this.menu.close();
            }

        }

        /*
         * Receives the uuids of all tabs.
         */
        _getInitialResultSetResult(results, error) {

            if(error) {
                if(!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    log("Term-List: Error getting Terminal List Ids: " + String(error));
                    Main.notify("Error getting Terminal List", String(error));
                }
                return;
            }

            let ids = results[0];

            // Get meta information for all tabs
            this.spProxy.GetResultMetasRemote(ids, (metaResults, metaError) => {
                this._getResultMetasResult(metaResults, metaError);
            });
        }

        /*
         * Receives the meta information for all tabs and creates
         * menue entries for it. Finally the menu is opened.
         */
        _getResultMetasResult(results, error) {

            if(error) {
                if(!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    log("Term-List: Error getting Terminal List Meta: " + String(error));
                    Main.notify("Error getting Terminal List", String(error));
                }
                return;
            }

            this._terminalsSubMenu.menu.removeAll();
            this._searchEntry.set_text("");

            let metas = results[0];
            for(let i = 0; i < metas.length; i++) {
                for(let prop in metas[i]) {
                    // All but the icon need unpacking
                    if(prop !== "icon") {
                        metas[i][prop] = metas[i][prop].deep_unpack();
                    }
                }

                this._terminalsSubMenu.menu.addAction(metas[i]["name"], this._switch2Terminal.bind(this, metas[i]["id"]), undefined);
            }

            this.menu.open();
            this._terminalsSubMenu.menu.open(false);

            // set focus to search box
            global.stage.set_key_focus(this._searchEntry);
        }

        /*
         * Called with the id of a gnome terminal tab and activates it. This
         * may include changing virtual desktop, bringing window to front and
         * changing tab.
         */
        _switch2Terminal(termId) {
            this.spProxy.ActivateResultSync(termId, [], global.get_current_time());
        }

        /*
         * Event handler for text change in search entry field.
         */
        _onSearchText() {
            // this only makes sense when the menu is open
            this._terminalsSubMenu.menu.open(false);

            let searchText = this._searchEntry.get_text().toLowerCase();

            /*
             * Using private method PopupMenuBase._getMenuItems ... this is fragile
             */
            if(searchText === "") {
                this._terminalsSubMenu.menu._getMenuItems().forEach(item => {
                    item.actor.visible = true;
                });
            } else {
                let regex = this._glob2regex(searchText);
                this._terminalsSubMenu.menu._getMenuItems().forEach(item => {
                    let text = item.label.get_text().toLowerCase();
                    item.actor.visible = text.search(regex) >= 0;
                });
            }
        }

        _glob2regex(glob) {
            let reStr = "";
            for(var i = 0; i < glob.length; i++) {
                let c = glob[i];
                if(c === "*") {
                    reStr += ".*";
                } else {
                    if(c === "\\" && i < (glob.length - 1)) {
                        c = glob[++i];
                    }
                    reStr += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                }
            }

            return new RegExp(reStr);
        }


        /*
         * Stop. Clean the menu.
         */
        stop() {

            Main.wm.removeKeybinding("toggle-term-list");

            if(this._my_events_sigid !== 0) {
                this.disconnect(this._my_events_sigid);
                this._my_events_sigid = 0;
            }
            this.menu.removeAll();
        }
    });


let termListMenu;

function enable() {
    let version = MySelf.metadata.version + "." + MySelf.metadata.minor_version;
    log("Term-List: enable() [Version: " + version + "]");

    termListMenu = new TermListMenuButton();
    Main.panel.addToStatusArea("Term-List", termListMenu);
}

function disable() {
    termListMenu.stop();
    // destroy removes button from panel
    termListMenu.destroy();
}

/* vim: set et ts=4 sw=4: */
