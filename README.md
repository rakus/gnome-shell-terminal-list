
# Gnome Shell Extension Terminal-List

Adds a panel button with a menu that lists the open GNOME-Terminal tabs with
their title. The button is located on the far left, even left of "Activities".

## Menu

The menu is opened on click or with the shortcut `<Ctrl><Super>T`. It starts
with an input field to filter the entries. The search is case insensitive and
supports the wildcard `*` to match any string (including an empty one).

The Terminals are listed in the following sub-menu in no particular order. A
sub-menu is used, so that it is rendered with a scroll bar if a lot of
terminals are open.

The shortcut to open the menu can be configured via `gsettings`. To reconfigure
it to `<Ctrl><Super>W` do:
```
gsettings  \
    --schemadir ~/.local/share/gnome-shell/extensions/term-list@r3s6.de/schemas \
    set org.gnome.shell.extensions.term-list toggle-term-list "['<Ctrl><Super>W']"
```

## Restrictions

Only the title of the GNOME-Terminal tab is available. No information which
tabs are together in the same window. Let alone on which virtual desktop they
are displayed.

So: No sorting by window or virtual desktop.

I'm __not__ actively searching for a solution, but if someone wants to provides
a patch I would be interested.

## Installing

Independent of the method used to install the extension, GNOME-Shell has to be
restarted afterwards.  If you using X11 just hit `<ALT>F2` and enter `r`. If
you are using Wayland you need to log out and in again.

After the restart the extension can be enabled with
```
gnome-extensions enable term-list@r3s6.de
```

Both of the following methods install the extension locally in the directory
`~/.local/share/gnome-shell/extensions/term-list@r3s6.de`.

### From Source
Get the source and then just run `make install`.

BTW: Call `make help` for all possible make targets.

### From Zip

Just execute
```
gnome-extensions install term-list-v{version}.zip
```

If it was installed before and you want to update, use
```
gnome-extensions install --force term-list-v{version}.zip
```

## How does it work?

The extensions gathers the terminal tab titles by (ab)using the D-Bus interface
`org.gnome.Shell.SearchProvider2` implemented by GNOME-Terminal.

The search is called with an empty String, so all terminals are matched. This
is a two step process. First the UUIDs of the matched terminals are fetched,
then the meta-data for the UUIDs are queried.

On the shell this would be:

```
dbus-send --session --dest=org.gnome.Terminal --print-reply=literal \
    /org/gnome/Terminal/SearchProvider \
    org.gnome.Shell.SearchProvider2.GetInitialResultSet \
    array:string:""

dbus-send --session --dest=org.gnome.Terminal  --print-reply=literal \
    /org/gnome/Terminal/SearchProvider \
    org.gnome.Shell.SearchProvider2.GetResultMetas \
    array:string:<UUID1>,<UUID2>,...
```

