---
title: Saved Views
order: 30
---

# Saved Views

A Saved View bundles a layout, grouping, sort, filters, column state and
field visibility under one name in the sidebar. Edits from the view bar are a
draft until you save — nothing overwrites the saved definition until you
choose to. An "Assigned to me" or "Mentions me" view is just a Saved View
with a `self` filter.

## Query Language

Every filter, grouping and sort you can set through the chip bar has a text
equivalent you can type in the **Query** bar. Tokens are `field:value` pairs,
and a bare word matches task titles and descriptions.

A few examples:

| Query | What it matches |
| --- | --- |
| `status:todo` | Tasks in the todo status |
| `assignee:me sort:due` | Your tasks, due date first |
| `label:bug group:status` | Bug-labelled tasks, grouped by status |
| `due:today` | Tasks due today |

Fields, operators and the full grammar are the same one the chip bar uses —
toggle **Query** in the view bar to switch between the visual chips and this
text form freely.
