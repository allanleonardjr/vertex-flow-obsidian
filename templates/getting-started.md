---
templateSchema: 1
type: vertex-flow-workspace-template
id: getting-started
name: Getting Started
description: A complete sample workspace with three mini-projects that opens on a short hands-on intro.
icon: rocket
supportsExampleContent: true
history: true

# Statuses, Priorities and Task Types are deliberately left out: omitting a
# taxonomy means "use the workspace defaults", which is exactly what this
# template wants. Only a small generic Label set is overridden.
labels: ["Important (#ef4444) - Blocks a trip, a launch, a decision", "Quick win (#22c55e) - Small effort, obvious payoff", "Waiting on someone (#f59e0b) - Stuck on another person"]

dashboards:
  - name: Overview
    description: The whole workspace at a glance - tasks by status and by priority.
    icon: gauge
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status, weight: 7}, {type: pie, title: Tasks by Priority, groupBy: priority, weight: 5}]
---

# Projects

## Getting Started {#intro}
status: in-progress | created: -14d

This is a Project's overview - its description, stored on the Project's own note. Read it from the panel on the right, or edit the note directly.

Descriptions are just Markdown, so links to any other note in the vault work here too: jump to [[Plan a weekend trip]] or [[Redecorate the living room]] with a single click.

## Plan a weekend trip {#trip}
status: in-progress | created: -20d

A two-day city break with friends. Shows how a Project collects a handful of Tasks, two levels of sub-tasks, and a couple of cross-task relations - all without a single folder.

## Redecorate the living room {#room}
status: todo | created: -25d

A slow-burn renovation shared with a partner: pick a palette, repaint, and swap a couple of fixtures. Nothing here is urgent, so the pile still sits at "to do".

# Tasks

## Drag this task to Done
project: Getting Started | status: todo | priority: medium

:::description
## Description
Every view is drag-and-drop. On the Board, drop a card into another column to change its status; on the List, drag a row to reorder it.
:::

## Give this task a due date
project: Getting Started | status: todo

Open this task's editor, set a due date and a start date, and watch it land on the Calendar and Timeline views.

## Set a priority on this task
project: Getting Started | status: todo

Priorities come from the workspace defaults. Set one and it takes on a color and sorts ahead of lower-priority tasks.

## Open this task and write a description
project: Getting Started | status: queue

:::description
## Description
This panel is a task's description - the one you're reading now. Tap it to edit: it's plain Markdown, so any formatting you already know from Obsidian works.

Links are a great first try. This one points at another note in the vault: [[Plan a weekend trip]]. And a normal Markdown link points outside the vault: [Vertex Flow in the Obsidian community plugin directory](https://community.obsidian.md/plugins/vertex-flow).
:::

## Create your first Project of your own
project: Getting Started | status: queue | priority: high

Hover the "Projects" section of the sidebar and hit add. A Project is just a note with a status; Tasks attach to it through a single field, never by filing their files somewhere.

## Make a Saved View from the sidebar
project: Getting Started | status: queue

Tune the filters, sort, and grouping the way you like, then save from the view bar. The Saved View shows up in the sidebar like a permanent bookmark.

## Try the Board and Calendar views
project: Getting Started | status: queue | labels: [Quick win]

Swap the layout from the bar above the task list. Board, Calendar, and List all read the same tasks - nothing moves, only the lens changes.

## Try setting this task to repeat
project: Getting Started | status: queue | repeat: weekly

Open this task's Repeat row and hit "Set up…" to see the schedule that created. This one recurs automatically once a week - no need to touch it again.

## Watch this task repeat when you complete it
project: Getting Started | status: queue | repeat: monthly when completed

This one only creates its next copy once you mark it done, not on a calendar date - useful for anything that should wait for you, not the clock.

## Decide on travel dates {#travel-dates}
project: Plan a weekend trip | type: chore | status: done | priority: high | labels: [Important] | due: -2d | created: -18d | blocks: [book-flights]

Everyone's calendars finally align. Locking these dates is what unblocks the flights.

## Agree a budget with everyone
project: Plan a weekend trip | type: chore | status: done | priority: medium | labels: [Waiting on someone] | created: -17d

Needs an answer from the whole group, so it sat "waiting on someone" until everyone chipped in.

## Book flights and accommodation {#book-flights}
project: Plan a weekend trip | type: chore | status: in-progress | priority: high | labels: [Important] | start: -3d | due: +6d | created: -15d | blockedBy: [travel-dates]

:::description
## Description
Flights first, then the hotel to match. Blocked until the dates are locked in.
:::

### Book the outbound flights
type: chore | status: done | priority: medium | created: -14d

Booked the early-morning flight so the first day stays usable.

### Reserve the hotel
type: chore | status: todo | priority: medium | labels: [Waiting on someone] | created: -13d

Waiting on the group's call about how close to the station they want to be.

## Make a shared packing list
project: Plan a weekend trip | type: feature | status: todo | priority: low | labels: [Quick win] | created: -10d

One list for the whole group, so nobody drags along a second suitcase.

## Research things to do while we're there
project: Plan a weekend trip | type: chore | status: todo | priority: low | start: -6d | due: +4d | created: -8d

Museum tickets, a decent dinner spot, and the walk that shows off the city. Due a few days before departure so bookings don't sell out.

## Cancel the old hotel booking
project: Plan a weekend trip | type: chore | status: done | priority: low | archived: -5d | created: -16d

The first hotel's deposit was refundable until a month out; cancelled before that window closed.

## Look into travel insurance
project: Plan a weekend trip | type: chore | status: canceled | priority: low | archived: -4d | created: -12d

Dropped it - the trip is short and already covered by the credit card's travel insurance.

## Choose a colour scheme {#colour-scheme}
project: Redecorate the living room | type: chore | status: done | priority: medium | labels: [Important] | created: -24d | blocks: [repaint-walls]

Radiator-grey for one accent wall and warm white everywhere else. Decided, so the paint can finally go on.

## Repaint the walls {#repaint-walls}
project: Redecorate the living room | type: chore | status: in-progress | priority: high | start: -1d | due: +3d | created: -20d | blockedBy: [colour-scheme]

The main event. It's marked blocked by the colour scheme, and that relation shows up as a link between the two task cards.

### Patch and sand the walls
type: chore | status: done | priority: medium | created: -19d

Filled the nail holes and sanded the rough spots before anything gets primed.

### Prime the walls
type: chore | status: done | priority: low | created: -18d

First coat done a day later - it soaked into the old plaster more than expected.

### Apply two topcoats
type: chore | status: done | priority: medium | created: -16d

Both coats on and dry. The accent wall went first, then the rest of the room.

## Fix the flickering light fixture
project: Redecorate the living room | type: bug | status: done | priority: medium | archived: -6d | created: -22d

A loose connection in the ceiling rose. Replaced the fitting and archived the task once it held.

## Book the annual car service
type: chore | status: todo | priority: low | due: +9d | created: -9d

Routine service timed for just after the weekend trip, so the car is fresh for the drive there and back.

## Renew the car insurance
type: chore | status: todo | priority: high | labels: [Important] | due: +12d | created: -7d

The current policy lapses in twelve days. Renewal quotes are already in - the Important label keeps it on the radar.

## Schedule a dentist appointment
type: chore | status: todo | priority: low | labels: [Waiting on someone, Quick win] | created: -3d

Waiting on the surgery to confirm the slot. A five-minute call that keeps the calendar honest.