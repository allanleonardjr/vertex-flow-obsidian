---
templateSchema: 1
kind: template
id: event-planning
name: Event Planning
description: Plan a one-off event as a set of Projects — venue, catering, guests — with vendors and deadlines as Tasks underneath.
icon: party-popper
supportsExampleContent: true

statuses: ["Idea (backlog, #94a3b8)", "To Book (unstarted, #60a5fa)", "In Progress (started, #fbbf24)", "Confirmed (started, #f59e0b)", "Done (completed, #34d399)", "Cancelled (canceled, #f87171)"]
taskTypes: [Booking (#3b82f6), Payment (#22c55e), Guest List (#ec4899), Decor (#a855f7), Logistics (#f97316)]
labels: [Vendor (#06b6d4), Deposit Paid (#22c55e), DIY (#f59e0b), Needs Final Headcount (#ef4444)]
people: [You*, Sarah (Venue Coordinator), Mike (Caterer), Priya (Photographer), Wax (DJ)]

views:
  - {name: By Deadline, icon: calendar-days, type: list, sortBy: dueDate}
  - {name: Planning Board, icon: kanban, type: board, groupBy: status}

dashboards:
  - name: Countdown to the Big Day
    icon: party-popper
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status}, {type: pie, title: Tasks by Vendor, groupBy: assignee}]
      - [{type: kpi, title: Needs Final Headcount, metric: count, scope: {field: label, value: Needs Final Headcount}}]
      - [{type: timeline, title: Deadlines Over Time, xField: dueDate, bucket: week, groupBy: status}]
---

# Projects

## Venue & Catering
status: confirmed | created: -70d

## Photography & Entertainment
status: confirmed | created: -65d

## Guest Experience
status: in progress | created: -50d

## Day-Of Logistics
status: to book | created: -20d

# Tasks

## Book the venue
project: Venue & Catering | type: booking | status: done | priority: high | assignee: You | archived: -55d | created: -68d

## Sign the venue contract and pay the deposit
project: Venue & Catering | type: payment | status: done | priority: high | labels: [Deposit Paid] | assignee: You | archived: -55d | created: -66d

## Finalize the catering menu
project: Venue & Catering | type: booking | status: in progress | priority: high | labels: [Vendor] | assignee: Mike | start: -10d | due: +20d | created: -40d

:::description
## Description
Menu needs to be locked before the final walkthrough. Waiting on the allergy list from the guest tracker before confirming the vegetarian count.
:::

:::comment Mike (-4d)
Locked in the entrée choices — still waiting on your final headcount before I can quote the bar package.
:::

### Schedule the tasting appointment
type: booking | status: done | assignee: You | created: -35d

### Confirm the vegetarian and allergy options
type: booking | status: in progress | assignee: Mike | created: -20d

### Finalize the bar package with the caterer
type: booking | status: to book | assignee: Mike | due: +18d | created: -10d

## Pay the catering deposit
project: Venue & Catering | type: payment | status: done | priority: high | labels: [Deposit Paid, Vendor] | archived: -30d | created: -38d

## Book the photographer
project: Photography & Entertainment | type: booking | status: done | priority: high | assignee: You | archived: -50d | created: -64d

## Book the DJ {#book-dj}
project: Photography & Entertainment | type: booking | status: confirmed | priority: high | labels: [Vendor] | assignee: Wax | due: +5d | created: -45d | blocks: [finalize-timeline]

## Send the photographer the must-have shot list
project: Photography & Entertainment | type: logistics | status: in progress | priority: medium | labels: [Vendor] | assignee: Priya | start: -5d | due: +15d | created: -20d

:::description
## Description
Must-have shots: first look, family formals, and the cake cutting. Priya wants the list at least two weeks out.
:::

### Pick the family photo groupings
type: logistics | status: done | assignee: You | created: -18d

### Choose the first-look location
type: logistics | status: done | assignee: You | created: -14d

### Share the shot list doc with Priya
type: logistics | status: in progress | assignee: Priya | created: -6d

## Finalize the reception timeline with the DJ {#finalize-timeline}
project: Photography & Entertainment | type: logistics | status: to book | priority: medium | assignee: Wax | due: +12d | created: -12d | blockedBy: [book-dj]

## Send save-the-dates
project: Guest Experience | type: guest-list | status: done | priority: high | assignee: You | archived: -40d | created: -50d

## Build the wedding website
project: Guest Experience | type: guest-list | status: done | priority: medium | assignee: You | archived: -35d | created: -48d

## Mail the formal invitations
project: Guest Experience | type: guest-list | status: done | priority: high | labels: [Deposit Paid] | archived: -20d | created: -30d

## Track RSVPs as they come in
project: Guest Experience | type: guest-list | status: in progress | priority: high | labels: [Needs Final Headcount] | due: +10d | created: -20d

:::comment Sarah (-1d)
Whenever you're ready, let's do a walkthrough of the getting-ready suite — mornings work best on my end.
:::

## Finalize the seating chart
project: Guest Experience | type: guest-list | status: to book | priority: medium | labels: [Needs Final Headcount] | due: +22d | created: -8d

## Order the wedding favors
project: Guest Experience | type: decor | status: to book | priority: low | labels: [DIY] | due: +25d | created: -6d

## Confirm the getting-ready timeline with the venue
project: Day-Of Logistics | type: logistics | status: to book | priority: medium | labels: [Vendor] | assignee: Sarah | due: +28d | created: -5d

## Assemble the welcome bags for out-of-town guests
project: Day-Of Logistics | type: decor | status: idea | priority: low | labels: [DIY] | due: +26d | created: -3d

## Confirm final headcount with the caterer
project: Day-Of Logistics | type: guest-list | status: idea | priority: high | labels: [Needs Final Headcount, Vendor] | assignee: Mike | due: +30d | created: -2d

## Set the final budget spreadsheet
type: payment | status: done | priority: high | assignee: You | created: -60d

## Book the block of hotel rooms for guests
type: logistics | status: cancelled | priority: low | archived: -25d | created: -45d

## Get the marriage license
type: logistics | status: idea | priority: high | due: +29d | created: -1d
