---
title: Keyboard shortcuts
icon: zap
order: 40
---

Press <kbd>?</kbd> anywhere in Vertex Flow to pop this list up over whatever
you're doing.

## Go to — `g` then a key

Reveal or open a destination. If it's already open, `g` jumps to its tab rather
than opening a second one. `g` `a` / `g` `i` act on the **active workspace** —
each workspace has its own All Tasks and Untriaged tab, so you can keep both
workspaces' lists open side by side.

| Chord | Destination |
| --- | --- |
| `g` `a` | All Tasks |
| `g` `i` | Untriaged tasks |
| `g` `p` | Projects |
| `g` `d` | Dashboards |
| `g` `v` | Views |
| `g` `l` | Labels |
| `g` `m` | People |
| `g` `t` | Trash |
| `g` `h` | Help |
| `g` `s` | Settings |

## Create — `c` then a key

Always two keys — there is no bare-`c` action.

| Chord | Action |
| --- | --- |
| `c` `t` | New task |
| `c` `p` | New project |
| `c` `d` | New dashboard |
| `c` `v` | New blank view |
| `c` `w` | New workspace |

## On the focused task

The focused task is the one your keystrokes act on — move it with the arrow
keys or `j` / `k`.

| Key | Action |
| --- | --- |
| `↑` / `↓`, or `j` / `k` | Move focus |
| `←` / `→` | Move between board columns |
| Enter | Open the focused task |
| `o` | Open the raw Markdown note |
| `s` | Set status |
| `p` | Set priority |
| `l` | Toggle a label |
| `t` | Set task type |
| `⌘` / `Ctrl` + `Shift` + `↑` | Open parent task (or project) |
| `⌘` / `Ctrl` + `Shift` + `↓` | Open first sub-task |
| `x` | Add to selection |
| `⌘` / `Ctrl` + `a` | Select all |
| `e` | Archive / unarchive focused (or selected) |

## Everywhere

| Key | Action |
| --- | --- |
| `?` | Show this shortcut list |
| Esc | Clear focus (get out of a field so the shortcuts below work) |
| `Option` / `Alt` + `W` | Close the active tab |
| `Option` / `Alt` + `Shift` + `W` | Close every tab |
| Quick capture | Command palette → "Quick capture: new task" |

Esc never closes a tab — it only drops you out of whatever control is focused,
so the `g` / `c` chords, `j` / `k`, and `?` become live again. Closing a tab is
the deliberate `Option` + `W` (`Alt` + `W` on Windows/Linux). Closing the last
tab leaves the tab strip empty and shows a start pane — nothing is ever forcibly
kept open.

Every plugin action is also registered as an Obsidian command, so you can
rebind any of them from Obsidian's own Hotkeys settings.

## Switch tabs

The tab modifier reads as **`Option`** on macOS and **`Alt`** on Windows/Linux —
it's the same shortcut, just a different physical key per platform (both report
as the same modifier internally; `Cmd` on Mac / `Ctrl` on Windows are Obsidian's
own tab keys and are left alone).

**macOS** — hold **`Option`** and press **`Tab`** to open the switcher overlay;
each `Tab` press walks to the next tab, `Shift + Tab` walks back, and letting go
of `Option` jumps to the highlighted tab (`Esc` cancels). This is the same
hold-to-cycle flow as `Cmd` + `Tab` or Arc/Dia.

**Windows/Linux** — `Alt + Tab` is the OS window switcher and can't reach the
app, so the hold-to-cycle isn't available. Use the jumps below instead.

| Key | Action |
| --- | --- |
| `Option` / `Alt` + `Tab` (hold) | Cycle forward through open tabs (macOS only) |
| `Option` / `Alt` + `Shift` + `Tab` (hold) | Cycle backward (macOS only) |
| `Option` / `Alt` + `1` … `9` | Jump to the 1st … 9th tab |
| `Option` / `Alt` + `0` | Jump to the last tab |
| `Option` / `Alt` + `W` | Close the active tab |
| `Option` / `Alt` + `Shift` + `W` | Close every tab |

> These switch tabs **within Vertex Flow's strip**, not Obsidian's separate
> panes. Right-click a tab for **Close other tabs**, **Close tabs to the right**,
> and **Close all tabs**. Unlike the commands above, these key flows are
> view-scoped navigation (like the `j`/`k` view keys), so they aren't rebindable
> in Obsidian's Hotkeys settings.
