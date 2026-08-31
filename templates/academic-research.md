---
templateSchema: 1
kind: template
id: academic-research
name: Academic / Research Project
description: Move a paper or thesis chapter from idea to submission, with lit review, drafting, and revision as Tasks underneath.
icon: graduation-cap
defaultIdPrefix: RSCH

statuses: ["Idea (backlog, #94a3b8)", "Lit Review (unstarted, #60a5fa)", "Drafting (started, #fbbf24)", "Under Review (started, #f59e0b)", "Published (completed, #34d399)", "Rejected (canceled, #f87171)"]
taskTypes: [Reading (#3b82f6), Writing (#ec4899), Analysis (#14b8a6), Meeting (#a855f7), Admin (#94a3b8)]
labels: [Needs Advisor Feedback (#f59e0b), Conference Deadline (#ef4444), Fieldwork (#22c55e), Grant-Funded (#06b6d4)]
people: [You*, Prof. Whitfield, Jordan]

views:
  - {name: Board, icon: kanban, type: board, groupBy: status}
  - {name: By Deadline, icon: calendar-days, type: list, sortBy: dueDate}

dashboards:
  - name: Research Progress
    icon: graduation-cap
    rows:
      - [{type: bar, title: Tasks by Status, groupBy: status}, {type: pie, title: Tasks by Type, groupBy: taskType}]
      - [{type: kpi, title: Needs Advisor Feedback, metric: count, scope: {field: label, value: Needs Advisor Feedback}}, {type: timeline, title: Deadlines Over Time, xField: dueDate, bucket: week}]
---

# Projects

## Dissertation Chapter 3 - Methodology
status: drafting | created: -60d

## Journal Paper - Cross-domain Transfer
status: under review | created: -90d

## Conference Paper - NeurIPS Workshop
status: lit review | created: -30d

## Workshop Paper - Early Draft
status: rejected | created: -100d | updated: -30d

## Comprehensive Exams Reading List
status: lit review | created: -45d

# Tasks

## Outline the chapter structure
project: Dissertation Chapter 3 - Methodology | type: writing | status: published | priority: high | created: -55d

## Draft the methodology section
project: Dissertation Chapter 3 - Methodology | type: writing | status: drafting | priority: high | labels: [Needs Advisor Feedback] | assignee: You | start: -20d | due: +10d | created: -50d

:::description
## Description
The core empirical chapter. Needs the data collection, analysis approach, and limitations sections before it's ready for a full read-through.
:::

### Write the data collection subsection
type: writing | status: published | created: -40d

### Write the analysis approach subsection
type: writing | status: drafting | created: -25d

### Write the limitations subsection
type: writing | status: idea | created: -15d

## Get advisor feedback on the methodology draft
project: Dissertation Chapter 3 - Methodology | type: meeting | status: idea | priority: medium | labels: [Needs Advisor Feedback] | assignee: Prof. Whitfield | due: +12d | created: -5d

## Submit the manuscript
project: Journal Paper - Cross-domain Transfer | type: admin | status: published | priority: high | created: -70d

## Address reviewer 1's comments
project: Journal Paper - Cross-domain Transfer | type: writing | status: under review | priority: high | labels: [Needs Advisor Feedback] | start: -14d | due: +5d | created: -20d

:::description
## Description
Reviewer 1 wants the ablation study rerun with additional baselines and the related-work section expanded to cover two more papers they flagged.
:::

:::comment Prof. Whitfield (-3d)
Reviewer 1's ablation concern is fair — make sure the rerun uses the same seed as the original submission.
:::

### Rerun the ablation experiments
type: analysis | status: published | created: -18d

### Revise the related work section
type: writing | status: published | created: -12d

### Update the figures with new results
type: analysis | status: drafting | created: -8d

## Prepare the camera-ready formatting
project: Journal Paper - Cross-domain Transfer | type: admin | status: idea | priority: medium | due: +20d | created: -2d

## Read the last 3 years of related workshop papers
project: Conference Paper - NeurIPS Workshop | type: reading | status: lit review | priority: medium | labels: [Conference Deadline] | start: -10d | due: +4d | created: -25d

## Get IRB approval for the follow-up study {#irb-approval}
project: Conference Paper - NeurIPS Workshop | type: admin | status: published | priority: high | labels: [Fieldwork] | created: -22d | blocks: [followup-data-collection]

## Run the follow-up study data collection {#followup-data-collection}
project: Conference Paper - NeurIPS Workshop | type: analysis | status: drafting | priority: high | labels: [Fieldwork] | due: +8d | created: -20d | blockedBy: [irb-approval]

:::comment Jordan (-5d)
IRB approval came through — I can help recruit participants next week if that helps hit the deadline.
:::

## Draft the workshop paper abstract
project: Conference Paper - NeurIPS Workshop | type: writing | status: idea | priority: medium | labels: [Conference Deadline] | due: +14d | created: -6d

## Submit the abstract before the early deadline
project: Conference Paper - NeurIPS Workshop | type: admin | status: idea | priority: high | labels: [Conference Deadline] | due: +15d | created: -4d

## Draft the initial submission
project: Workshop Paper - Early Draft | type: writing | status: published | priority: medium | archived: -35d | created: -95d

## Receive and log the rejection feedback
project: Workshop Paper - Early Draft | type: admin | status: rejected | priority: low | archived: -30d | created: -32d

## Read the core theory papers
project: Comprehensive Exams Reading List | type: reading | status: published | priority: medium | archived: -20d | created: -44d

## Read the applied methods papers
project: Comprehensive Exams Reading List | type: reading | status: lit review | priority: medium | due: +18d | created: -30d

## Schedule the exam date with the committee
project: Comprehensive Exams Reading List | type: admin | status: idea | priority: high | due: +25d | created: -10d

## Renew the library database access
type: admin | status: idea | priority: low | due: +7d | created: -6d

## Submit the annual progress report to the department
type: admin | status: idea | priority: high | labels: [Grant-Funded] | due: +10d | created: -3d

## Apply for the travel grant
type: admin | status: idea | priority: medium | labels: [Grant-Funded] | due: +9d | created: -2d
