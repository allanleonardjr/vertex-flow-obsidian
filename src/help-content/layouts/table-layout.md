---
title: Table layout
order: 25
---

The Table layout is a dense, spreadsheet-style grid: one row per task, one
column per field — sortable, resizable, and reorderable — powered by the
same filters, grouping, and Saved View as every other layout.

Press **`v` `s`** to switch the current view to Table, or pick **Table**
from the layout picker. (`t` is already Timeline's key, and `g` would
collide with the app's own Go-to shortcuts, so Table uses `s` for
Spreadsheet.)

## Columns

**Status**, **ID**, and **Title** are always shown, always first, and can't
be hidden or reordered. Every other field — Type, Project, Priority,
Assignee, Labels, Estimate, Start date, Due date, Progress, and Relations —
is a column you can show or hide from the **Fields** control, the same one
List and Board use.

- **Resize** a column by dragging its right edge; there's no maximum width.
  Double-click the edge to reset it to its default.
- **Reorder** a column by dragging anywhere in its header (a small grip
  marks which ones move); Status, ID, and Title stay fixed in place.

## Sorting

Click a column header to sort by it, click again to reverse, and a third
click clears it back to manual order. Shift-click a header to add it as a
secondary (or tertiary, …) sort key without disturbing the others — once
more than one is active, each shows its rank in a small badge. This
multi-column sort is Table's own (`table-sort:` in the query bar) and
independent of the single **Sort** dropdown List and Board use.

## Editing in place

- **Title**, **Estimate**, **Start date**, and **Due date** click into a
  plain input — Enter commits, Escape discards.
- **Status**, **Priority**, **Type**, **Assignee**, and **Project** open the
  same pickers as the task editor's own rail.
- **Labels** opens a menu that stays open while you pick several.
- **Relations** shows the existing badge plus a **+** to add a Blocks /
  Blocked by / Related link inline, with the same cycle guard as the task
  editor.
- **Progress** is a computed sub-task rollup and is never itself editable.

## Row stripe

The **Stripe** control (Table only) lightly tints alternating rows in a
colour of your choice — pick a preset, or dial in a custom colour and press
**Apply** to commit it. Stripe is furniture: changing it never marks the
view unsaved.

## Sub-tasks

Table always marks a sub-task with `↳` rather than indenting it — nested
display is List-only. The **Sub-tasks** chip still controls whether
sub-tasks show at all (Flat / Hidden), the same as Board, Timeline, and
Calendar.

## Saving

Column order, column widths, hidden fields, the sort keys above, and the
stripe colour all travel with the Saved View, exactly like any other
layout's own settings.
