---
title: Activity History
order: 75
---

## What it records

Activity History is an opt-in, per-workspace audit log of what happened in a
workspace: tasks and projects being created, field-level updates (with the
old and new value), comments, and workspace config changes. A bulk edit that
made the *same* change across several tasks aggregates into a single "×N"
entry rather than one line per task.

## Turning it on

History is **off by default**. Enable it per workspace in **Settings →
Activity history**, or start a fresh workspace with it already on via the
template gallery's **"Start with activity history on"** checkbox. That option
also seeds a short demo log so the hub shows something meaningful on first
open instead of an empty screen.

## How it's stored

The log is plain Markdown, not a database — one append-only file per device
per month under the workspace's `History/` folder. Each Obsidian install
writes only to its own stream and the reader merges them all, so two people
sharing a raw-folder-synced vault (Drive, iCloud) never collide writing to
the same file. This is the same per-device design behind who **"me"** is —
see [Comments, mentions & People](comments-and-mentions.md).

## The Feed

Press `g` `e` to open the **Activity History** screen (the Feed): a
chronological list of entries, each showing who acted, what they did, and
which task, project, or view it happened to. It repaints live as changes
land in any other tab.

> Activity History is a local record inside your vault and never leaves it —
> the same as every other piece of Vertex Flow data, but worth stating once,
> since this one is literally a log of your activity.
