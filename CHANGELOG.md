# Changelog

All notable changes to Vertex Flow are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## 1.0.5 — 2026-09-03

### Added
- Compact (narrow-pane) mode: below a 520px pane width the left sidebar and the Task/Project properties column collapse into slide-in drawers, opened from a slim `[Navigation ..... Properties]` toggle strip pinned above the tab strip. Keyed off pane width (not just mobile), so a desktop pane dragged small gets the same space-preserving layout.
- The compact toggle strip stays above the open drawers and doubles as their close button, and the shared backdrop (top) plus a dedicated close button on the navigation drawer give three ways to dismiss it.
- The compact drawers open below the fixed-height toggle strip, so the strip stays a visible header and never covers the drawer's first nav row (e.g. the WORKSPACES collapsible header).
- The navigation drawer's close button sits on its own full-width header row (with a "Navigation" label), keeping it well clear of the first section's "+" add button so it can't be covered by a single tap.
- On mobile, the plugin root now shrinks to the on-screen keyboard's visible area (`visualViewport` height), so the on-screen keyboard no longer hides bottom content behind a blank band.

## 1.0.4 — 2026-09-03

### Added
- Added a blank workspace template for creating custom workflows from scratch.

### Fixed
- Fixed CSS warnings for `clip-path` and `:has` raised during Obsidian plugin review.
- Removed leftover Linear-specific references from comments and user-facing text.
- Made header title rows responsive: View, Dashboard, Project, Task, Labels, and People headers now wrap cleanly on narrow/mobile screens instead of clipping or overflowing the workspace ID.
- Made the List, Board, Calendar, and Timeline views responsive to pane width: List rows hide trailing meta chips by width tier, Board columns shrink, Calendar collapses to a day list, and Timeline clamps its label column — so the views degrade gracefully on narrow panes.
- Fixed List rows with wide meta clusters (parent tasks with sub-task progress) pushing the status dot and ID off the left edge on narrow panes.`.vf-row-open` is a button and Obsidian themes center button content, which overflowed symmetrically past the left edge; it now stays left-aligned and the overflow clips at the row's right instead.
- In the Calendar's narrow day-list mode, pressing Today now scrolls today's date back into view after jumping to the current month, matching the wide grid's Today behavior.

### Changed
- Added the workspace ID prefix to the Labels, People, Views, Dashboards, and Projects browse hub headers for consistency with other view headers.

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
