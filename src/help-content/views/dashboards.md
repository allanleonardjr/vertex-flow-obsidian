---
title: Dashboards
order: 50
---

A Dashboard is a grid of charts that answer "how is my work going?" at a
glance. Each one lives as its own note under `Dashboards/`, so it behaves like
anything else in Vertex Flow — it can be opened in a tab, duplicated, renamed,
or sent to the Trash.

## Charts

A dashboard holds any number of widgets, each showing one chart type:

| Chart | What it shows |
| --- | --- |
| **Bar** | Totals for each group (e.g. tasks per status) |
| **Line** | A value over time |
| **Pie** | Share of the whole by group |
| **Timeline** | A cumulative area over time |
| **KPI** | A single number (count, or an estimate sum/average) |

Every widget is configured around a **group-by** field — Status, Priority,
Type, Label, Assignee, or Project — and, for the time-based charts, a temporal
axis with Day / Week / Month bucketing and an optional series split. KPI
widgets instead pick a metric (count, estimate sum, estimate average) and a
scope.

## Filters

A dashboard carries a **dashboard-wide filter**, shared by every chart on it,
using the same filter UI and query engine as a Saved View. Apply one and every
widget updates together.

## Configuring

Open a dashboard's settings to rename, duplicate, or delete its widgets, or use
**Save dashboard as…** to copy the whole dashboard. Changes are a draft until
you save them.

> The summary charts on the Projects, People, and Labels hub screens are the
> same engine in a fixed, non-configurable form.
