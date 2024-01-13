/*
 * Term-List Gnome Shell Extension
 *
 * Copyright (c) 2021 Ralf Schandl
 *
 * Released under GNU General Public License v3. See file LICENSE.
 *
 */

/* Note to eslint: */
/* exported enable, disable */

"use strict";

const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Clutter = imports.gi.Clutter;
const PopupMenu = imports.ui.popupMenu;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const ExtensionUtils = imports.misc.extensionUtils;
const MySelf = ExtensionUtils.getCurrentExtension();

// Definition of  D-Bus interface of SearchProvider2 implemented by
// Gnome-Terminal:
// <node>
//   <interface name="org.gnome.Shell.SearchProvider2">
//     <method name="GetInitialResultSet">
//       <arg type="as" name="terms" direction="in"/>
//       <arg type="as" name="results" direction="out"/>
//     </method>
//     <method name="GetSubsearchResultSet">
//       <arg type="as" name="previous_results" direction="in"/>
//       <arg type="as" name="terms" direction="in"/>
//       <arg type="as" name="results" direction="out"/>
//     </method>
//     <method name="GetResultMetas">
//       <arg type="as" name="identifiers" direction="in"/>
//       <arg type="aa{sv}" name="metas" direction="out"/>
//     </method>
//     <method name="ActivateResult">
//       <arg type="s" name="identifier" direction="in"/>
//       <arg type="as" name="terms" direction="in"/>
//       <arg type="u" name="timestamp" direction="in"/>
//     </method>
//     <method name="LaunchSearch">
//       <arg type="as" name="terms" direction="in"/>
//       <arg type="u" name="timestamp" direction="in"/>
//     </method>
//   </interface>
// </node>

// "Stolen" from https://github.com/tuberry/extension-list (GPLv3)
const PopupScrollMenuSection = class extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        // take max 90% of screen height
        let maxHeight = Math.floor(global.display.get_size()[1] * 90 / 100);
        this.actor = new St.ScrollView({
            style: "max-height: %dpx".format(maxHeight),
            style_class: "extension-list-scroll-menu",
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            clip_to_allocation: true,
        });

        this.actor.add_actor(this.box);
        this.actor._delegate = this;
    }

    _needsScrollbar() {
        let [, topNaturalHeight] = this._getTopMenu().actor.get_preferred_height(-1);
        let topMaxHeight = this.actor.get_theme_node().get_max_height();

        return topMaxHeight >= 0 && topNaturalHeight >= topMaxHeight;
    }

    open() {
        if(this._needsScrollbar()) {
            this.actor.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            this.actor.add_style_pseudo_class("scrolled");
        } else {
            this.actor.vscrollbar_policy = St.PolicyType.NEVER;
            this.actor.remove_style_pseudo_class("scrolled");
        }

        super.open();
    }
};

/*
 * The panel button
 */
let TermListMenuButton = GObject.registerClass(
    class TermListMenuButton extends PanelMenu.Button {

        _init() {
            super._init(0.5, "Term-List", false);

            this.icon = new St.Icon({
                icon_name: "utilities-terminal",
                style_class: "system-status-icon",
            });
            this.add_actor(this.icon);

            // register our own event handler
            this._my_events_sigid = this.connect("event", this._onEvent.bind(this));

            this._prepareMenu();

            this._settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.term-list");

            Main.wm.addKeybinding("toggle-term-list", this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                this._toggleMenu.bind(this));
        }

        _prepareMenu() {

            // the search entry field
            this._searchEntry = new St.Entry({
                name: "searchEntry",
                style_class: "search-entry",
                can_focus: true,
                hint_text: "Type here to filter...",
                track_hover: true,
                x_expand: true,
                y_expand: true,
            });

            // connect entry field text change event to search method
            this._searchEntry.get_clutter_text().connect(
                "text-changed",
                this._onSearchText.bind(this));

            // connect entry field <ENTER>
            this._searchEntry.get_clutter_text().connect(
                "activate",
                this._focusFirstItem.bind(this));

            // entry field handler for special keys (Up, Down, Tab)
            this._searchEntry.get_clutter_text().connect(
                "key-press-event",
                this._onSearchFieldKeyEvent.bind(this));

            this._searchEntry.get_clutter_text().connect(
                "key-focus-out",
                this._onSearchFocusOut.bind(this));

            this._searchEntry.get_clutter_text().connect(
                "key-focus-in",
                this._onSearchFocusIn.bind(this));

            // create menu entry for search entry field
            let searchEntryItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });
            searchEntryItem.add(this._searchEntry);

            // add search entry to menu
            this.menu.addMenuItem(searchEntryItem);

            // Terminals in scrollable menu section. Scrollbar if needed.
            this._terminalsSubMenu = new PopupScrollMenuSection();
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

        /*
         * Open menue if it's close - Close it if it's open.
         */
        async _toggleMenu() {

            if(!this.menu.isOpen) {
                // Get all terminal tabs by searching for 'nothing' which
                // matches everything

                try {
                    // SearchTerm is an empty array
                    const searchTerm = new GLib.Variant("(as)", [[]]);

                    const reply = await Gio.DBus.session.call(
                        "org.gnome.Terminal",
                        "/org/gnome/Terminal/SearchProvider",
                        "org.gnome.Shell.SearchProvider2",
                        "GetInitialResultSet",
                        searchTerm,
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null);

                    const value = reply.get_child_value(0);
                    const idList = value.deepUnpack();
                    if(idList.length > 0) {
                        this._requestTermTabsMetadata(idList);
                    } else {
                        // open empty menu
                        this._createTermTabsMenu([]);
                    }

                } catch(e) {
                    log("Term-List: Error getting Terminal List Ids: " + String(e));
                    Main.notify("Error getting Terminal List", String(e));
                }
            } else {
                this.menu.close();
            }
        }

        /*
         * Called with the uuids of all tabs and requests the meta data for
         * them.
         */
        async _requestTermTabsMetadata(ids) {

            try {
                const idsVariant = new GLib.Variant("(as)", [ids]);

                const reply = await Gio.DBus.session.call(
                    "org.gnome.Terminal",
                    "/org/gnome/Terminal/SearchProvider",
                    "org.gnome.Shell.SearchProvider2",
                    "GetResultMetas",
                    idsVariant,
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null);

                const value = reply.get_child_value(0);

                this._createTermTabsMenu(value.deepUnpack());

            } catch(e) {
                log("Term-List: Error getting Terminal List MetaData: " + String(e));
                Main.notify("Error getting Terminal MetaData", String(e));
            }
        }

        /*
         * Called with the meta information for all tabs and creates menue
         * entries for it. Finally open the menu.
         */
        _createTermTabsMenu(metaData) {
            this._terminalsSubMenu.removeAll();
            this._searchEntry.set_text("");

            for(let i = 0; i < metaData.length; i++) {
                let name = metaData[i]["name"].unpack();
                let id = metaData[i]["id"].unpack();
                this._terminalsSubMenu.addAction(name,
                    this._switch2Terminal.bind(this, id), undefined);
            }

            this.menu.open();

            // set focus to search box
            global.stage.set_key_focus(this._searchEntry);
        }

        /*
         * Called with the id of a gnome terminal tab and activates it. This
         * may include changing virtual desktop, bringing window to front and
         * changing tab.
         */
        async _switch2Terminal(termId) {
            try {
                const idVariant = new GLib.Variant("(sasu)", [termId, [], global.get_current_time()]);

                await Gio.DBus.session.call(
                    "org.gnome.Terminal",
                    "/org/gnome/Terminal/SearchProvider",
                    "org.gnome.Shell.SearchProvider2",
                    "ActivateResult",
                    idVariant,
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null);
            } catch(e) {
                log("Term-List: Error switching to terminal tab:  " + String(e));
                Main.notify("Error switching to terminal tab", String(e));
            }
        }

        /*
         * Event handler for text change in search entry field. Filters the
         * menu content by setting the visibilty of items.
         */
        _onSearchText() {
            let searchText = this._searchEntry.get_text().toLowerCase();

            /*
             * Using private method PopupMenuBase._getMenuItems ... this is fragile
             */
            if(searchText === "") {
                this._terminalsSubMenu._getMenuItems().forEach(item => {
                    item.actor.visible = true;
                });
            } else {
                let regex = this._glob2regex(searchText);
                this._terminalsSubMenu._getMenuItems().forEach(item => {
                    let text = item.label.get_text().toLowerCase();
                    item.actor.visible = text.search(regex) >= 0;
                });
            }
        }

        /*
         * Filter string to regex. Only supports wildcard '*'.
         */
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
         * Pressing Down, Up, Tab or Shift-Tab in search box leaves search box.
         */
        _onSearchFieldKeyEvent(actor, event) {
            let key = event.get_key_symbol();
            if(key === Clutter.KEY_Down || key === Clutter.KEY_Tab) {
                this._focusFirstItem();
                return Clutter.EVENT_STOP;
            } else if(key === Clutter.KEY_Up || key === Clutter.KEY_ISO_Left_Tab) {
                this._focusLastItem();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }


        /*
         * While the search input field has focus, the menu items are not
         * allowed to focus.
         * Prevents moving the focus from the input field if the mouse is on
         * the menu.
         */
        _onSearchFocusIn() {
            this._terminalsSubMenu._getMenuItems().forEach(entry => {
                entry.can_focus = false;
            });
        }

        /*
         * Leaving the search input field, the menu items should now be
         * focusable again.
         * Needed to allow navigation with up/down arrow.
         */
        _onSearchFocusOut() {
            this._terminalsSubMenu._getMenuItems().forEach(entry => {
                entry.can_focus = true;
            });
        }

        /*
         * Focus on first visible entry from the menu.
         */
        _focusFirstItem() {
            for(const item of this._terminalsSubMenu._getMenuItems()) {
                if(item.visible) {
                    item.actor.grab_key_focus();
                    break;
                }
            }
        }

        /*
         * Focus on last visible entry from the menu
         */
        _focusLastItem() {
            let itemArray = this._terminalsSubMenu._getMenuItems();
            if(itemArray.length > 0) {
                for(var i = itemArray.length - 1;  i >= 0;  i--) {
                    if(itemArray[i].visible) {
                        itemArray[i].actor.grab_key_focus();
                        break;
                    }
                }
            }
        }

        /*
         * Stop. Remove registered key bindings and event handler.
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

    let settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.term-list");

    let location = settings.get_string("panel-location");
    if(location === "far-left") {
        // place it on the far-left side
        Main.panel.addToStatusArea("Term-List", termListMenu, 0, "left");
    } else if(location === "left") {
        // place it on the left side -- left of the application menu
        // If application menu is not available, rightmost on the left.
        let appMenuIndex = Main.sessionMode.panel.left.indexOf("appMenu");
        Main.panel.addToStatusArea("Term-List", termListMenu, appMenuIndex, "left");
    } else {
        Main.panel.addToStatusArea("Term-List", termListMenu);
    }
}

function disable() {
    termListMenu.stop();
    // destroy removes button from panel
    termListMenu.destroy();
}

/* vim: set et ts=4 sw=4: */
