---
title: Board view
order: 20
---

The Board view is a Kanban board: columns instead of rows, powered by the same
engine as List underneath — the same filters, the same Saved View.

## Columns

Columns come from the view's **group-by** field (Status by default), so the
same grouping logic that makes groups in the List view makes columns here. Each
column can be **collapsed** or **hidden** per view.

For empty columns, you choose the behavior per view — **Show**, **Collapse**, or
**Hide** — from the empty-column control.

## Working on the board

- Drag a card between columns to change that field live (Status, Priority, a
  Label, an Assignee, … — whatever the board is grouped by).
- Drag-and-drop works with both mouse and touch.
- Move focus between columns with `←` / `→`, and set the focused card's field
  with `s` / `p` / `l` / `t`.

A Board view, including its column states and empty-column behavior, saves as
part of a **Saved View** — so your exact board arrangement travels with the
view.
