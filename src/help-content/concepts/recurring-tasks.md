---
title: Recurring Tasks
order: 55
---

## What recurrence is

A recurring task carries a small **schedule block** in its frontmatter,
edited through the **Repeat** editor on the task. When the schedule fires,
Vertex Flow writes the *next* occurrence as a brand-new task note that
inherits the original's title, project, labels, and other fields. Nothing
repeats in place — each occurrence is its own note, so its status, comments,
and edits stay independent.

## On-date vs. on-close

There are two ways a schedule can fire:

- **On a date** — a daily, weekly, monthly, or yearly cadence (with an
  interval, e.g. "every 2 weeks", and optional weekday / day-of-month /
  month-of-year detail). The next occurrence appears when its date arrives.
- **On close** — the next occurrence is spawned when the task *reaches a
  status*. By default that's any status in the **completed** category; you
  can instead point it at one specific status, so "recur when this hits
  Review" is a supported workflow, not just "recur when done". Unlike an
  on-date occurrence, there's no cadence to compute a landing day from — but
  you can still choose what its Start Date and Due Date look like.

## The anchor date

An on-date occurrence lands on either the **due date** or the **start date** —
whichever you pick as the anchor. If the task has both dates set, the whole
range is shifted forward together so its length is preserved exactly: a task
running start→due over five days stays a five-day task on every occurrence.

## On-close dates

A status-triggered occurrence has no cadence to anchor a date to — it just
lands on the day it spawns. You choose, independently for Start Date and Due
Date, what that occurrence's dates look like:

- **None** — leave the field blank, same as Vertex Flow has always done.
- **Immediately** — set the field to the day the occurrence is created.
- **Shifted** — reuse the same range-preserving shift an on-date occurrence
  gets: pick which field anchors the shift (Due or Start), and it lands on
  the spawn day while the other field moves by the same number of days,
  keeping the original task's start↔due length intact.

Existing on-close series created before this feature existed are
automatically set to **Immediately** for both fields the first time you open
the vault after updating — you can change either back to **None** in the
Repeat editor if you'd rather they stay dateless.

Whatever you choose shows up wherever the schedule itself is described — the
Repeat row's one-line summary on the task, and the entry Activity History
records when you set up or change the repeat. A rule reads as, for example,
`when completed, sets due today` or `when status is Review, sets start
shifted and due shifted, relative to the due date`; the anchor a **Shifted**
field preserves the range around is always named.

## Chains

Each spawned occurrence links back to the one before it through a
`recurringFrom` field. That link is the only structure a series has — there's
no separate list. Only the **newest** note in a chain is "live": it's the one
that will fire next. Older occurrences keep their link (so the series can be
counted) but never spawn anything themselves.

## Catching up after time away

For an on-date series, reopening the vault after being away could mean many
missed dates. Vertex Flow backfills at most **14** missed occurrences in one
pass; beyond that it skips the backlog and creates a single catch-up
occurrence on the most recent missed date, whose schedule then carries the
series back into the future. Your task list never floods with weeks of
skipped dailies.

## Ending a series

A schedule can stop after a set number of occurrences (counting the ones
already created) or on a specific end date. The final occurrence is written
with **no** recurrence block, so a finished series stops cleanly and leaves
nothing live behind.

## Preview ghosts

Add `show:recurring` to a Saved View or the query bar and upcoming on-date
occurrences are projected onto the **Calendar** and **Timeline** views as
non-interactive "ghost" rows — a look ahead before the engine actually
spawns them. Projection runs about **30** days out and is capped at **12**
ghost rows per series. On-close series have no calendar date, so they don't
project.

## The Recurring Overview

Press `g` `r` (or use the command palette) to open the **Recurring** screen.
It lists every live series in the workspace with its cadence, how many
occurrences the chain has produced so far, and the next date it will surface.

> Archiving a recurring task stops it spawning further occurrences — it goes
> dormant while hidden, and picks back up if you unarchive it.
