---
title: Status, Priority, Type & Labels
order: 30
---

Four kinds of field drive most of Vertex Flow — **Status**, **Priority**,
**Task Type**, and **Labels** — and they're actually one engine configured four
ways. They share the same lists, pickers, filtering, grouping, and the same
rules about deleting things.

## One engine, four uses

- **Status** shows where a task is in its lifecycle. Statuses come in fixed
  categories (Backlog, Unstarted, Started, Completed, Canceled) that drive
  progress, but you can rename, recolor, and reorder them. You must keep at
  least one.
- **Priority** says how important something is. An ordered list you can add to
  or remove from freely.
- **Task Type** labels the kind of work (`Bug`, `Feature`, …). A flexible list
  of names and colors, with no ordering.
- **Labels** are free-form tags you can toggle onto a task for cross-cutting
  association — the way to relate work to a project without giving a task a
  second parent.

Each of the four is configured per workspace, in Workspace Settings, and none
of them are shared between workspaces.

## The deletion guard

Because a task's Status, Priority, Type, or Labels are chosen from these
lists, you can't delete a value that's still in use. Attempting to do so opens
a **replace value or remove all** dialog: either pick a replacement value to
reassign the affected tasks to, or confirm that you want to strip the value
from every task using it. It's the same guard across all four, so the behavior
is always predictable.

## Where they appear

These fields power the filter chips, the **group-by** and **sort** controls,
and the columns of every view. Pressing `s` (status), `p` (priority), `l`
(label), or `t` (type) on a focused task opens the corresponding picker.
