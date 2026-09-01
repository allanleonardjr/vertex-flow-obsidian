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
keys, vim-style `j` / `k` / `h` / `l`, or click.

| Key | Action |
| --- | --- |
| `↑` / `↓`, or `j` / `k` | Move focus up / down |
| `←` / `→`, or `h` / `l` | Move between board columns |
| Enter | Open the focused task |
| `o` | Open the raw Markdown note |
| `x` | Add to selection (toggle) |
| `⌘` / `Ctrl` + `a` | Select all |
| `⌘` / `Ctrl` + `Shift` + `↑` | Open parent task (or project) |
| `⌘` / `Ctrl` + `Shift` + `↓` | Open first sub-task |

In a one-column List view the `←` / `→` / `h` / `l` keys are no-ops — there's
nothing to move across, exactly as before.

## Update a field — `u` then a key

Editing a task's fields is a two-key chord spelled with a bare `u` followed by
the field's letter — same grammar as the `g` / `c` chords: press `u`, then the
field key, with up to a second between them. `u` `u` re-arms rather than
resolving, and any other key cancels the chord.

The taxonomy pickers used to sit on bare `s` / `p` / `l` / `t`; moving them
under `u` freed those letters for navigation (`l` is now board-column-right).

| Key | Action |
| --- | --- |
| `u` `s` | Set status |
| `u` `p` | Set priority |
| `u` `t` | Set task type |
| `u` `l` | Toggle labels |
| `u` `a` | Assign someone (or unassign) |
| `u` `r` | Set parent (re-parent) |
| `u` `m` | Set project |
| `u` `e` | Set estimate |
| `u` `b` | Set start date |
| `u` `d` | Set due date |
| `u` `x` | Archive / unarchive the focused (or selected) tasks |

The `s` / `p` / `t` / `l` / `a` / `r` / `m` pickers show a candidate list —
arrow keys move the highlight, Enter picks, Esc or clicking away closes. Labels
toggle on pick. Picking a parent past a comfortable nesting depth asks for
confirmation first. The `e` / `b` / `d` pickers open a small input field
instead: **Enter** saves, **Esc** closes without changing.

`u` `x` took over from the old bare-`e` archive shortcut — archiving is a field
edit too now, and `e` is released. As with `g` / `c`, these stay live only
while a task view is the active tab.

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
