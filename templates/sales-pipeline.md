---
templateSchema: 1
kind: template
id: sales-pipeline
name: Sales Pipeline
description: Track deals as Projects moving from Lead to Won, with the activities to close each one as Tasks underneath.
icon: handshake
supportsExampleContent: true

statuses: ["Lead (backlog, #94a3b8) - Inbound or found, no touch yet", "Contacted (unstarted, #60a5fa) - First reach-out done", "Qualified (started, #fbbf24) - Fit confirmed, digging into needs", "Proposal Sent (started, #f59e0b) - Pricing is with the buyer", "Won (completed, #34d399) - Closed and signed", "Lost (canceled, #f87171) - Not this cycle"]
priorities: ["Hot (#ef4444) - Close this week", "Warm (#f97316) - Moving through a normal cycle", "Cold (#60a5fa) - Long-tail nurturing"]
labels: ["Referral (#22c55e) - Inbound from a trusted source", "Inbound (#3b82f6) - They came to us", "Outbound (#a855f7) - We reached out cold", "Partner (#14b8a6) - Driven by a partner intro"]
people: [Dana]

views:
  - name: Pipeline
    description: Every deal as a board, from lead to won - one column per status.
    icon: kanban
    type: board
    groupBy: status

dashboards:
  - name: Pipeline Health
    description: Where the pipeline stands - proposals out, effort by temperature, and the flow toward close month.
    icon: handshake
    rows:
      - [{type: kpi, title: Proposals out, metric: count, scope: {field: status, value: Proposal Sent}}, {type: pie, title: Activities by Temperature, groupBy: priority}]
      - [{type: timeline, title: Pipeline Flow by Close Month, xField: dueDate, bucket: month, groupBy: status}]
---

# Projects

## Acme Corp - Enterprise Plan
status: proposal sent | created: -30d

The big one, at proposal stage. A champion is pushing; legal is the only blocker.

## Globex - Team Plan
status: qualified | created: -24d

A 20-seat rollout referred in; the proposal waits on a confirmed budget.

## Initech - Pilot
status: contacted | created: -16d

Early-stage and cold - the nurture sequence runs until it warms up.

## Hooli - Startup Plan
status: won | created: -40d | updated: -8d

Closed and won - negotiated, countersigned, and handed to customer success.

## Umbrella Health - Multi-year
status: lost | created: -45d | updated: -12d

Lost after the pricing negotiation; a graceful follow-up was sent.

# Tasks

## Send proposal and pricing
project: Acme Corp - Enterprise Plan | status: won | priority: hot | labels: [Inbound] | due: -5d | created: -22d

The proposal went out with the enterprise pricing - marked won when it landed.

## Follow up on the proposal
project: Acme Corp - Enterprise Plan | status: proposal sent | priority: hot | due: +2d | created: -6d

Weekly follow-up until legal clears - the champion says that's the only hold.

:::comment dana (-1d)
Champion says legal is the only blocker. Chasing their counsel for a call this week.
:::

## Run the security review
project: Acme Corp - Enterprise Plan | status: qualified | priority: warm | labels: [Inbound] | start: -8d | due: +6d | created: -18d

:::description
## Description
Enterprise security review: SIG questionnaire, a pen-test walkthrough, and MSA redlines. All three have to clear before the proposal can be signed.
:::

### Complete the SIG security questionnaire
status: won | priority: warm | created: -17d

The SIG questionnaire filled and returned with the soak-test results.

### Schedule the pen-test review call
status: proposal sent | priority: warm | due: +4d | created: -12d

A walkthrough of the pen-test finding - mostly low-grades and one fixable.

### Redline the MSA with legal
status: qualified | priority: cold | labels: [Inbound] | created: -9d

MSA redlines bounced with counsel; slowly converging.

## Discovery call with the ops lead
project: Globex - Team Plan | status: won | priority: warm | labels: [Referral] | created: -22d

The referred intro opened the door; ops walked us through their current toolset.

## Scope a 20-seat rollout
project: Globex - Team Plan | status: qualified | priority: warm | labels: [Referral] | start: -5d | due: +10d | created: -20d

The rollout definition for the Globex team - their toolset, the migration effort, and the timeline.

### Map their current toolset
status: won | priority: warm | created: -19d

Their stack mapped - what ships, what's deprecated, what we replace.

### Estimate the migration effort
status: won | priority: cold | created: -15d

The effort estimate per seat and per system.

### Draft the rollout timeline
status: qualified | priority: warm | created: -11d

Phases, owners, and the go-live gate.

## Confirm budget and timeline {#confirm-budget-globex}
project: Globex - Team Plan | status: contacted | priority: warm | due: +5d | created: -8d | blocks: [proposal-globex]

Budget is approved for the fiscal year - the exact number wasn't confirmed, so the proposal stays on hold.

:::comment dana (-2d)
Budget is approved for the fiscal year but the number isn't confirmed - proposal stays on hold until it is.
:::

## Send proposal and pricing {#proposal-globex}
project: Globex - Team Plan | status: lead | priority: warm | labels: [Referral] | created: -7d | blockedBy: [confirm-budget-globex]

Globex's pricing pack, blocked on the confirmed budget.

## Intro email from the partner team
project: Initech - Pilot | status: won | priority: cold | labels: [Partner] | created: -14d

The warm intro from the partner - the reason the pilot opened at all.

## Book a first demo
project: Initech - Pilot | status: contacted | priority: cold | labels: [Outbound] | due: +3d | created: -10d

The first product walkthrough booked with the pilot team.

## Send a case study from a similar customer
project: Initech - Pilot | status: lead | priority: cold | labels: [Partner, Outbound] | created: -6d

A like-size customer success story sent to keep the pilot engaged.

## Add to the Q3 nurture sequence
project: Initech - Pilot | status: contacted | priority: cold | labels: [Outbound] | created: -4d

Low-touch emails until the pilot team re-engages.

## Negotiate the annual contract
project: Hooli - Startup Plan | status: won | priority: hot | labels: [Inbound] | created: -38d

Term and price negotiated down to a signed annual deal.

## Countersign and send the order form
project: Hooli - Startup Plan | status: won | priority: hot | archived: -9d | created: -34d

Countersigned and returned within the same week.

## Hand off to the customer success team
project: Hooli - Startup Plan | status: won | priority: warm | archived: -8d | created: -30d

The signed account shipped to customer success - warm handoff call included.

## Final pricing negotiation with procurement
project: Umbrella Health - Multi-year | status: lost | priority: warm | labels: [Referral] | archived: -12d | created: -40d

The last-mile pricing ask that couldn't be met; the deal was lost there.

## Send the 'sorry we missed it' follow-up
project: Umbrella Health - Multi-year | status: lost | priority: cold | labels: [Outbound] | created: -11d

A graceful note leaving the door open for a future cycle.

## Refresh the standard proposal template
status: contacted | priority: warm | labels: [Inbound] | due: +9d | created: -5d

The template gains this cycle's pricing page and the new logo.

## Clean up stale leads in the CRM
status: lead | priority: cold | created: -3d

Old rows deduped or archived before the quarter close.

## Prep the Q3 pipeline review deck
status: qualified | priority: warm | labels: [Outbound] | start: -2d | due: +7d | created: -2d

The leadership deck - pipeline numbers, velocity, and the top five deals.