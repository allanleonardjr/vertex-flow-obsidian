---
title: Settings
icon: settings
order: 60
---

Vertex Flow has two separate settings surfaces, and it's worth telling them
apart.

## Plugin settings (Obsidian Settings)

In Obsidian's own **Settings → Vertex Flow** tab:

- **Interface text size** — the density scale: **Compact** (Linear-style
  baseline), **Cozy**, or **Comfortable**. Applies across the whole plugin.
- **Open task notes in Vertex Flow** — when enabled (default), opening a task
  note anywhere in Obsidian — search, a wikilink, the quick switcher —
  redirects into Vertex Flow's own editor instead of the raw note. Use the
  editor's ↗ button to open the raw Markdown note and bypass the redirect.

## Workspace settings (in-app)

Inside a workspace, in the workspace's settings (reachable with `g` `s`):

- **General** — the workspace **name**, its task **ID prefix**, and its
  **folder** (the prefix and folder are fixed once created).
- **Statuses** — rename, recolor, reorder; you must keep at least one.
- **Priorities** — an ordered list, add or remove freely.
- **Task Types** — names and colors, no ordering.
- **People register** — names and aliases, plus marking one person as **you**
  (`isSelf`) for `me` / `self` filters.
- **Archiving** — the optional **auto-archive** for inactive tasks, off by
  default.

Everything here is per-workspace, never shared across workspaces, and stored in
the workspace's own note.

> The two screens act on different scopes: plugin settings are global to your
> app, workspace settings belong to a single workspace.
