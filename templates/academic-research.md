---
templateSchema: 1
type: vertex-flow-workspace-template
id: academic-research
name: Academic / Research Project
description: Move a paper or thesis chapter from idea to submission, with lit review, drafting, and revision as Tasks underneath.
icon: graduation-cap
supportsExampleContent: true

statuses: ["Idea (backlog, #94a3b8) - Parked until someone starts the work", "Lit Review (unstarted, #60a5fa) - The reading is underway", "Drafting (started, #fbbf24) - Writing is in motion", "Under Review (started, #f59e0b) - With the reviewers", "Published (completed, #34d399) - Out in the world", "Rejected (canceled, #f87171) - Will not proceed"]
taskTypes: ["Reading (#3b82f6) - Papers, chapters, and related work", "Writing (#ec4899) - Drafting and revising prose", "Analysis (#14b8a6) - Experiments and number-crunching", "Meeting (#a855f7) - Advisor, committee, and collaborator time", "Admin (#94a3b8) - Submissions, IRB, and paperwork"]
labels: ["Needs Advisor Feedback (#f59e0b) - Waiting on a review from the advisor", "Conference Deadline (#ef4444) - Time-locked to a venue deadline", "Fieldwork (#22c55e) - Involves running a study", "Grant-Funded (#06b6d4) - Covered by the grant"]
people: [You*, Prof. Whitfield, Jordan]

views:
  - name: Board
    description: Every piece of work grouped by status, so the whole research pipeline is a single glance.
    icon: kanban
    type: board
    groupBy: status
  - name: By Deadline
    description: Everything sorted by due date - the deadlines that actually keep the work moving.
    icon: calendar-days
    type: list
    sortBy: dueDate

dashboards:
  - name: Research Progress
    description: Progress by status and type, plus the advisor-feedback pile and every coming deadline.
    icon: graduation-cap
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status}, {type: pie, title: Tasks by Type, groupBy: taskType}]
      - [{type: kpi, title: Needs Advisor Feedback, metric: count, scope: {field: label, value: Needs Advisor Feedback}}, {type: timeline, title: Deadlines Over Time, xField: dueDate, bucket: week}]
---

# Projects

## Dissertation Chapter 3 - Methodology
status: drafting | created: -60d

The core empirical chapter of the dissertation - data collection, analysis approach, and a limitations section that says what this study can't claim.

## Journal Paper - Cross-domain Transfer
status: under review | created: -90d

Under review and on its second revision. The outstanding items are the reviewer's ablation comments.

## Conference Paper - NeurIPS Workshop
status: lit review | created: -30d

A follow-up study aimed at the workshop deadline - the reading, the IRB-adjacent prep, and a tight abstract all feed it.

## Workshop Paper - Early Draft
status: rejected | created: -100d | updated: -30d

A practice submission that was rejected at its venue. The feedback is logged; there are no plans to resubmit.

## Comprehensive Exams Reading List
status: lit review | created: -45d

Everything to clear before the exam: theory first, then applied methods, then locking a date with the committee.

# Tasks

## Outline the chapter structure
project: Dissertation Chapter 3 - Methodology | type: writing | status: published | priority: high | created: -55d

A one-page skeleton - section headers, a one-liner each, and where the data sits.

## Draft the methodology section
project: Dissertation Chapter 3 - Methodology | type: writing | status: drafting | priority: high | labels: [Needs Advisor Feedback] | assignee: You | start: -20d | due: +10d | created: -50d

:::description
## Description
The core empirical chapter. Needs the data collection, analysis approach, and limitations sections before it's ready for a full read-through.
:::

### Write the data collection subsection
type: writing | status: published | created: -40d

How the corpus was gathered, the sampling rules, and any exclusions.

### Write the analysis approach subsection
type: writing | status: drafting | created: -25d

The exact analysis pipeline, from cleaning through to the models used.

### Write the limitations subsection
type: writing | status: idea | created: -15d

The known gaps and threats to validity, stated plainly - it goes last for a reason.

## Get advisor feedback on the methodology draft
project: Dissertation Chapter 3 - Methodology | type: meeting | status: idea | priority: medium | labels: [Needs Advisor Feedback] | assignee: Prof. Whitfield | due: +12d | created: -5d

Book advisor time to read the full draft; the Needs Advisor Feedback label keeps it visible until then.

## Submit the manuscript
project: Journal Paper - Cross-domain Transfer | type: admin | status: published | priority: high | created: -70d

The resubmission after the first round - the paper is now with the reviewers.

## Address reviewer 1's comments
project: Journal Paper - Cross-domain Transfer | type: writing | status: under review | priority: high | labels: [Needs Advisor Feedback] | start: -14d | due: +5d | created: -20d

:::description
## Description
Reviewer 1 wants the ablation study rerun with additional baselines and the related-work section expanded to cover two more papers they flagged.
:::

:::comment Prof. Whitfield (-3d)
Reviewer 1's ablation concern is fair - make sure the rerun uses the same seed as the original submission.
:::

### Rerun the ablation experiments
type: analysis | status: published | created: -18d

Same seed as the original run, plus the two new baselines the reviewer asked for.

### Revise the related work section
type: writing | status: published | created: -12d

Two more papers folded in, properly framed against the contribution.

### Update the figures with new results
type: analysis | status: drafting | created: -8d

Every figure that sits on the ablation numbers, regenerated.

## Prepare the camera-ready formatting
project: Journal Paper - Cross-domain Transfer | type: admin | status: idea | priority: medium | due: +20d | created: -2d

Page budget, style compliance, and the copyright forms once the revision clears.

## Read the last 3 years of related workshop papers
project: Conference Paper - NeurIPS Workshop | type: reading | status: lit review | priority: medium | labels: [Conference Deadline] | start: -10d | due: +4d | created: -25d

A sweep of the workshop's prior years so the abstract speaks their language.

## Get IRB approval for the follow-up study {#irb-approval}
project: Conference Paper - NeurIPS Workshop | type: admin | status: published | priority: high | labels: [Fieldwork] | created: -22d | blocks: [followup-data-collection]

Protocol, consent forms, and the review board's sign-off before anyone gets recruited.

## Run the follow-up study data collection {#followup-data-collection}
project: Conference Paper - NeurIPS Workshop | type: analysis | status: drafting | priority: high | labels: [Fieldwork] | due: +8d | created: -20d | blockedBy: [irb-approval]

Recruit a fresh cohort and run the follow-up protocol; IRB clearance is the gate.

:::comment Jordan (-5d)
IRB approval came through - I can help recruit participants next week if that helps hit the deadline.
:::

## Draft the workshop paper abstract
project: Conference Paper - NeurIPS Workshop | type: writing | status: idea | priority: medium | labels: [Conference Deadline] | due: +14d | created: -6d

A tight 250-word pitch that names the delta from last year's work.

## Submit the abstract before the early deadline
project: Conference Paper - NeurIPS Workshop | type: admin | status: idea | priority: high | labels: [Conference Deadline] | due: +15d | created: -4d

Early deadline saves the fee - the draft above has to be in two days before.

## Draft the initial submission
project: Workshop Paper - Early Draft | type: writing | status: published | priority: medium | archived: -35d | created: -95d

The first pass at the workshop paper - it went out, got reviewed, and came back rejected.

## Receive and log the rejection feedback
project: Workshop Paper - Early Draft | type: admin | status: rejected | priority: low | archived: -30d | created: -32d

Log the reviewer notes for future resubmissions and move on.

## Read the core theory papers
project: Comprehensive Exams Reading List | type: reading | status: published | priority: medium | archived: -20d | created: -44d

The foundational reading for the exam - heavily flagged, notes saved in the vault.

## Read the applied methods papers
project: Comprehensive Exams Reading List | type: reading | status: lit review | priority: medium | due: +18d | created: -30d

Method papers and their worked applications; the exam usually pulls from one of these.

## Schedule the exam date with the committee
project: Comprehensive Exams Reading List | type: admin | status: idea | priority: high | due: +25d | created: -10d

Lock a date before the semester schedule fills up the committee's calendars.

## Renew the library database access
type: admin | status: idea | priority: low | due: +7d | created: -6d

Remote access to the journal databases lapses at the end of term.

## Submit the annual progress report to the department
type: admin | status: idea | priority: high | labels: [Grant-Funded] | due: +10d | created: -3d

The grant-funded report - milestones hit, spend to date, and next quarter's plan.

## Apply for the travel grant
type: admin | status: idea | priority: medium | labels: [Grant-Funded] | due: +9d | created: -2d

Covers conference travel for the workshop; the letter needs the advisor's sign-off.