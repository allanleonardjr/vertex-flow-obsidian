---
templateSchema: 1
kind: template
id: content-pipeline
name: Content Pipeline
description: Plan articles, videos and newsletters as Tasks under a series or campaign, each with a publish date.
icon: pen-tool
supportsExampleContent: true

statuses: ["Idea (backlog, #94a3b8)", "Drafting (started, #60a5fa)", "Editing (started, #fbbf24)", "Scheduled (started, #a855f7)", "Published (completed, #34d399)", "Killed (canceled, #f87171)"]
taskTypes: [Article (#3b82f6), Video (#ef4444), Newsletter (#14b8a6), Social Post (#ec4899)]
labels: [Blog (#60a5fa), YouTube (#f87171), Newsletter (#06b6d4), Social (#d8b4fe)]
people: [Priya]

views:
  - {name: By Publish Date, icon: calendar-days, type: list, sortBy: dueDate}
  - {name: Pipeline, icon: kanban, type: board, groupBy: status}

dashboards:
  - name: Editorial Calendar
    icon: pen-tool
    rows:
      - [{type: bar, title: Pieces by Status, groupBy: status}, {type: pie, title: Pieces by Format, groupBy: taskType}]
      - [{type: timeline, title: Publish Dates Over Time, xField: dueDate, bucket: week}]
---

# Projects

## Q3 Blog Series
status: drafting | created: -30d

## Feature Launch Campaign
status: editing | created: -24d

## Podcast Season 2
status: drafting | created: -20d

# Tasks

## How we cut our build time in half
project: Q3 Blog Series | type: article | status: published | priority: medium | labels: [Blog] | due: -7d | created: -26d

## A field guide to LexoRank
project: Q3 Blog Series | type: article | status: editing | priority: high | labels: [Blog] | start: -10d | due: +3d | created: -22d

:::description
## Description
The flagship explainer for the series. Outline, draft, and an engineering review before it goes to editing.
:::

### Outline the LexoRank post
type: article | status: published | priority: medium | labels: [Blog] | created: -21d

### Draft the LexoRank post
type: article | status: editing | priority: high | labels: [Blog] | created: -16d

### Get an engineering review on the LexoRank post
type: article | status: drafting | priority: medium | labels: [Blog] | created: -12d

## Interview: how the design team works
project: Q3 Blog Series | type: article | status: drafting | priority: low | labels: [Blog] | due: +12d | created: -10d

## Reader Q&A roundup
project: Q3 Blog Series | type: newsletter | status: idea | priority: low | labels: [Blog, Newsletter] | created: -8d

## Promo thread for the build-time post
project: Q3 Blog Series | type: social-post | status: published | priority: low | labels: [Social, Blog] | due: -6d | archived: -5d | created: -24d

## Announcement post {#announcement-post}
project: Feature Launch Campaign | type: article | status: scheduled | priority: high | labels: [Blog] | due: +5d | created: -14d | blockedBy: [demo-video]

:::comment priya (-2d)
Copy is locked. Holding the schedule until the demo video is final so the embed goes out with it.
:::

## 2-minute demo video {#demo-video}
project: Feature Launch Campaign | type: video | status: editing | priority: high | labels: [YouTube] | start: -7d | due: +4d | created: -15d | blocks: [announcement-post]

:::description
## Description
2-minute product demo for the launch. Script, screen capture, then edit with captions. The announcement post embeds it, so it ships first.
:::

### Write the demo script
type: video | status: published | priority: medium | labels: [YouTube] | created: -14d

### Record the screen capture
type: video | status: published | priority: medium | labels: [YouTube] | created: -11d

### Edit and add captions
type: video | status: editing | priority: high | labels: [YouTube] | created: -8d

## Launch-day newsletter
project: Feature Launch Campaign | type: newsletter | status: drafting | priority: medium | labels: [Newsletter] | due: +5d | created: -9d

## Teaser thread
project: Feature Launch Campaign | type: social-post | status: scheduled | priority: medium | labels: [Social] | due: +1d | created: -6d

## Behind-the-scenes short
project: Feature Launch Campaign | type: video | status: killed | priority: low | labels: [YouTube, Social] | archived: -4d | created: -12d

## Customer quote carousel
project: Feature Launch Campaign | type: social-post | status: idea | priority: low | labels: [Social] | created: -5d

## S2E1 — Scaling a design system
project: Podcast Season 2 | type: video | status: scheduled | priority: high | labels: [YouTube] | due: +7d | created: -16d

## S2E2 — On-call without the dread
project: Podcast Season 2 | type: video | status: drafting | priority: medium | labels: [YouTube] | due: +21d | created: -10d

## Season 2 trailer
project: Podcast Season 2 | type: social-post | status: published | priority: medium | labels: [Social, YouTube] | due: -3d | archived: -2d | created: -18d

## Book three guests for the back half of the season
project: Podcast Season 2 | type: newsletter | status: idea | priority: low | created: -7d

## Show-notes newsletter for S2E1
project: Podcast Season 2 | type: newsletter | status: drafting | priority: medium | labels: [Newsletter] | due: +8d | created: -4d

## Refresh the content calendar template
type: article | status: drafting | priority: low | created: -6d

## Audit last quarter's top-performing posts
type: article | status: idea | priority: medium | created: -3d

## Update the media kit and one-pager
type: social-post | status: scheduled | priority: low | labels: [Social] | due: +14d | created: -2d
