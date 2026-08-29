---
order: 20
---

# Projects

A Project holds Tasks, and it's the only container between a Workspace and a
Task — a top-level Task attaches to one Project or to nothing at all. A
sub-task carries a Project too, independent of its parent Task: it's seeded
from the parent when the sub-task is created and then maintained on its own,
never re-synced.

A Project gets a status of its own, reusing the same Status taxonomy Tasks use,
so there's only one system to configure. Its progress is computed from its
top-level Tasks (each already rolls up its own sub-tasks) and is never
auto-synced with its status.

Project names are unique within a workspace.
