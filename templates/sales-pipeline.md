---
templateSchema: 1
kind: template
id: sales-pipeline
name: Sales Pipeline
description: Track deals as Projects moving from Lead to Won, with the activities to close each one as Tasks underneath.
icon: handshake
defaultIdPrefix: DEAL

statuses: ["Lead (backlog, #94a3b8)", "Contacted (unstarted, #60a5fa)", "Qualified (started, #fbbf24)", "Proposal Sent (started, #f59e0b)", "Won (completed, #34d399)", "Lost (canceled, #f87171)"]
priorities: ["Hot (#ef4444)", "Warm (#f97316)", "Cold (#60a5fa)"]
labels: [Referral (#22c55e), Inbound (#3b82f6), Outbound (#a855f7), Partner (#14b8a6)]
people: [Dana]

views:
  - {name: Pipeline, icon: kanban, type: board, groupBy: status}

dashboards:
  - name: Pipeline Health
    icon: handshake
    rows:
      - [{type: kpi, title: Proposals out, metric: count, scope: {field: status, value: Proposal Sent}}, {type: pie, title: Activities by Temperature, groupBy: priority}]
      - [{type: timeline, title: Pipeline Flow by Close Month, xField: dueDate, bucket: month, groupBy: status}]
---

# Projects

## Acme Corp — Enterprise Plan
status: proposal sent | created: -30d

## Globex — Team Plan
status: qualified | created: -24d

## Initech — Pilot
status: contacted | created: -16d

## Hooli — Startup Plan
status: won | created: -40d | updated: -8d

## Umbrella Health — Multi-year
status: lost | created: -45d | updated: -12d

# Tasks

## Send proposal and pricing
project: Acme Corp — Enterprise Plan | status: won | priority: hot | labels: [Inbound] | due: -5d | created: -22d

## Follow up on the proposal
project: Acme Corp — Enterprise Plan | status: proposal sent | priority: hot | due: +2d | created: -6d

:::comment dana (-1d)
Champion says legal is the only blocker. Chasing their counsel for a call this week.
:::

## Run the security review
project: Acme Corp — Enterprise Plan | status: qualified | priority: warm | labels: [Inbound] | start: -8d | due: +6d | created: -18d

:::description
## Description
Enterprise security review: SIG questionnaire, a pen-test walkthrough, and MSA redlines. All three have to clear before the proposal can be signed.
:::

### Complete the SIG security questionnaire
status: won | priority: warm | created: -17d

### Schedule the pen-test review call
status: proposal sent | priority: warm | due: +4d | created: -12d

### Redline the MSA with legal
status: qualified | priority: cold | labels: [Inbound] | created: -9d

## Discovery call with the ops lead
project: Globex — Team Plan | status: won | priority: warm | labels: [Referral] | created: -22d

## Scope a 20-seat rollout
project: Globex — Team Plan | status: qualified | priority: warm | labels: [Referral] | start: -5d | due: +10d | created: -20d

### Map their current toolset
status: won | priority: warm | created: -19d

### Estimate the migration effort
status: won | priority: cold | created: -15d

### Draft the rollout timeline
status: qualified | priority: warm | created: -11d

## Confirm budget and timeline {#confirm-budget-globex}
project: Globex — Team Plan | status: contacted | priority: warm | due: +5d | created: -8d | blocks: [proposal-globex]

:::comment dana (-2d)
Budget is approved for the fiscal year but the number isn't confirmed — proposal stays on hold until it is.
:::

## Send proposal and pricing {#proposal-globex}
project: Globex — Team Plan | status: lead | priority: warm | labels: [Referral] | created: -7d | blockedBy: [confirm-budget-globex]

## Intro email from the partner team
project: Initech — Pilot | status: won | priority: cold | labels: [Partner] | created: -14d

## Book a first demo
project: Initech — Pilot | status: contacted | priority: cold | labels: [Outbound] | due: +3d | created: -10d

## Send a case study from a similar customer
project: Initech — Pilot | status: lead | priority: cold | labels: [Partner, Outbound] | created: -6d

## Add to the Q3 nurture sequence
project: Initech — Pilot | status: contacted | priority: cold | labels: [Outbound] | created: -4d

## Negotiate the annual contract
project: Hooli — Startup Plan | status: won | priority: hot | labels: [Inbound] | created: -38d

## Countersign and send the order form
project: Hooli — Startup Plan | status: won | priority: hot | archived: -9d | created: -34d

## Hand off to the customer success team
project: Hooli — Startup Plan | status: won | priority: warm | archived: -8d | created: -30d

## Final pricing negotiation with procurement
project: Umbrella Health — Multi-year | status: lost | priority: warm | labels: [Referral] | archived: -12d | created: -40d

## Send the 'sorry we missed it' follow-up
project: Umbrella Health — Multi-year | status: lost | priority: cold | labels: [Outbound] | created: -11d

## Refresh the standard proposal template
status: contacted | priority: warm | labels: [Inbound] | due: +9d | created: -5d

## Clean up stale leads in the CRM
status: lead | priority: cold | created: -3d

## Prep the Q3 pipeline review deck
status: qualified | priority: warm | labels: [Outbound] | start: -2d | due: +7d | created: -2d
