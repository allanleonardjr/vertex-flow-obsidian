---
templateSchema: 1
type: vertex-flow-workspace-template
id: content-pipeline
name: Content Pipeline
description: Plan articles, videos and newsletters as Tasks under a series or campaign, each with a publish date.
icon: pen-tool
supportsExampleContent: true

statuses: ["Idea (backlog, #94a3b8) - The parking lot for piece ideas", "Drafting (started, #60a5fa) - Outline through first full draft", "Editing (started, #fbbf24) - Review and polish pass", "Scheduled (started, #a855f7) - Locked to a publish date", "Published (completed, #34d399) - Live on the channel", "Killed (canceled, #f87171) - Dropped before publish"]
taskTypes: ["Article (#3b82f6) - Long-form writing for the blog", "Video (#ef4444) - Recorded content for the video channel", "Newsletter (#14b8a6) - Sent to email subscribers", "Social Post (#ec4899) - Threads, promos, and shorts"]
labels: ["Blog (#60a5fa) - Lives and publishes on the blog", "YouTube (#f87171) - Lives and publishes on the video channel", "Newsletter (#06b6d4) - Goes out by email", "Social (#d8b4fe) - Cross-posted to social platforms"]
people: [Priya]

views:
  - name: By Publish Date
    description: Every piece sorted by publish date, so the calendar is always in front of you.
    icon: calendar-days
    type: list
    sortBy: dueDate
  - name: Pipeline
    description: The whole pipeline as a board - from idea to published, one column per status.
    icon: kanban
    type: board
    groupBy: status

dashboards:
  - name: Editorial Calendar
    description: What's publishing when - status mix, format mix, and the dates on the calendar.
    icon: pen-tool
    rows:
      - [{type: bar, title: Pieces by Status, groupBy: status}, {type: pie, title: Pieces by Format, groupBy: taskType}]
      - [{type: timeline, title: Publish Dates Over Time, xField: dueDate, bucket: week}]
---

# Projects

## Q3 Blog Series
status: drafting | created: -30d

The flagship blog run for the quarter - two feature posts plus a reader-favorites slot.

## Feature Launch Campaign
status: editing | created: -24d

The launch push for the new feature: announcement, demo video, newsletter, and social.

## Podcast Season 2
status: drafting | created: -20d

The second season - two episodes booked, a trailer live, and three more guests to line up.

# Tasks

## How we cut our build time in half
project: Q3 Blog Series | type: article | status: published | priority: medium | labels: [Blog] | due: -7d | created: -26d

The quarter's biggest post - a before-and-after story with real numbers. Already published, now doing its promo rounds.

## A field guide to LexoRank
project: Q3 Blog Series | type: article | status: editing | priority: high | labels: [Blog] | start: -10d | due: +3d | created: -22d

:::description
## Description
The flagship explainer for the series. Outline, draft, and an engineering review before it goes to editing.
:::

### Outline the LexoRank post
type: article | status: published | priority: medium | labels: [Blog] | created: -21d

The section breakdown and where the worked example sits.

### Draft the LexoRank post
type: article | status: editing | priority: high | labels: [Blog] | created: -16d

First full pass - the concept, the code sample, and the trade-off discussion.

### Get an engineering review on the LexoRank post
type: article | status: drafting | priority: medium | labels: [Blog] | created: -12d

Someone from platform reads it for accuracy before it can move to editing.

## Interview: how the design team works
project: Q3 Blog Series | type: article | status: drafting | priority: low | labels: [Blog] | due: +12d | created: -10d

A sit-down with the design team; quote approval before publish.

## Reader Q&A roundup
project: Q3 Blog Series | type: newsletter | status: idea | priority: low | labels: [Blog, Newsletter] | created: -8d

Top reader questions answered in one newsletter; parked until there are enough in the queue.

## Promo thread for the build-time post
project: Q3 Blog Series | type: social-post | status: published | priority: low | labels: [Social, Blog] | due: -6d | archived: -5d | created: -24d

The launch-day thread for the build-time post - stats, a quote, and a link. Done and archived.

## Announcement post {#announcement-post}
project: Feature Launch Campaign | type: article | status: scheduled | priority: high | labels: [Blog] | due: +5d | created: -14d | blockedBy: [demo-video]

The launch-hero post for the campaign. It embeds the demo video, so it ships once the video is final.

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

The 2-minute arc - problem, fix, result - mapped scene by scene.

### Record the screen capture
type: video | status: published | priority: medium | labels: [YouTube] | created: -11d

Good audio beats perfect footage; record cleanly and re-take the flubs.

### Edit and add captions
type: video | status: editing | priority: high | labels: [YouTube] | created: -8d

Cut to the script, drop in captions, and compress a clean export.

## Launch-day newsletter
project: Feature Launch Campaign | type: newsletter | status: drafting | priority: medium | labels: [Newsletter] | due: +5d | created: -9d

The email that goes out with the announcement - what ships, why it matters, how to try it.

## Teaser thread
project: Feature Launch Campaign | type: social-post | status: scheduled | priority: medium | labels: [Social] | due: +1d | created: -6d

A softer drop the day before - a hint, not the whole story.

## Behind-the-scenes short
project: Feature Launch Campaign | type: video | status: killed | priority: low | labels: [YouTube, Social] | archived: -4d | created: -12d

A fun slice of the filming that we cut - it didn't add enough to earn the edit time.

## Customer quote carousel
project: Feature Launch Campaign | type: social-post | status: idea | priority: low | labels: [Social] | created: -5d

A batch of launch quotes for social; needs each customer's sign-off first.

## S2E1 - Scaling a design system
project: Podcast Season 2 | type: video | status: scheduled | priority: high | labels: [YouTube] | due: +7d | created: -16d

The season opener with a design-ops guest; already locked to its publish date.

## S2E2 - On-call without the dread
project: Podcast Season 2 | type: video | status: drafting | priority: medium | labels: [YouTube] | due: +21d | created: -10d

A practical sit-down on on-call mechanics; recording next week.

## Season 2 trailer
project: Podcast Season 2 | type: social-post | status: published | priority: medium | labels: [Social, YouTube] | due: -3d | archived: -2d | created: -18d

The cut that reintroduces the show; live and quietly doing the promo job.

## Book three guests for the back half of the season
project: Podcast Season 2 | type: newsletter | status: idea | priority: low | created: -7d

Three interviews to line up for the back half - pitches and dates.

## Show-notes newsletter for S2E1
project: Podcast Season 2 | type: newsletter | status: drafting | priority: medium | labels: [Newsletter] | due: +8d | created: -4d

The show-notes companion that goes out with S2E1.

## Refresh the content calendar template
type: article | status: drafting | priority: low | created: -6d

The shared calendar template needs a second-quarter column - housekeeping.

## Audit last quarter's top-performing posts
type: article | status: idea | priority: medium | due: +21d | created: -3d | repeat: every 3 months

Which formats and topics over-performed, to steer the next quarter.

## Update the media kit and one-pager
type: social-post | status: scheduled | priority: low | labels: [Social] | due: +14d | created: -2d

Refresh the one-pager with this year's numbers and the new logo.
