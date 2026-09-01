---
title: Task relations
order: 50
---

Relations connect tasks without making one the parent of the other. Where
sub-tasks form a strict tree, relations let any task reference any other task
in four ways:

| Relation | Meaning |
| --- | --- |
| **Blocks** | This task's work is blocked by the referenced task |
| **Blocked by** | The reverse of blocks — shown the other way around |
| **Related** | A loose "these are connected" link |
| **Duplicate of** | This task is a duplicate of the referenced task |

You add relations from the task editor's **Relations** section. Each relation
points at another task by its name; removing one is a simple delete.

Relations roll up into progress just like sub-tasks do — a parent task's
progress bar can reflect related work — but nothing auto-completes anything.
They're informative links, not automation.

> Relations are a complement to the single-parent rule, not a way around it.
> A task still has exactly one primary parent (a Project or a parent Task).
> Use relations for cross-cutting links and Labels for associating a task with
> other projects.
