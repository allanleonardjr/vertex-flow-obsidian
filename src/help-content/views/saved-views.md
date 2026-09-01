---
title: Saved Views
order: 30
---

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

Fields, operators and the full grammar are the same one the chip bar uses —
toggle **Query** in the view bar to switch between the visual chips and this
text form freely.

### Filter fields

| Field | Aliases | Matches |
| --- | --- | --- |
| `status:` | `state` | By status |
| `priority:` | `p` | By priority |
| `type:` | `tasktype`, `kind` | By task type |
| `label:` | `labels`, `tag`, `tags` | By label |
| `assignee:` | `assigned`, `owner` | By assignee |
| `mentions:` | `mention` | By who a task mentions |
| `project:` | — | By project |
| `parent:` | `subtaskof` | By parent task |

A `field:` with no value means its list is empty. `me` / `self` resolves to the
person marked as **you** in the People register; `=unset` matches a field that
has no value (or a taxonomy value literally named "unset" — prefix with `=` for
the verbatim name).

### Sort, group, layout

| Token | Notes |
| --- | --- |
| `sort:rank` | Manual order (default) |
| `sort:priority` / `sort:status` / `sort:title` / `sort:estimate` | Field order |
| `sort:due` / `sort:start` | By due / start date |
| `sort:created` / `sort:updated` | By created / updated time |
| `group:status` / `priority` / `type` / `assignee` / `label` / `project` | Grouping — `group:none` for none |
| `layout:list` / `board` / `timeline` / `calendar` | The view type |

### View behavior

| Token | Notes |
| --- | --- |
| `subtasks:nested` / `flat` / `hidden` | How sub-tasks appear |
| `empty:show-normal` / `auto-collapse` / `auto-hide` | Empty-column behavior (board) |
| `hide:type` / `project` / `priority` / `assignee` / `labels` / `estimate` / `start` / `due` / `progress` / `relations` | Hide a column |
| `date:due` / `date:start` | Which date field the Calendar buckets by |
| `is:open` | Open tasks only |
| `is:unscheduled` | Tasks with no scheduled date |
| `show:archived` | Include archived tasks |
| `show:archived-only` | Only archived tasks |

Sort values accept `asc` / `desc` (e.g. `sort:due asc`). The Query bar gives
live suggestions and "did you mean…" pointers when a token doesn't parse, and
shows a match count as you type.
