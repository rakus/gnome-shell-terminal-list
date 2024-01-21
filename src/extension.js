/*
 * Terminal-List Gnome Shell Extension
 *
 * Copyright (c) 2021 Ralf Schandl
 *
 * Released under GNU General Public License v3. See file LICENSE.
 *
 */

"use strict";

import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// Uses the D-Bus interface SearchProvider2 of GNOME-Terminal.
// See: /usr/share/dbus-1/interfaces/org.gnome.ShellSearchProvider2.xml

// "Stolen" from https://github.com/tuberry/extension-list (GPLv3)
class PopupScrollMenuSection extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        // take max 90% of screen height
        const maxHeight = Math.floor(global.display.get_size()[1] * 90 / 100);
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
        const [, topNaturalHeight] = this._getTopMenu().actor.get_preferred_height(-1);
        const topMaxHeight = this.actor.get_theme_node().get_max_height();

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
}

/*
 * The panel button
 */
let TermListMenuButton = GObject.registerClass(
    class TermListMenuButton extends PanelMenu.Button {

        _init(settings) {
            super._init(0.5, "Terminal-List", false);

            this.icon = new St.Icon({
                icon_name: "utilities-terminal",
                style_class: "system-status-icon",
            });
            this.add_actor(this.icon);

            // register our own event handler
            this._my_events_sigid = this.connect("event", this._onEvent.bind(this));

            this._prepareMenu();

            this._settings = settings;

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
            const searchEntryItem = new PopupMenu.PopupBaseMenuItem({
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
                try {
                    const idList = await this._getTerminalUuids();

                    let meta = [];
                    if(idList.length > 0) {
                        meta = await this._getTermTabsMetadata(idList);
                    }

                    this._createTermTabsMenu(meta);

                    // clear text of search box
                    this._searchEntry.set_text("");

                    this.menu.open();

                    // set focus to search box
                    global.stage.set_key_focus(this._searchEntry);

                } catch(e) {
                    console.log("Terminal-List: Error opening Terminal-List menu: " + String(e));
                    Main.notify("Error opening Terminal-List menu", String(e));
                }

            } else {
                this.menu.close();
            }
        }

        /*
         * Gets the terminal tab UUIDs.
         *
         * returns: Array of terminal tab UUIDs
         */
        async _getTerminalUuids() {
            try {
                // SearchTerm is an empty array, will match all tabs
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

                return idList;

            } catch(e) {
                console.log("Terminal-List: Error getting Terminal List Ids: " + String(e));
                Main.notify("Error getting Terminal List", String(e));
                return [];
            }
        }

        /*
         * Called with the uuids of all tabs and requests the meta data for
         * them.
         *
         * ids: Array of terminal tab UUIDs
         * returns: Array of { title: '...', id: '...' }
         */
        async _getTermTabsMetadata(ids) {

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

                const metaData = value.deepUnpack();

                let result = [];
                for(let i = 0; i < metaData.length; i++) {
                    const name = metaData[i]["name"].unpack();
                    const id = metaData[i]["id"].unpack();
                    result.push({ title: name, id: id });
                }

                return result;
            } catch(e) {
                console.log("Terminal-List: Error getting Terminal List MetaData: " + String(e));
                Main.notify("Error getting Terminal MetaData", String(e));
                return [];
            }
        }

        /*
         * Called with the meta information for all tabs and creates menue
         * entries for it. Finally open the menu.
         *
         * metaData: Array of { title: '...', id: '...' }
         * returns: void
         */
        _createTermTabsMenu(metaData) {
            this._terminalsSubMenu.removeAll();

            for(let i = 0; i < metaData.length; i++) {
                const name = metaData[i].title;
                const id = metaData[i].id;
                this._terminalsSubMenu.addAction(name,
                    this._switch2Terminal.bind(this, id), undefined);
            }
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
                console.log("Terminal-List: Error switching to terminal tab:  " + String(e));
                Main.notify("Error switching to terminal tab", String(e));
            }
        }

        /*
         * Event handler for text change in search entry field. Filters the
         * menu content by setting the visibilty of items.
         */
        _onSearchText() {
            const searchText = this._searchEntry.get_text().toLowerCase();

            /*
             * Using private method PopupMenuBase._getMenuItems ... this is fragile
             */
            if(searchText === "") {
                this._terminalsSubMenu._getMenuItems().forEach(item => {
                    item.actor.visible = true;
                });
            } else {
                const regex = this._glob2regex(searchText);
                this._terminalsSubMenu._getMenuItems().forEach(item => {
                    const text = item.label.get_text().toLowerCase();
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
            const key = event.get_key_symbol();
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
            const itemArray = this._terminalsSubMenu._getMenuItems();
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


export default class TerminalList extends Extension {

    enable() {
        console.log("Terminal-List: enable() [Version: " + this.metadata.version + "]");

        this.termListMenu = new TermListMenuButton(this.getSettings());

        const settings = this.getSettings();

        const location = settings.get_string("panel-location");
        if(location === "far-left") {
            // place it on the far-left side
            Main.panel.addToStatusArea("Terminal-List", this.termListMenu, 0, "left");
        } else if(location === "left") {
            // place it on the left side -- left of the application menu
            // If application menu is not available, rightmost on the left.
            const appMenuIndex = Main.sessionMode.panel.left.indexOf("appMenu");
            Main.panel.addToStatusArea("Terminal-List", this.termListMenu, appMenuIndex, "left");
        } else {
            Main.panel.addToStatusArea("Terminal-List", this.termListMenu);
        }
    }

    disable() {
        console.log("Terminal-List: disable()");
        this.termListMenu.stop();
        // destroy removes button from panel
        this.termListMenu.destroy();
    }
}

/* vim: set et ts=4 sw=4: */
