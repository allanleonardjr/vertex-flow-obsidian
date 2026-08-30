---
templateSchema: 1
kind: template
id: getting-started
name: Getting Started
description: A complete sample workspace with three mini-projects that opens on a short hands-on intro.
icon: rocket
defaultIdPrefix: TSK

# Statuses, Priorities and Task Types are deliberately left out: omitting a
# taxonomy means "use the workspace defaults", which is exactly what this
# template wants. Only a small generic Label set is overridden.
labels: [Important (#ef4444), Quick win (#22c55e), Waiting on someone (#f59e0b)]

dashboards:
  - name: Overview
    icon: gauge
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status, weight: 7}, {type: pie, title: Tasks by Priority, groupBy: priority, weight: 5}]
---

# Projects

## Getting Started {#intro}
status: in-progress | created: -14d

## Plan a weekend trip {#trip}
status: in-progress | created: -20d

## Redecorate the living room {#room}
status: todo | created: -25d

# Tasks

## Drag this task to Done
project: Getting Started | status: todo | priority: medium

:::description
## Description
Every view is drag-and-drop. On the Board, drop a card into another column to change its status; on the List, drag a row to reorder it.
:::

## Give this task a due date
project: Getting Started | status: todo

## Set a priority on this task
project: Getting Started | status: todo

## Open this task and write a description
project: Getting Started | status: queue

## Create your first Project of your own
project: Getting Started | status: queue | priority: high

## Make a Saved View from the sidebar
project: Getting Started | status: queue

## Try the Board and Calendar views
project: Getting Started | status: queue | labels: [Quick win]

## Decide on travel dates {#travel-dates}
project: Plan a weekend trip | type: chore | status: done | priority: high | labels: [Important] | due: -2d | created: -18d | blocks: [book-flights]

## Agree a budget with everyone
project: Plan a weekend trip | type: chore | status: done | priority: medium | labels: [Waiting on someone] | created: -17d

## Book flights and accommodation {#book-flights}
project: Plan a weekend trip | type: chore | status: in-progress | priority: high | labels: [Important] | start: -3d | due: +6d | created: -15d | blockedBy: [travel-dates]

:::description
## Description
Flights first, then the hotel to match. Blocked until the dates are locked in.
:::

### Book the outbound flights
type: chore | status: done | priority: medium | created: -14d

### Reserve the hotel
type: chore | status: todo | priority: medium | labels: [Waiting on someone] | created: -13d

## Make a shared packing list
project: Plan a weekend trip | type: feature | status: todo | priority: low | labels: [Quick win] | created: -10d

## Research things to do while we're there
project: Plan a weekend trip | type: chore | status: todo | priority: low | start: -6d | due: +4d | created: -8d

## Cancel the old hotel booking
project: Plan a weekend trip | type: chore | status: done | priority: low | archived: -5d | created: -16d

## Look into travel insurance
project: Plan a weekend trip | type: chore | status: canceled | priority: low | archived: -4d | created: -12d

## Choose a colour scheme {#colour-scheme}
project: Redecorate the living room | type: chore | status: done | priority: medium | labels: [Important] | created: -24d | blocks: [repaint-walls]

## Repaint the walls {#repaint-walls}
project: Redecorate the living room | type: chore | status: in-progress | priority: high | start: -1d | due: +3d | created: -20d | blockedBy: [colour-scheme]

### Patch and sand the walls
type: chore | status: done | priority: medium | created: -19d

### Prime the walls
type: chore | status: done | priority: low | created: -18d

### Apply two topcoats
type: chore | status: done | priority: medium | created: -16d

## Fix the flickering light fixture
project: Redecorate the living room | type: bug | status: done | priority: medium | archived: -6d | created: -22d

## Book the annual car service
type: chore | status: todo | priority: low | due: +9d | created: -9d

## Renew the car insurance
type: chore | status: todo | priority: high | labels: [Important] | due: +12d | created: -7d

## Schedule a dentist appointment
type: chore | status: todo | priority: low | labels: [Waiting on someone, Quick win] | created: -3d
