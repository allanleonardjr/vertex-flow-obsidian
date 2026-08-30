---
title: Keyboard shortcuts
icon: zap
order: 40
---

# Keyboard shortcuts

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
| Esc | Close the active tab |
| `Shift` + Esc | Close every task tab |
| Quick capture | Command palette → "Quick capture: new task" |

Closing the last tab leaves the tab strip empty and shows a start pane — nothing
is ever forcibly kept open.

Every plugin action is also registered as an Obsidian command, so you can
rebind any of them from Obsidian's own Hotkeys settings.
