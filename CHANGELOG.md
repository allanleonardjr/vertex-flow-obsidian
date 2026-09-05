# Changelog

All notable changes to Vertex Flow are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- The color picker is now a shared app-wide component and ships a much richer palette: a reordered 48-color **Spectrum Matrix** (8 columns of vertical color families — neutrals, then Reds · Oranges · Yellows · Limes/Greens · Teals/Cyans · Blues · Indigos/Purples · Pinks/Magentas across five intensity rows) rendered in the taxonomy settings (statuses, priorities, task types) and the label editor.
- A **Custom Color** row below the swatch grid lets advanced users pick any raw color via the native color wheel or a typed hex code, styled as a matching square swatch; the popover stays open while dragging the native picker and commits the choice on dismissal.
- Hovering a color swatch now shows Obsidian's styled tooltip with its friendly name and hex (e.g. "Soft Red · #fca5a5"); the custom-color wheel shows the same when its hex lands on a preset, otherwise just the hex.

### Changed
- Renamed `TAXONOMY_PALETTE` to `COLOR_PALETTE` and moved it out of taxonomy scope into a shared `src/core/color.ts` module (all importers updated).
- Standardized the spelling of "Color" (was "Colour") across the UI and comments.
- Greatly widened the color popover and tightened its swatch grid so the 8 columns fit comfortably inside the box, with the inner trigger swatch properly centered.

### Fixed
- The label description textarea used to be freely resizeable in both directions, letting users drag its right edge outside the dialog; it now resizes vertically only, keeping the dialog margins constant.
- Realigned the palette matrix so every column holds a single consistent color family (cyan/teal, blue, purple, and pink/magenta columns no longer mix hues).
- Color swatch hovers no longer show a duplicate browser `title` tooltip next to Obsidian's styled one (the palette's `aria-label` container label that could flash a stray "Color" tooltip near the Custom Color row was also removed).

### Changed
- Removed every `!important` from `styles.css` (224 → 0). Button-chrome resets are now element-scoped (`button.vf-nav-row` instead of `.vf-nav-row`), multi-tag resets (`.vf-browse-card-body`, `.vf-crumb`, `.vf-filter-tag-face`) split so only their `<button>` form fights the base button rule, `<input>` chrome resets use `input.`, and the compact-mode drawers keep their exact widths without a forced override (sidebar clamps via `max-width`; the properties rail drops its inline width while drawn).

### Fixed
- Resolved the Obsidian repo-checker source warnings: an unused `SortDirection` import, a stray `usePlugin()` call, and three legacy `createEl` shorthands in the caret-position/embedded-editor helpers.
- Fixed regressions from the `!important` removal: the label editor's **Custom Color** swatch (a `<label>`, not a `<button>`) renders again; the Trash **Restore** button and every **New …** `.mod-cta` action regain their pointer cursor; the **Delete Forever** menu row no longer shows red-on-red (its hover fill now flips the text to the on-accent colour).

## 1.0.8 — 2026-09-03

### Added
- The **Blank workspace** template is now truly empty: it explicitly overrides every taxonomy (statuses, priorities, task types, labels) to none and ships no views or dashboards, instead of silently applying the workspace defaults.
- A blank (or otherwise empty-taxonomy) workspace is treated as authoritative and degrades gracefully: the Board shows a friendly empty state, and the Status dropdown reads "None" (like the other unset fields) rather than a "No matches" menu.
- Status is now nullable across Tasks and Projects: with no statuses configured, new tasks/projects carry no status instead of a phantom ID that would render as "…(removed)". `defaultNewTaskStatus` becomes `null` in that case and the serialized `_workspace.md` omits every empty taxonomy.

### Changed
- Clicking a **Label** now opens a dedicated label screen (name, tag count, and the same collapsible **Description** editor Projects and Saved Views have — edited through the same mutation as the create/edit dialog) above the label's task viewport, instead of a bare list with no header.
- The **Label** create/edit dialog's description box now spans the full dialog width like the name field.

## 1.0.7 — 2026-09-03

### Added
- Release workflow now generates GitHub artifact attestations (SLSA build provenance) for `main.js` and `styles.css`, letting users cryptographically verify the assets were built from this repository (`gh attestation verify ... -R <owner>/vertex-flow-obsidian`).

## 1.0.6 — 2026-09-03

### Added
- The navigation drawer's close button sits on its own full-width header row (with a "Navigation" label), keeping it well clear of the first section's "+" add button so it can't be covered by a single tap.

## 1.0.5 — 2026-09-03

### Added
- Compact (narrow-pane) mode: below a 520px pane width the left sidebar and the Task/Project properties column collapse into slide-in drawers, opened from a slim `[Navigation ..... Properties]` toggle strip pinned above the tab strip. Keyed off pane width (not just mobile), so a desktop pane dragged small gets the same space-preserving layout.
- The compact toggle strip stays above the open drawers and doubles as their close button, and the shared backdrop (top) plus a dedicated close button on the navigation drawer give three ways to dismiss it.
- The compact drawers open below the fixed-height toggle strip, so the strip stays a visible header and never covers the drawer's first nav row (e.g. the WORKSPACES collapsible header).
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
