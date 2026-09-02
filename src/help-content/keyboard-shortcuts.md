---
title: Keyboard shortcuts
icon: zap
order: 40
---

Press <kbd>?</kbd> anywhere in Vertex Flow to open this shortcut reference without leaving your current work.

> [!info] Shortcut chords
> Shortcuts such as `g` `a`, `c` `t`, and `u` `p` are two-key chords. Press the
> first key, then complete the shortcut within one second. Pressing an unrelated
> key cancels the chord.

## Go to

Press `g`, then a destination key, to reveal or open a destination.

If that destination is already open, Vertex Flow switches to its existing tab rather than opening a duplicate. `g` `a` and `g` `i` use the **active workspace**: each workspace has its own All Tasks and Untriaged tabs, so you can keep equivalent lists from multiple workspaces open side by side.

| Shortcut | Destination |
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

## Create

Press `c`, then a key, to create something new. There is intentionally no standalone `c` action.

| Shortcut | Action |
| --- | --- |
| `c` `t` | Create a new task |
| `c` `p` | Create a new project |
| `c` `d` | Create a new dashboard |
| `c` `v` | Create a new blank view |
| `c` `w` | Create a new workspace |

## Focused task

The **focused task** is the task that receives keyboard actions. Move focus with the arrow keys, Vim-style navigation keys, or by clicking a task.

> [!tip] Focus and selection are different
> The focused task receives navigation and open actions. Selection is for acting
> on multiple tasks at once: press `x` to add or remove the focused task from
> the selection.

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` or `j` / `k` | Move focus up or down |
| `←` / `→` or `h` / `l` | Move between board columns |
| `Enter` | Open the focused task |
| `x` | Toggle the focused task in the selection |
| `⌘` / `Ctrl` + `a` | Select all visible tasks |
| `⌘` / `Ctrl` + `Shift` + `↑` | Open the parent task, or its project if it has no parent |
| `⌘` / `Ctrl` + `Shift` + `↓` | Open the first sub-task |

In a single-column List view, `←` / `→` and `h` / `l` do nothing because there are no board columns to move between.

## Update task fields

Press `u`, then a field key, to edit a task field. For example, press `u`, then `p` to set priority.

| Shortcut | Action |
| --- | --- |
| `u` `s` | Set status |
| `u` `p` | Set priority |
| `u` `t` | Set task type |
| `u` `l` | Toggle labels |
| `u` `a` | Assign or unassign a person |
| `u` `r` | Set or change the parent task |
| `u` `m` | Set project |
| `u` `e` | Set estimate |
| `u` `b` | Set start date |
| `u` `d` | Set due date |
| `u` `x` | Archive or unarchive the focused or selected tasks |

### Picker behavior

The status, priority, type, label, assignee, parent, and project shortcuts open a picker.

- Use the arrow keys to change the highlighted option.
- Press `Enter` to apply the highlighted option.
- Press `Esc`, or click outside the picker, to close it without making a change.
- Labels are toggled when chosen.
- The Labels picker includes type-ahead creation: enter a new label name, then press `Enter` to create and attach it.
- Choosing a parent beyond the supported nesting depth prompts for confirmation.

Estimate and date shortcuts open a compact input instead:

- Press `Enter` to save.
- Press `Esc` to discard the change.

### Updating multiple tasks

When more than one task is selected—using `x` or `⌘` / `Ctrl`-click—a `u` shortcut updates every selected task.

The following fields can be updated in bulk:

- Status
- Priority
- Task type
- Assignee
- Parent
- Project
- Estimate
- Start date
- Due date

When you choose a label, Vertex Flow adds it to every selected task that does not already have it.

`u` `x` replaces the previous standalone `e` archive shortcut. Archiving now follows the same task-update pattern as every other field edit, leaving `e` available for estimates.

## Everywhere

| Shortcut | Action |
| --- | --- |
| `?` | Open this shortcut reference |
| `Esc` | Clear the current control focus |
| `Option` / `Alt` + `W` | Close the active Vertex Flow tab |
| `Option` / `Alt` + `Shift` + `W` | Close all Vertex Flow tabs |
| Command Palette → **Quick capture: new task** | Quickly create a task from anywhere in Obsidian |

`Esc` does not close tabs. It clears focus from an input, picker, or other control so task-navigation shortcuts such as `g`, `c`, `j`, `k`, and `?` work again.

Closing a tab is always deliberate: use `Option` + `W` on macOS or `Alt` + `W` on Windows and Linux. If you close the final tab, Vertex Flow displays its start pane with an empty tab strip; no tab is forcibly kept open.

Vertex Flow actions are also registered as Obsidian commands. You can assign or change their hotkeys in Obsidian’s **Settings → Hotkeys**.

## Switch tabs

Vertex Flow uses **Option** on macOS and **Alt** on Windows and Linux for its internal tab-strip shortcuts. They represent the same modifier in the app, but use the conventional physical key for each platform.

These shortcuts affect tabs in **Vertex Flow’s own tab strip**, not Obsidian’s workspace panes or Obsidian’s native tab navigation.

### macOS

Hold `Option` and press `Tab` to open the tab switcher.

- Each additional `Tab` press moves to the next Vertex Flow tab.
- `Shift` + `Tab` moves backward.
- Release `Option` to activate the highlighted tab.
- Press `Esc` to cancel.

This is a hold-to-cycle interaction similar to the macOS application switcher and browser tab switchers such as Arc or Dia.

### Windows and Linux

> [!warning] `Alt` + `Tab` is unavailable on Windows and Linux
> Windows and Linux reserve `Alt` + `Tab` for the operating-system window
> switcher. Vertex Flow’s hold-to-cycle tab switcher is therefore available on
> macOS only. On Windows and Linux, use `Alt` + `1` through `9`, or `Alt` + `0`,
> to jump directly to a tab.

| Shortcut | Action |
| --- | --- |
| `Option` / `Alt` + `Tab` (hold) | Cycle forward through open tabs — macOS only |
| `Option` / `Alt` + `Shift` + `Tab` (hold) | Cycle backward through open tabs — macOS only |
| `Option` / `Alt` + `1` through `9` | Jump to the 1st through 9th tab |
| `Option` / `Alt` + `0` | Jump to the last tab |
| `Option` / `Alt` + `W` | Close the active tab |
| `Option` / `Alt` + `Shift` + `W` | Close all Vertex Flow tabs |

Right-click a tab for additional tab-management actions:

- **Close other tabs**
- **Close tabs to the right**
- **Close all tabs**

Unlike registered Obsidian commands, these tab-strip interactions are view-scoped navigation controls—similar to `j` and `k` task navigation—and are not configurable through Obsidian’s Hotkeys settings.
