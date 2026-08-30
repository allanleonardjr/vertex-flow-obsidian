---
templateSchema: 1
kind: template
id: agency-client-management
name: Agency / Client Management
description: Run a solo shop or small agency - one Project per client, cross-cutting business labels, and dashboards for the whole book of business.
icon: briefcase-business
defaultIdPrefix: BIZ

statuses: ["Backlog (backlog)", "To Do (unstarted)", "In Progress (started, #fbbf24)", "Waiting on Client (started, #f59e0b)", "Done (completed, #34d399)", "Canceled (canceled, #f87171)"]
taskTypes: [Onboarding, Deliverable, Admin, Billing, Meeting]
labels: [Retainer (#22c55e), Project-based (#3b82f6), Billable (#06b6d4), Needs Contract (#f59e0b), Overdue Invoice (#ef4444)]
people: [You*, Jordan]

views:
  - {name: Client Board, icon: kanban, type: board, groupBy: project}
  - name: Needs Invoice Follow-up
    query: 'label:"Overdue Invoice" is:open'

dashboards:
  - name: Business Overview
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status}, {type: pie, title: Tasks by Client, groupBy: project}]
      - [{type: kpi, title: Total Open Tasks, metric: count}, {type: kpi, title: Overdue Invoices, metric: count, scope: {field: label, value: Overdue Invoice}}, {type: kpi, title: Needs Contract, metric: count, scope: {field: label, value: Needs Contract}}]
  - name: All Client Activity
    description: Everything happening across every client, excluding internal work.
    filter: 'project:"Example Client A","Example Client B","Example Client C"'
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status, weight: 2}, {type: line, title: Tasks Due Over Time, xField: dueDate, bucket: week, weight: 1}]
---

# Projects

## Example Client A {#client-a}
status: in-progress | created: -60d

This is a sample client showing the intended structure - one Project per client, with tasks scoped inside it. Delete this along with Clients B and C once you've added your first real one.

## Example Client B {#client-b}
status: waiting on client | created: -40d

## Example Client C {#client-c}
status: to do | created: -8d

## Internal {#internal}
status: in-progress | created: -90d

Your own business's work - admin, bookkeeping, marketing yourself - kept separate from client Projects so it doesn't get lost as loose tasks.

# Tasks

## Delete the 3 example clients once you've added your first real one
type: admin | status: todo | priority: urgent

## Website redesign - Phase 1 {#website-redesign}
project: Example Client A | type: deliverable | status: in-progress | priority: high | assignee: You | estimate: 20 | labels: [Retainer] | start: -20d | due: +10d | created: -25d

Full site redesign under the monthly retainer - homepage first, then interior pages.

> Jordan (-3d): @you the homepage mockups are ready for review in Figma.

> You (-2d): Looks great, ship it to staging - thanks for the fast turnaround.

### Design homepage mockup
status: done | assignee: Jordan | labels: [Retainer]

### Build homepage in staging
status: in-progress | assignee: You | labels: [Retainer, Billable]

### QA cross-browser testing
status: todo | assignee: Jordan

## Client A quarterly check-in call
project: Example Client A | type: meeting | status: todo | priority: low | assignee: You | due: +14d | created: -2d

## Update Client A retainer invoice
project: Example Client A | type: billing | status: todo | priority: high | labels: [Retainer, Billable] | due: +2d | created: -1d

## Monthly social content calendar {#social-calendar}
project: Example Client B | type: deliverable | status: waiting on client | priority: medium | assignee: You | labels: [Retainer] | due: +7d | created: -30d

:::description
## This month's calendar
- [x] Rough copy drafted
- [x] Graphics designed
- [ ] Client sign-off (waiting since the 12th)

Send a reminder if there's no response by Friday.
:::

:::comment You (-1d)
Client asked for two rounds of revisions this month instead of one - noting here so it doesn't slip:

- Round 1: rough copy + graphics draft
- Round 2: final polish after their feedback

Flag this to Jordan before next month's calendar goes out.
:::

### Draft caption copy
status: done

### Design template graphics
status: done

## Collect Client B's brand assets {#collect-brand-assets}
project: Example Client B | type: admin | status: done | priority: high | created: -35d | blocks: [design-social-templates]

## Design Client B social templates {#design-social-templates}
project: Example Client B | type: deliverable | status: todo | priority: medium | labels: [Retainer] | blockedBy: [collect-brand-assets] | created: -34d

## Schedule kickoff call with Client B {#kickoff-call-b}
project: Example Client B | type: meeting | status: done | created: -38d

## Set up intro call with Client B
project: Example Client B | type: meeting | status: canceled | archived: -37d | created: -37d | duplicateOf: kickoff-call-b

## Chase Client B overdue retainer payment
project: Example Client B | type: billing | status: todo | priority: urgent | labels: [Overdue Invoice, Billable] | due: -5d | created: -12d

## Client B testimonial request
project: Example Client B | type: admin | status: backlog | priority: low | labels: [Project-based] | created: -6d

## Send onboarding questionnaire
project: Example Client C | type: onboarding | status: todo | priority: high | labels: [Needs Contract] | due: +3d | created: -4d

## Draft statement of work
project: Example Client C | type: admin | status: in-progress | priority: high | assignee: You | labels: [Needs Contract] | due: +6d | created: -3d

## Invoice Client C deposit
project: Example Client C | type: billing | status: todo | priority: urgent | labels: [Overdue Invoice] | due: -2d | created: -5d

## Follow up on Client C SOW feedback
project: Example Client C | type: admin | status: todo | priority: medium | created: -1d

## Renew business insurance
project: Internal | type: admin | status: todo | priority: medium | due: +30d | created: -10d

## Update portfolio site
project: Internal | type: deliverable | status: backlog | priority: low | labels: [Project-based] | created: -15d

## Draft new client welcome packet
project: Internal | type: onboarding | status: in-progress | priority: medium | assignee: Jordan | labels: [Project-based] | created: -8d

## Quarterly bookkeeping review
project: Internal | type: billing | status: done | archived: -10d | created: -40d

## Research new invoicing software
project: Internal | type: admin | status: canceled | priority: low | archived: -25d | created: -50d

## Archive old client contracts
project: Internal | type: admin | status: done | archived: -12d | created: -60d
