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
| `g` `v` | Views |
| `g` `d` | Dashboards |
| `g` `p` | Projects |
| `g` `l` | Labels |
| `g` `m` | People |
| `g` `r` | Recurring |
| `g` `e` | Activity History |
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

## Switch layout

Press `v`, then a layout key, to change how the current view is displayed.

| Shortcut | Action |
| --- | --- |
| `v` `l` | List layout |
| `v` `b` | Board layout |
| `v` `t` | Timeline layout |
| `v` `c` | Calendar layout |
| `v` `d` | Canvas layout (dependency DAG) |

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

In a single-column List layout, `←` / `→` and `h` / `l` do nothing because there are no board columns to move between.

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
| `u` `n` | Rename the task |
| `u` `x` | Archive or unarchive the focused or selected tasks |

In a List or Board layout, `u` `n` opens a compact rename input over the focused row — even with several tasks selected, it renames only the focused one (a shared title isn't a meaningful bulk edit).

In an open task tab, the title, description and comments are already on screen, so these three move the cursor straight to them instead of opening anything:

| Shortcut | Action |
| --- | --- |
| `u` `n` | Focus the title field |
| `u` `i` | Jump to the description editor (expanding it first if collapsed) |
| `u` `c` | Jump to the new-comment box |

### Picker behavior

The status, priority, type, label, assignee, parent, and project shortcuts open a picker.

- Type to filter the options.
- Use the arrow keys to change the highlighted option.
- Press `Enter` to apply the highlighted option.
- Press `Esc`, or click outside the picker, to close it without making a change.
- Labels are toggled when chosen.
- The Labels picker's search box also creates: when the text you type doesn't match an existing label, a "Create …" row appears — highlight it and press `Enter` (or click it) to create and attach that label.
- Choosing a parent beyond the supported nesting depth prompts for confirmation.

Estimate, date, and rename (`u` `n`) shortcuts open a compact input instead:

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

## Workspace search

Press `Option` + `K` (macOS) or `Alt` + `K` (Windows/Linux) from anywhere to open the global **Workspace Search** launcher[cite: 1, 3].

| Shortcut | Action |
| --- | --- |
| `Option` / `Alt` + `K` | Open workspace search overlay (Tasks, Projects, Views, Dashboards, Labels, People, Actions)[cite: 1] |
| `↑` / `↓` or `Option` / `Alt` + `j` / `k` | Navigate search results[cite: 1] |
| `Enter` | Open selected item or execute quick action[cite: 1] |
| `Esc` | Close search overlay[cite: 1] |

## Draft management

When editing filters, group settings, or widget layouts on Views, Dashboards, Projects, and System views, edits are held in a transient draft state[cite: 1, 3]. Use these shortcuts to save or discard in-memory edits[cite: 1]:

| Shortcut | Action |
| --- | --- |
| `Option` / `Alt` + `S` | Save draft changes (when view or dashboard is modified)[cite: 1] |
| `Option` / `Alt` + `Shift` + `S` | Save As… (clone current view/dashboard or save active filters as a new Saved View)[cite: 1] |
| `Option` / `Alt` + `R` | Reset / discard unsaved draft edits[cite: 1] |

## Browse screens

On the **Projects**, **Labels**, **People**, **Dashboards**, and **Views** hub screens:

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` or `j` / `k` | Move focus between cards (wraps at either end) |
| `Enter` / `Space` | Open the focused card |

## Everywhere

| Shortcut | Action |
| --- | --- |
| `?` | Open this shortcut reference |
| `Esc` | Clear the current control focus |
| `Option` / `Alt` + `K` | Open workspace search overlay[cite: 1, 3] |
| `Option` / `Alt` + `W` | Close the active Vertex Flow tab |
| `Option` / `Alt` + `Shift` + `W` | Close every other Vertex Flow tab, keeping the active one |
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
| `Option` / `Alt` + `Shift` + `W` | Close every other tab, keeping the active one |

Right-click a tab for additional tab-management actions:

- **Close other tabs**
- **Close tabs to the right**
- **Close tabs to the left**
- **Close all tabs**

Unlike registered Obsidian commands, these tab-strip interactions are view-scoped navigation controls—similar to `j` and `k` task navigation—and are not configurable through Obsidian’s Hotkeys settings.
