# Vertex Flow

A keyboard-first task manager stored entirely as Markdown: projects, tasks, boards, calendars, timelines, chart dashboards, saved views, and an offline help system.

Vertex Flow turns your vault into a fast, high-density project management OS — no cloud, no account, no database. Every task, project, view, and dashboard is a plain Markdown note. You own the data, always, and you can edit it with any tool that reads Markdown.

## Table of Contents

- [Why Vertex Flow?](#why-vertex-flow)
- [Features](#features)
- [Getting started](#getting-started)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Support](#support)
- [Development](#development)
- [License](#license)

## Why Vertex Flow?

- **Your data is your data.** Everything lives as Markdown notes in your vault. Nothing is stored outside it, nothing is locked away in a proprietary database, and nothing requires a server. Export, sync, or back it up with whatever you already use.
- **Fast and keyboard-first.** Move between tasks, reorder cards, set statuses, and fire off quick captures without reaching for the mouse. Core actions (open, quick capture, rebuild index) are also registered as native Obsidian commands, so you can rebind them through Obsidian's own hotkey settings.
- **Full offline help.** Press `?` anywhere for the keyboard-reference, and a complete built-in Help system ships with the plugin — no internet connection or external site required.
- **Flexible by default.** Use it as a solo shopping list or run a full team. Projects and formal ceremony are optional, and every default is overridable per workspace.

## Support

If Vertex Flow helps you stay organized, consider [sponsoring on GitHub ❤️](https://github.com/sponsors/allanleonardjr) — it keeps the project moving and is much appreciated.

## Features

- **Workspace → Project → Task hierarchy.** Workspaces are independent containers with their own statuses, priorities, task types, labels, and people. Projects are optional; a task can attach to nothing, a project, or a parent task.
- **Projects are first-class too.** Each project has its own tabbed editor — editable title, icon, owner, dates, status, priority, labels, and archived — plus a live scope breakdown (tasks / sub-tasks / archived) and a computed progress bar independent of its status.
- **Multiple views** — List, Board (Kanban), Calendar, and Timeline/Gantt — all drag-and-drop on desktop **and** mobile touch.
- **Chart dashboards.** A configurable grid of bar, line, pie, timeline, and KPI widgets with a dashboard-wide filter.
- **Saved Views with a query language.** Bundle layout, grouping, sort, filters, column state, and field visibility under one name. Filter through a visual chip bar or its text equivalent — a full query grammar with field aliases, `is:open` / `is:unscheduled` / `show:archived` flags, sub-task nesting and empty-column modes, and "did you mean" suggestions (e.g. `assignee:me sort:due`, `label:bug group:status`).
- **Sub-tasks with progress rollup.** Parent tasks show a progress bar from their sub-tasks — but nothing auto-completes; you stay in control.
- **Instant-write editing.** Fields save as you type — there's no Save button. Plain-text descriptions autosave on a short debounce, so nothing is ever lost to a forgotten click.
- **Comments and @mentions**, a People register, and a quick capture command that works from anywhere.
- **Real Markdown descriptions.** Task, project, and view descriptions render through Obsidian's own Markdown pipeline, so `[[wikilinks]]`, `![[embeds]]`, `#tags`, checkboxes, and callouts work just like in a regular note. Editing uses an embedded Obsidian editor with Live Preview (falling back to a textarea plus rendered preview if that internal API is unavailable).
- **Non-destructive by default.** Deleting sends items to Vertex Flow's own Trash (a reversible soft-delete) rather than forcing an immediate permanent deletion — no more panicking over a misplaced `Delete`. Restore is one action, and permanent deletion is a deliberate, separate step.
- **Task templates, bulk actions, and archival.** Reuse common setups, act on many tasks at once, and park finished work with archiving — including an opt-in auto-archive that files tasks after N days of inactivity. All with a unified deletion cascade, all stored as plain notes you can read and edit directly.
- **One taxonomy engine, four ways.** Status, Priority, Task Type, and Labels are all driven by a single engine with a consistent guard: you can't delete a value still in use until it's reassigned, recolored, or reordered.
- **Fully native to Obsidian.** Edit a task's note by hand and the views stay in sync; re-parent with a one-field frontmatter edit, never a file move.
- **Multiple workspaces at once.** Open tabs from several workspaces side by side. Each tab is tinted with its workspace's color — visible only while tabs from more than one workspace are open — so you can tell them apart at a glance.
- **A density scale that fits your screen.** Choose compact, cozy, or comfortable UI spacing across the whole plugin — Linear-style density without giving up readability.
- **Fast to open, painless to keep in sync.** The index reads from Obsidian's metadata cache (no slow disk scans) and resolves @mentions in a lazy background pass, so views paint immediately and edits sync automatically.

## Getting started

1. Install **Vertex Flow** from the Community Plugins browser.
2. Create a workspace from the sidebar's **Workspaces** section, or open a bundled sample workspace from the onboarding template gallery to look around.
3. Add a Project, then a Task inside it.
4. Switch between **List** and **Board** from the view bar.

> Tip: Press `?` inside Vertex Flow for the keyboard-reference, or open **Help** in the sidebar for the full built-in documentation.

## Requirements

- Obsidian `1.4.0` or later
- Works on **desktop and mobile**

## Documentation

Vertex Flow ships with a complete built-in help system available **offline in the app** — press `?` anywhere for the keyboard reference, or open **Help** in the sidebar. The source of those docs lives in this repo, so they're also readable here:

- [Getting started](src/help-content/getting-started.md)
- **Concepts** — [Workspaces](src/help-content/concepts/workspaces.md), [Projects](src/help-content/concepts/projects.md), [Tasks](src/help-content/concepts/tasks/_category.md), [Sub-tasks](src/help-content/concepts/tasks/subtasks.md)
- **Views** — [List](src/help-content/views/list-view.md), [Board](src/help-content/views/board-view.md), [Calendar](src/help-content/views/calendar-view.md), [Saved Views](src/help-content/views/saved-views.md)
- [Keyboard shortcuts](src/help-content/keyboard-shortcuts.md)
- [FAQ](src/help-content/faq.md)

Because the same Markdown files power both the in-app help and this documentation section, the two never drift out of sync.

## Development

```bash
pnpm install
pnpm dev        # build help + esbuild watch mode
pnpm build      # build help + templates → typecheck → esbuild production
pnpm typecheck  # typecheck only
pnpm test       # run the unit test suite
```

The `src/core/` domain layer is pure TypeScript with no Obsidian API imports, which keeps it fast to unit-test. Everything in `src/core/` except the `yaml` dependency is dependency-free (enforced by an architecture test).

## License

Vertex Flow is licensed under the [GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0).

Contributions are welcome via pull requests. By contributing, you agree that your code may be distributed under the same AGPL-3.0 terms — meaning anyone (including you) who builds on this code and distributes it must make the source available under AGPL too.
