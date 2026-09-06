---
templateSchema: 1
kind: template
id: job-search
name: Job Search
description: Track applications as Projects moving from Wishlist to Offer, with the tasks to advance each one underneath.
icon: target
supportsExampleContent: true
history: true

statuses: ["Wishlist (backlog, #94a3b8) - Companies to reach when they open roles", "Applied (unstarted, #60a5fa) - Application sent, waiting to hear", "Phone Screen (started, #fbbf24) - Recruiter screen done or scheduled", "Interviewing (started, #f59e0b) - In the middle of an interview loop", "Offer (completed, #34d399) - An offer is in hand", "Rejected (canceled, #f87171) - Did not advance"]
taskTypes: ["Application (#3b82f6) - Submitting materials and following the process", "Interview (#ef4444) - Screens, rounds, and reference calls", "Prep (#a855f7) - Practice and research before a round", "Follow-up (#f97316) - Thank-yous and status nudges", "Negotiation (#22c55e) - Salary, equity, and the offer"]
labels: ["Referral (#22c55e) - Came through a personal connection", "Cold Apply (#60a5fa) - No warm intro, straight to the portal", "Remote (#06b6d4) - The position is fully remote", "Dream Job (#ec4899) - The one that would be a definite yes"]
people: [Sam, Jamie]

views:
  - name: Pipeline
    description: Every application as a board, from wishlist to offer - one column per status.
    icon: kanban
    type: board
    groupBy: status

dashboards:
  - name: Application Health
    description: The funnel at a glance - interviews scheduled, effort by priority, and applications over time.
    icon: target
    rows:
      - [{type: kpi, title: Interviews scheduled, metric: count, scope: {field: status, value: Interviewing}}, {type: pie, title: Applications by Priority, groupBy: priority}]
      - [{type: timeline, title: Applications Over Time, xField: createdAt, bucket: week, groupBy: status}]
---

# Projects

## Nova Systems
status: interviewing | created: -25d

The furthest along - an onsite loop this week and a Dream Job label.

## Brightline Labs
status: applied | created: -14d

A referral application just in; waiting on the first screen.

## Meridian Health
status: phone screen | created: -20d

A cold apply that surprised - the take-home is the current gate.

## Cascade Robotics
status: offer | created: -32d | updated: -3d

Offer signed - the win. Everything in here is closed out.

## Fernbank Studios
status: rejected | created: -38d | updated: -9d

Rejected after the design challenge; a graceful follow-up was sent.

# Tasks

## Submit application and cover letter
project: Nova Systems | type: application | status: offer | priority: high | labels: [Referral] | due: -20d | created: -22d

The referral-tagged application for Nova - tailored cover letter and portfolio links.

## Complete phone screen with recruiter
project: Nova Systems | type: interview | status: offer | priority: high | created: -18d

The 30-minute recruiter call - clarity on the role, team, and salary band.

## Prep for the onsite interview loop
project: Nova Systems | type: prep | status: interviewing | priority: high | labels: [Dream Job] | start: -5d | due: +3d | created: -12d

:::description
## Description
Onsite is a full day: two behavioral rounds, one system design, and lunch with the team. Portfolio and mock interview practice both need to be done before then.
:::

### Research the interview panel on LinkedIn
type: prep | status: offer | created: -10d

Quick background on each interviewer so the questions land.

### Rebuild portfolio deck with latest project
type: prep | status: interviewing | created: -6d

Fresh slides around the newest project - the screencast-first talk track.

### Do a mock system design round with a friend
type: prep | status: applied | due: +2d | created: -3d

A timed practice round; Sam's notes carry a lot of weight here.

:::comment Sam (-2d)
Sent you my system-design notes from when I interviewed there - the scaling question is the one they always ask.
:::

## Send thank-you notes after the onsite
project: Nova Systems | type: follow-up | status: applied | priority: medium | due: +5d | created: -1d

Three short notes, one per interviewer, sent within 24 hours.

## Tailor resume for the role
project: Brightline Labs | type: application | status: offer | priority: medium | labels: [Remote] | created: -14d

Brightline's stack calls for the infra bullets promoted above the rest.

## Submit application through referral
project: Brightline Labs | type: application | status: offer | priority: high | labels: [Referral] | due: -13d | created: -14d

Applied via the intro, ahead of the posting's close.

## Follow up with the referral contact
project: Brightline Labs | type: follow-up | status: applied | priority: medium | due: +6d | created: -7d

A quick ping so the referral tracks into the hiring system.

## Submit application
project: Meridian Health | type: application | status: offer | priority: medium | labels: [Cold Apply] | created: -20d

The Meridian cold apply - generic but clean.

## Complete the take-home assignment
project: Meridian Health | type: application | status: phone screen | priority: high | labels: [Dream Job] | start: -6d | due: +2d | created: -15d

:::description
## Description
Takehome covers a small API design problem with a 5-day window. README should explain the trade-offs, not just how to run it.
:::

### Read through the assignment requirements
type: application | status: offer | created: -14d

Requirements re-read with Jamie's README advice in mind.

### Build out the sample solution
type: application | status: offer | created: -10d

The API design problem, built and tested locally.

### Write up the README and design notes
type: application | status: phone screen | created: -5d

A short README with the trade-offs spelled out - the code does the talking.

:::comment Jamie (-4d)
Keep the README short - they mentioned they only skim it, the code is what actually gets reviewed.
:::

## Schedule the phone screen call
project: Meridian Health | type: interview | status: offer | priority: medium | due: -8d | created: -18d

The Meridian screen booked once the take-home went in.

## Complete final round interviews
project: Cascade Robotics | type: interview | status: offer | priority: high | labels: [Dream Job] | created: -30d

The Cascade loop - final rounds done, and an offer came out of it.

## Ask former manager for a reference {#cascade-reference-ask}
project: Cascade Robotics | type: follow-up | status: offer | priority: medium | created: -20d | blocks: [cascade-reference-call]

The reference ask that unlocked the check call.

## Schedule the reference check call {#cascade-reference-call}
project: Cascade Robotics | type: interview | status: offer | priority: medium | due: -15d | created: -18d | blockedBy: [cascade-reference-ask]

The check call that ran off the reference ask.

## Negotiate salary and equity
project: Cascade Robotics | type: negotiation | status: offer | priority: high | archived: -3d | created: -16d

A modest bump on the first number, landed on the offer.

## Sign and return the offer letter
project: Cascade Robotics | type: negotiation | status: offer | priority: high | archived: -2d | created: -14d

Signed, returned, and archived - the search is won.

## Complete the design challenge
project: Fernbank Studios | type: application | status: rejected | priority: medium | labels: [Cold Apply] | archived: -10d | created: -36d

The Fernbank mini-project - done, and rejected on the bar, not on the work.

## Send a follow-up after the rejection
project: Fernbank Studios | type: follow-up | status: rejected | priority: low | created: -9d

A gracious note that keeps the door open for future roles.

## Refresh resume with latest project
type: prep | status: applied | priority: medium | due: +4d | created: -5d

The resume now leads with the newest project - ready for the next cycle.

## Clean up LinkedIn and set to open-to-work
type: prep | status: wishlist | priority: low | created: -3d

Headline, the recruiter toggle, and the old jobs trimmed.

## Set up job alert filters for remote roles
type: prep | status: wishlist | priority: low | labels: [Remote] | created: -2d

Alerts filtered to remote roles, so the next search is a little quieter.