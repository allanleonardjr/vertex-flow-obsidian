---
templateSchema: 1
kind: template
id: job-search
name: Job Search
description: Track applications as Projects moving from Wishlist to Offer, with the tasks to advance each one underneath.
icon: target
supportsExampleContent: true

statuses: ["Wishlist (backlog, #94a3b8)", "Applied (unstarted, #60a5fa)", "Phone Screen (started, #fbbf24)", "Interviewing (started, #f59e0b)", "Offer (completed, #34d399)", "Rejected (canceled, #f87171)"]
taskTypes: [Application (#3b82f6), Interview (#ef4444), Prep (#a855f7), Follow-up (#f97316), Negotiation (#22c55e)]
labels: [Referral (#22c55e), Cold Apply (#60a5fa), Remote (#06b6d4), Dream Job (#ec4899)]
people: [Sam, Jamie]

views:
  - {name: Pipeline, icon: kanban, type: board, groupBy: status}

dashboards:
  - name: Application Health
    icon: target
    rows:
      - [{type: kpi, title: Interviews scheduled, metric: count, scope: {field: status, value: Interviewing}}, {type: pie, title: Applications by Priority, groupBy: priority}]
      - [{type: timeline, title: Applications Over Time, xField: createdAt, bucket: week, groupBy: status}]
---

# Projects

## Nova Systems
status: interviewing | created: -25d

## Brightline Labs
status: applied | created: -14d

## Meridian Health
status: phone screen | created: -20d

## Cascade Robotics
status: offer | created: -32d | updated: -3d

## Fernbank Studios
status: rejected | created: -38d | updated: -9d

# Tasks

## Submit application and cover letter
project: Nova Systems | type: application | status: offer | priority: high | labels: [Referral] | due: -20d | created: -22d

## Complete phone screen with recruiter
project: Nova Systems | type: interview | status: offer | priority: high | created: -18d

## Prep for the onsite interview loop
project: Nova Systems | type: prep | status: interviewing | priority: high | labels: [Dream Job] | start: -5d | due: +3d | created: -12d

:::description
## Description
Onsite is a full day: two behavioral rounds, one system design, and lunch with the team. Portfolio and mock interview practice both need to be done before then.
:::

### Research the interview panel on LinkedIn
type: prep | status: offer | created: -10d

### Rebuild portfolio deck with latest project
type: prep | status: interviewing | created: -6d

### Do a mock system design round with a friend
type: prep | status: applied | due: +2d | created: -3d

:::comment Sam (-2d)
Sent you my system-design notes from when I interviewed there — the scaling question is the one they always ask.
:::

## Send thank-you notes after the onsite
project: Nova Systems | type: follow-up | status: applied | priority: medium | due: +5d | created: -1d

## Tailor resume for the role
project: Brightline Labs | type: application | status: offer | priority: medium | labels: [Remote] | created: -14d

## Submit application through referral
project: Brightline Labs | type: application | status: offer | priority: high | labels: [Referral] | due: -13d | created: -14d

## Follow up with the referral contact
project: Brightline Labs | type: follow-up | status: applied | priority: medium | due: +6d | created: -7d

## Submit application
project: Meridian Health | type: application | status: offer | priority: medium | labels: [Cold Apply] | created: -20d

## Complete the take-home assignment
project: Meridian Health | type: application | status: phone screen | priority: high | labels: [Dream Job] | start: -6d | due: +2d | created: -15d

:::description
## Description
Takehome covers a small API design problem with a 5-day window. README should explain the trade-offs, not just how to run it.
:::

### Read through the assignment requirements
type: application | status: offer | created: -14d

### Build out the sample solution
type: application | status: offer | created: -10d

### Write up the README and design notes
type: application | status: phone screen | created: -5d

:::comment Jamie (-4d)
Keep the README short — they mentioned they only skim it, the code is what actually gets reviewed.
:::

## Schedule the phone screen call
project: Meridian Health | type: interview | status: offer | priority: medium | due: -8d | created: -18d

## Complete final round interviews
project: Cascade Robotics | type: interview | status: offer | priority: high | labels: [Dream Job] | created: -30d

## Ask former manager for a reference {#cascade-reference-ask}
project: Cascade Robotics | type: follow-up | status: offer | priority: medium | created: -20d | blocks: [cascade-reference-call]

## Schedule the reference check call {#cascade-reference-call}
project: Cascade Robotics | type: interview | status: offer | priority: medium | due: -15d | created: -18d | blockedBy: [cascade-reference-ask]

## Negotiate salary and equity
project: Cascade Robotics | type: negotiation | status: offer | priority: high | archived: -3d | created: -16d

## Sign and return the offer letter
project: Cascade Robotics | type: negotiation | status: offer | priority: high | archived: -2d | created: -14d

## Complete the design challenge
project: Fernbank Studios | type: application | status: rejected | priority: medium | labels: [Cold Apply] | archived: -10d | created: -36d

## Send a follow-up after the rejection
project: Fernbank Studios | type: follow-up | status: rejected | priority: low | created: -9d

## Refresh resume with latest project
type: prep | status: applied | priority: medium | due: +4d | created: -5d

## Clean up LinkedIn and set to open-to-work
type: prep | status: wishlist | priority: low | created: -3d

## Set up job alert filters for remote roles
type: prep | status: wishlist | priority: low | labels: [Remote] | created: -2d
