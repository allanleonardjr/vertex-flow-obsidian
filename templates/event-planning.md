---
templateSchema: 1
kind: template
id: event-planning
name: Event Planning
description: Plan a one-off event as a set of Projects - venue, catering, guests - with vendors and deadlines as Tasks underneath.
icon: party-popper
supportsExampleContent: true

statuses: ["Idea (backlog, #94a3b8) - The parking lot for vendor ideas", "To Book (unstarted, #60a5fa) - Not yet committed", "In Progress (started, #fbbf24) - Actively being arranged", "Confirmed (started, #f59e0b) - Booked and sealed", "Done (completed, #34d399) - Finished and closed", "Cancelled (canceled, #f87171) - Not happening"]
taskTypes: ["Booking (#3b82f6) - Vendors, venues, and appointments", "Payment (#22c55e) - Deposits and invoices", "Guest List (#ec4899) - Invites, RSVPs, seating", "Decor (#a855f7) - The room, favors, and styling", "Logistics (#f97316) - Day-of flow and coordination"]
labels: ["Vendor (#06b6d4) - Involves an external supplier", "Deposit Paid (#22c55e) - Money down, so the booking is locked", "DIY (#f59e0b) - Hand-made and low cost", "Needs Final Headcount (#ef4444) - Waiting on the RSVP count"]
people: [You*, Sarah (Venue Coordinator), Mike (Caterer), Priya (Photographer), Wax (DJ)]

views:
  - name: By Deadline
    description: Everything sorted by due date - the deadline race between now and the big day.
    icon: calendar-days
    type: list
    sortBy: dueDate
  - name: Planning Board
    description: The whole plan as a board, from idea to done, one column per status.
    icon: kanban
    type: board
    groupBy: status

dashboards:
  - name: Countdown to the Big Day
    description: The countdown at a glance - status, vendor load, the headcount gap, and every deadline.
    icon: party-popper
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status}, {type: pie, title: Tasks by Vendor, groupBy: assignee}]
      - [{type: kpi, title: Needs Final Headcount, metric: count, scope: {field: label, value: Needs Final Headcount}}]
      - [{type: timeline, title: Deadlines Over Time, xField: dueDate, bucket: week, groupBy: status}]
---

# Projects

## Venue & Catering
status: confirmed | created: -70d

The space and the food - booked early, with the menu and bar package still being finalized.

## Photography & Entertainment
status: confirmed | created: -65d

Photographer and DJ, both confirmed; the shot list and the reception timeline are in flight.

## Guest Experience
status: in progress | created: -50d

Invites, website, RSVPs, and seating - the experience everyone actually remembers.

## Day-Of Logistics
status: to book | created: -20d

The last-mile coordination: getting-ready timeline, welcome bags, and the final headcount.

# Tasks

## Book the venue
project: Venue & Catering | type: booking | status: done | priority: high | assignee: You | archived: -55d | created: -68d

The first weekend date that worked - booked and deposit paid months ahead.

## Sign the venue contract and pay the deposit
project: Venue & Catering | type: payment | status: done | priority: high | labels: [Deposit Paid] | assignee: You | archived: -55d | created: -66d

Contract signed and deposit down. The Deposit Paid label keeps the vendor happy.

## Finalize the catering menu
project: Venue & Catering | type: booking | status: in progress | priority: high | labels: [Vendor] | assignee: Mike | start: -10d | due: +20d | created: -40d

:::description
## Description
Menu needs to be locked before the final walkthrough. Waiting on the allergy list from the guest tracker before confirming the vegetarian count.
:::

:::comment Mike (-4d)
Locked in the entrée choices - still waiting on your final headcount before I can quote the bar package.
:::

### Schedule the tasting appointment
type: booking | status: done | assignee: You | created: -35d

Tasting booked a month out; the entrée choices were locked afterwards.

### Confirm the vegetarian and allergy options
type: booking | status: in progress | assignee: Mike | created: -20d

Cross-check the guest tracker's allergy list against every menu item.

### Finalize the bar package with the caterer
type: booking | status: to book | assignee: Mike | due: +18d | created: -10d

The bar quote depends on the final headcount - sequenced after it.

## Pay the catering deposit
project: Venue & Catering | type: payment | status: done | priority: high | labels: [Deposit Paid, Vendor] | archived: -30d | created: -38d

The second deposit for catering, marked paid and archived.

## Book the photographer
project: Photography & Entertainment | type: booking | status: done | priority: high | assignee: You | archived: -50d | created: -64d

First-choice photographer held with a deposit - booked early for a reason.

## Book the DJ {#book-dj}
project: Photography & Entertainment | type: booking | status: confirmed | priority: high | labels: [Vendor] | assignee: Wax | due: +5d | created: -45d | blocks: [finalize-timeline]

Wax is confirmed pending the walkthrough; this blocks the reception timeline.

## Send the photographer the must-have shot list
project: Photography & Entertainment | type: logistics | status: in progress | priority: medium | labels: [Vendor] | assignee: Priya | start: -5d | due: +15d | created: -20d

:::description
## Description
Must-have shots: first look, family formals, and the cake cutting. Priya wants the list at least two weeks out.
:::

### Pick the family photo groupings
type: logistics | status: done | assignee: You | created: -18d

The family groupings agreed - the usual set plus both sets of grandparents.

### Choose the first-look location
type: logistics | status: done | assignee: You | created: -14d

The stairwell landing at the venue, light-checked in the afternoon.

### Share the shot list doc with Priya
type: logistics | status: in progress | assignee: Priya | created: -6d

Final list shared, so Priya can build her run of show.

## Finalize the reception timeline with the DJ {#finalize-timeline}
project: Photography & Entertainment | type: logistics | status: to book | priority: medium | assignee: Wax | due: +12d | created: -12d | blockedBy: [book-dj]

The song flow and timings locked with Wax once he's confirmed.

## Send save-the-dates
project: Guest Experience | type: guest-list | status: done | priority: high | assignee: You | archived: -40d | created: -50d

Save-the-dates out close to the six-month mark.

## Build the wedding website
project: Guest Experience | type: guest-list | status: done | priority: medium | assignee: You | archived: -35d | created: -48d

One page - date, venue, registry, travel - shared with the guests.

## Mail the formal invitations
project: Guest Experience | type: guest-list | status: done | priority: high | labels: [Deposit Paid] | archived: -20d | created: -30d

The formal invitations went out after the website went live.

## Track RSVPs as they come in
project: Guest Experience | type: guest-list | status: in progress | priority: high | labels: [Needs Final Headcount] | due: +10d | created: -20d

A weekly RSVP check - the count drives catering, seating, and the bar.

:::comment Sarah (-1d)
Whenever you're ready, let's do a walkthrough of the getting-ready suite - mornings work best on my end.
:::

## Finalize the seating chart
project: Guest Experience | type: guest-list | status: to book | priority: medium | labels: [Needs Final Headcount] | due: +22d | created: -8d

The table map, only finished once the RSVPs stop moving.

## Order the wedding favors
project: Guest Experience | type: decor | status: to book | priority: low | labels: [DIY] | due: +25d | created: -6d

Candles and a thank-you card, assembled DIY the weekend before.

## Confirm the getting-ready timeline with the venue
project: Day-Of Logistics | type: logistics | status: to book | priority: medium | labels: [Vendor] | assignee: Sarah | due: +28d | created: -5d

Rooms and access times confirmed so the morning runs to plan.

## Assemble the welcome bags for out-of-town guests
project: Day-Of Logistics | type: decor | status: idea | priority: low | labels: [DIY] | due: +26d | created: -3d

A small overnight kit for out-of-town guests, packed the day before.

## Confirm final headcount with the caterer
project: Day-Of Logistics | type: guest-list | status: idea | priority: high | labels: [Needs Final Headcount, Vendor] | assignee: Mike | due: +30d | created: -2d

The catering number locks the bar package and the menu quantities.

## Set the final budget spreadsheet
type: payment | status: done | priority: high | assignee: You | created: -60d

The single source of truth - every deposit, invoice, and paid line item.

## Book the block of hotel rooms for guests
type: logistics | status: cancelled | priority: low | archived: -25d | created: -45d

Cancelled - the guests preferred their own arrangements this time.

## Get the marriage license
type: logistics | status: idea | priority: high | due: +29d | created: -1d

The paperwork has the longest wall-clock of anything on this board - done well ahead.