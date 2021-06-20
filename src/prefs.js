
/* Note to eslint: */
/* exported init, buildPrefsWidget */

const ExtensionUtils = imports.misc.extensionUtils;
const Self = ExtensionUtils.getCurrentExtension();
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

const PREF_PANEL_LOCATION = "panel-location";
const PREF_MENU_SHORTCUT = "toggle-term-list";

const TermListPrefsWidget = GObject.registerClass({
    GTypeName: "TermListPrefsWidget",
    Template: Self.dir.get_child("preferences.ui").get_uri(),
    InternalChildren: [
        "panel_location",
        "toggle_term_list",
        "treeview",
    ],
}, class TermListPrefsWidget extends Gtk.Box {

    _init(params = {}) {
        super._init(params);
        this._settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.term-list");

        const panelLocation = this._widget(PREF_PANEL_LOCATION);
        panelLocation.set_active(this._settings.get_enum(PREF_PANEL_LOCATION));
        panelLocation.connect("changed", combobox => {
            this._settings.set_enum(PREF_PANEL_LOCATION, combobox.get_active());
        });

        this._bindShortcut();
    }

    _widget(id) {
        const name = "_" + id.replace(/-/g, "_");
        if(!this[name]) {
            throw new Error(`Unknown widget with ID "${id}"!`);
        }

        return this[name];
    }

    _bindShortcut() {

        let [accelKey, accelMods] = [0, 0];
        let accel = this._settings.get_strv(PREF_MENU_SHORTCUT)[0];
        if(accel) {
            let ok;
            [ok, accelKey, accelMods] = Gtk.accelerator_parse(accel);
            if(!ok) {
                [accelKey, accelMods] = [0, 0];
            }
        }

        // The model for the treeview
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_INT, GObject.TYPE_INT]);
        const row = model.insert(0);
        model.set(row, [0, 1], [accelMods, accelKey]);

        // Set model on treeview
        this._widget("treeview").set_model(model);

        let widget = this._widget(PREF_MENU_SHORTCUT);
        widget.accel_mode = Gtk.CellRendererAccelMode.GTK;

        // to be used in lamdas
        let settings = this._settings;

        widget.connect("accel-edited", (rend, iter, newKey, newMods) => {
            let value = Gtk.accelerator_name(newKey, newMods);
            let [ok, theRow] = model.get_iter_from_string(iter);
            if(!ok) {
                throw new Error("Error setting shortcut");
            }

            model.set(theRow, [0, 1], [newMods, newKey]);
            if(newKey !== 0) {
                settings.set_strv(PREF_MENU_SHORTCUT, [value]);
            }
        });
        widget.connect("accel-cleared", (unused_rend, iter) => {
            let [ok, theRow] = model.get_iter_from_string(iter);
            if(!ok) {
                throw new Error("Error clearing shortcut");
            }

            model.set(theRow, [0, 1], [0, 0]);
            settings.set_strv(PREF_MENU_SHORTCUT, []);
        });
    }

});

/*
 * Initialize - does nothing.
 */
function init() {
    // Nothing to do
}

function buildPrefsWidget() {
    return new TermListPrefsWidget();
}

