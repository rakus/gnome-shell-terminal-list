
# Gnome Shell Extension Terminal-List

Adds a panel button with a menu that lists the open GNOME-Terminal tabs with
their title.

## Menu

The menu is opened on click. It starts with an input field to filter the
entries. The search string supports `*` to match any string (including an empty
one).  Other globbing chars are not supported. The search is case insensitive.

The Terminals are listed in the following sub-menu in no particular order. A
sub-menu is used, so that it is rendered with a scroll bar if a lot of
terminals are open.

The menu can also be opened/closed with the shortcut `<Ctrl><Super>T`.
To change the shortcut use `gsettings` like this:
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

Get the source and then just run `make install`. This will install the
extension to your home directory below `.local/share/gnome-shell/extensions`.

BTW: Call `make help` for all possible make targets.

After that you need to restart GNOME Shell. If you using X11 just hit `<ALT>F2`
and enter `r`. If you are using Wayland you need to log out and in again.

## How does it work?

The extensions gathers the terminal tab titles by (ab-)using the dbus interface
`org.gnome.Shell.SearchProvider2`. GNOME-Terminal implements this.

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

