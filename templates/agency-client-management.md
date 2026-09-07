---
templateSchema: 1
kind: template
id: agency-client-management
name: Agency / Client Management
description: Run a solo shop or small agency - one Project per client, cross-cutting business labels, and dashboards for the whole book of business.
icon: briefcase-business
supportsExampleContent: true
history: true

statuses: ["Backlog (backlog) - Parked until someone picks it up", "To Do (unstarted) - Next up, ready to start", "In Progress (started, #fbbf24) - Actively being worked on", "Waiting on Client (started, #f59e0b) - Blocked until the client responds", "Done (completed, #34d399) - Finished and shipped to the client", "Canceled (canceled, #f87171) - Will not happen"]
taskTypes: ["Onboarding (#3b82f6) - Standing up a new client, or their first pieces of work", "Deliverable (#ec4899) - Client-facing work with a deadline", "Admin (#94a3b8) - Internal chores with no client deliverable", "Billing (#22c55e) - Invoices, chasing payments, fees", "Meeting (#a855f7) - Calls, check-ins, kickoffs"]
labels: ["Retainer (#22c55e) - Monthly-fee work, billed ahead", "Project-based (#3b82f6) - One-off work billed on delivery", "Billable (#06b6d4) - Counted against the client's time", "Needs Contract (#f59e0b) - Work we should not start without a signed SOW", "Overdue Invoice (#ef4444) - A bill the client has not paid on time"]
people: [You*, Jordan]

views:
  - name: Client Board
    description: Every client's work on one board, grouped by Project so the whole book of business fits a single glance.
    icon: kanban
    type: board
    groupBy: project
  - name: Needs Invoice Follow-up
    description: The invoices that need chasing before the month closes.
    query: 'label:"Overdue Invoice" is:open'

dashboards:
  - name: Business Overview
    description: The whole book of business - task mix, per-client load, and the invoices that need chasing.
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

A smaller client at the start of onboarding - brand assets in hand, the first deliverable sketched, and an overdue retainer to chase.

## Example Client C {#client-c}
status: to do | created: -8d

The newest client, pre-contract. The whole sequence - onboarding questionnaire, SOW, deposit - is meant to take them from prospect to signed.

## Internal {#internal}
status: in-progress | created: -90d

Your own business's work - admin, bookkeeping, marketing yourself - kept separate from client Projects so it doesn't get lost as loose tasks.

# Tasks

## Delete the 3 example clients once you've added your first real one
type: admin | status: todo | priority: urgent

Once a real client exists, these three examples are safe to remove - all their tasks go along with them.

## Website redesign - Phase 1 {#website-redesign}
project: Example Client A | type: deliverable | status: in-progress | priority: high | assignee: You | estimate: 20 | labels: [Retainer] | start: -20d | due: +10d | created: -25d

Full site redesign under the monthly retainer - homepage first, then interior pages. The admin and billing underwriting this work live over in the [[Internal]] project.

> Jordan (-3d): @you the homepage mockups are ready for review in Figma.

> You (-2d): Looks great, ship it to staging - thanks for the fast turnaround.

### Design homepage mockup
status: done | assignee: Jordan | labels: [Retainer]

First pass lives with Jordan, then it lands in Figma for the client review up above.

### Build homepage in staging
status: in-progress | assignee: You | labels: [Retainer, Billable]

Recreate the approved mockup in staging - copy, imagery, and the responsive breakpoints.

### QA cross-browser testing
status: todo | assignee: Jordan

Safari, Chrome, and Firefox on desktop plus mobile widths. Ships only after a clean pass.

## Client A quarterly check-in call
project: Example Client A | type: meeting | status: todo | priority: low | assignee: You | due: +14d | created: -2d

The standing call - a status update, priorities for the quarter, and anything the retainer doesn't cover.

## Update Client A retainer invoice
project: Example Client A | type: billing | status: todo | priority: high | labels: [Retainer, Billable] | due: +2d | created: -1d

Send the updated monthly invoice with the extra out-of-scope hours before the payment window closes.

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

Post by post, with the month's hooks and the client's tone.

### Design template graphics
status: done

One set of templates the captions drop into, cut to the client's brand.

## Collect Client B's brand assets {#collect-brand-assets}
project: Example Client B | type: admin | status: done | priority: high | created: -35d | blocks: [design-social-templates]

Logos, fonts, and imagery off the client - everything the social templates depend on.

## Design Client B social templates {#design-social-templates}
project: Example Client B | type: deliverable | status: todo | priority: medium | labels: [Retainer] | blockedBy: [collect-brand-assets] | created: -34d

A set of post templates built on the collected assets, ready for the monthly calendar.

## Schedule kickoff call with Client B {#kickoff-call-b}
project: Example Client B | type: meeting | status: done | created: -38d

The official start - scope, expectations, and the reporting cadence.

## Set up intro call with Client B
project: Example Client B | type: meeting | status: canceled | archived: -37d | created: -37d | duplicateOf: kickoff-call-b

Superseded by the real kickoff call, so it is cancelled and flagged as a duplicate.

## Chase Client B overdue retainer payment
project: Example Client B | type: billing | status: todo | priority: urgent | labels: [Overdue Invoice, Billable] | due: -5d | created: -12d

The invoice for last month's retainer is past due - a polite nudge with the invoice number attached.

## Client B testimonial request
project: Example Client B | type: admin | status: backlog | priority: low | labels: [Project-based] | created: -6d

A kind ask for a short quote to use in the portfolio. Project-based work, so it stays low pressure.

## Send onboarding questionnaire
project: Example Client C | type: onboarding | status: todo | priority: high | labels: [Needs Contract] | due: +3d | created: -4d

Answers to the standard onboarding questions - goals, brand, contacts - before any client work starts.

## Draft statement of work
project: Example Client C | type: admin | status: in-progress | priority: high | assignee: You | labels: [Needs Contract] | due: +6d | created: -3d

The scope, timeline, and deposit terms that turn a prospect into a signed client.

## Invoice Client C deposit
project: Example Client C | type: billing | status: todo | priority: urgent | labels: [Overdue Invoice] | due: -2d | created: -5d

The first invoice, due on signature per the SOW draft sitting with the client.

## Follow up on Client C SOW feedback
project: Example Client C | type: admin | status: todo | priority: medium | created: -1d

The client's side-notes on the SOW. Chase gently so the deposit invoice can land.

## Renew business insurance
project: Internal | type: admin | status: todo | priority: medium | due: +30d | created: -10d

Policy renewal before it lapses - thirty days of runway to compare quotes.

## Update portfolio site
project: Internal | type: deliverable | status: backlog | priority: low | labels: [Project-based] | created: -15d

A lazy-weekend project: refresh the case studies and the homepage blurb.

## Draft new client welcome packet
project: Internal | type: onboarding | status: in-progress | priority: medium | assignee: Jordan | labels: [Project-based] | created: -8d

A template for the first email new clients get - who we are, how we work, key contacts.

## Quarterly bookkeeping review
project: Internal | type: billing | status: done | archived: -10d | created: -40d

Books balanced, receipts filed, tax set-asides reconciled. Done and archived.

## Research new invoicing software
project: Internal | type: admin | status: canceled | priority: low | archived: -25d | created: -50d

Evaluated three options and parked the switch - the current flow works well enough to revisit later.

## Archive old client contracts
project: Internal | type: admin | status: done | archived: -12d | created: -60d

Retention sorted - past-client contracts that no longer need to live in the active vault.