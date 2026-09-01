---
title: Trash, deletion & archiving
order: 70
---

## Trash and soft-delete

Deleting in Vertex Flow is **non-destructive by default**. Nothing goes
permanently at the click of a button — instead, deleted items move to Vertex
Flow's own **Trash** (a reversible soft-delete) rather than vanishing from
disk.

The **Trash** hub groups everything soft-deleted in a workspace by kind —
Tasks, Projects, Views, and Dashboards — plus any deleted Workspaces themselves.
From there you can **Restore** an item back to where it was, or **Delete
Forever** to make room. Deleting a workspace permanently requires typing its
name to confirm, so it's hard to lose one by accident.

## Deletion cascades

Deletion is guarded wherever losing something would be surprising:

- The **taxonomy** (Status, Priority, Type, Label) blocks deletion until a
  value is reassigned or confirmed as removed everywhere.
- Deleting a **Project** that still has tasks warns you and offers to cascade
  or cancel, rather than silently deleting its work.
- Deleting a **Person** opens reassign-or-clear.
- Re-parenting a task past four levels deep warns you, and moving a task under
  its own descendant is blocked to keep the tree acyclic.

## Archiving

**Archiving** is different from deleting — it hides finished or parked work
from your active views while keeping the note fully intact. Archive a task,
project, or selection, and unarchive it later the same way: archiving never
cascades or deletes.

An optional **auto-archive** is available per workspace (off by default): a
task that's been inactive for N days can be filed away automatically. Manual
archiving is the default posture — automation only if you turn it on.

> Trash is a separate concept from archiving. Archiving hides; the Trash
> holds soft-deleted items awaiting restore or permanent removal.
