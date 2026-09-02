# Changelog

All notable changes to Vertex Flow are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- Added a blank workspace template for creating custom workflows from scratch.

### Fixed
- Fixed CSS warnings for `clip-path` and `:has` raised during Obsidian plugin review.
- Removed leftover Linear-specific references from comments and user-facing text.

## 1.0.3 — 2026-09-02

### Fixed
- Downgraded React to v18 to pass Obsidian's dynamic script-creation review check.

### Changed
- Added `release:preflight` pnpm script to validate release artifacts before publishing.

## 1.0.2 — 2026-09-02

### Fixed
- Fixed archive toggle (u+x chord) in task editor.
- Addressed Obsidian plugin review findings across lint, TypeScript, and CSS.
- Fixed CI to use pnpm version from package metadata.

## 1.0.1 — 2026-09-02

### Added
- Added u-chord field editing for quick keyboard access to assignee, parent, project, estimate, and dates.
- Added batch u-chord editing across multi-selection with label create-on-attach.
- Added keyboard navigation for template gallery cards.
- Added keyboard-first tab management.
- Added Apache-2.0 licensing.

### Changed
- Renamed "Delete" to "Move to Trash" throughout the UI.
- Improved task list view.
- Improved empty state highlighting.

### Fixed
- Fixed multi-selection restore: focused task was no longer dropped from selection.
- Fixed tab focus/selection preservation in task editor.

## 1.0.0 — 2026-08-31

Initial release of Vertex Flow — a keyboard-first task manager stored entirely as Markdown in your Obsidian vault.

### Features
- Workspace → Project → Task hierarchy with optional sub-tasks.
- Unified taxonomy engine for Status, Priority, Type, and Labels.
- Board, List, Calendar, and Timeline (Gantt) views.
- Saved Views with a text query language for filters and sorting.
- Dashboards with configurable chart widgets (bar, line, pie, timeline, KPI).
- In-plugin Project editor and Task editor with collapsible sections.
- Per-view field visibility and board column collapse.
- Global quick capture, bulk actions, and soft-delete with per-workspace Trash.
- Onboarding via a workspace template gallery.
- Bundled Help pane with Markdown documentation.
- Full keyboard-first navigation with native Command Palette registration.
- Drag-and-drop support on desktop and mobile.
- Markdown frontmatter storage — your data is portable and human-readable.
