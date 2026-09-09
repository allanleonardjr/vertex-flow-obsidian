# Changelog

All notable changes to Vertex Flow are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- **Export tasks by label or person.** The Export dialog's Scope selector now
  also offers **Labels** and **People** alongside Views, Projects and the whole
  workspace — each resolving to the tasks carrying that label or assigned to
  that person.
- **"Export Tasks…" on more sidebar menus.** The row menus for **Untriaged**,
  **All Tasks**, every **Label** and every **Person** now have an
  "Export Tasks…" item that opens the dialog locked to that scope (Views,
  Projects and Workspace already had it).

### Changed
- The Export dialog's Scope and entity pickers, and its mode toggle, now use
  the same dropdown and segmented-control styling as the rest of the app.
- The Export dialog is titled "Export Tasks" or "Export Workspace" to match the
  selected mode, and the workspace menu's "Export Tasks…" opens straight to the
  task-export form.
- In the task-export form the Format picker is a segmented control, the Fields
  list is collapsed by default, and the Export button reads "Export N Task(s)".
- The task-export form shows a summary ("This exports N tasks." / "Captures
  …"), the Fields header reports how many of the eligible fields are selected,
  and a forced scope renders as read-only text — its kind plus icon / colour
  dot / avatar and name — with no border.

## 1.0.15 — 2026-09-09

### Added
- **Export your tasks to CSV, JSON or iCalendar.** Pick a scope — the current
  view, a saved view, a project, or the whole workspace — choose which CSV/JSON
  fields to include, and decide whether archived tasks come along. Exports land
  as real vault files under `<workspace>/Exports/`, named
  `vertex-flow-export-<workspace>-<scope>-<date>.<ext>` so they stay
  recognizable once they're moved or synced elsewhere.
- **Reach export from anywhere.** Export is available from the Sidebar's
  "Export…" row, an "Export…" command in the Command Palette, a button on the
  view toolbar (scoped to that view), and right-click row/card menus on
  **Workspaces**, **Views** and **Projects** — each opening the dialog already
  locked to what you clicked.
- **Export a workspace as a template.** "Export Workspace as Template" captures
  the workspace's taxonomy, views, dashboards, people roster and **Projects**
  as a portable markdown template file — no tasks. Each Project rides in the
  file's frontmatter like a saved view: title, icon, description,
  status/priority/owner/labels, and dates (archived projects are dropped).
  Choose the destination folder from a picker or by typing (default
  `Vertex Flow Templates/`, the folder the New Workspace gallery discovers; the
  legacy `Templates/` folder is still discovered too, and a hint warns when a
  template is saved somewhere the gallery won't see).
- **Result view instead of a toast.** After an export, the dialog shows the
  resulting file's path with actions to **Reveal in Finder / File Manager** or
  **Open in Obsidian** — useful for `.csv`/`.json`/`.ics` files, which
  Obsidian's own file list hides unless "Detect all file extensions" is on.
- **iCalendar keeps sync metadata.** Every `VEVENT` now carries `CREATED`,
  `LAST-MODIFIED` and `SEQUENCE` stamps derived from the task's created/updated
  dates, so re-importing a calendar doesn't churn or lose change history.
- **Your templates are clearly your own.** In the New Workspace gallery,
  vault-authored templates (from your vault's `Vertex Flow Templates/`, plus
  legacy `Templates/`) are set apart from the built-ins: a "From your Vault"
  section badge, a subtle accent border on the cards, a "Your template" pill on
  each card, and the on-disk location — "Located: `Vertex Flow
  Templates/<file>.md`" — shown below the settings on the card.
  The card previews exactly what the template will create: every card — built-in
  or exported — shows the template's taxonomy plus the **Default view**,
  **Views** and **Dashboards** (named pills, each with the icon that view or
  dashboard will show), **Projects** (each with its icon), and **People** rows
  in the same order as the workspace sidebar. Views, dashboards, the people
  register and Projects are structure and always come with the workspace;
  Tasks are the only example material behind the "Populate with example
  content" toggle, which is ticked by default for any built-in whose card
  previews Projects and appears on your own templates whenever the export
  carried tasks. The
  whole footer (Created, Located, "Use this template →") pins to the bottom of
  every card so the action link aligns across the grid.
- **Exported templates now carry their timestamp.** "Export Workspace as
  Template" stamps each exported template file with a `createdAt` timestamp in
  its frontmatter, and the New Workspace gallery shows it as a "Created:"
  date-time line on the card, directly above the "Located:" line. Templates
  exported before this change — or written by hand — simply skip the Created
  line.
- **Include tasks in an exported template.** "Export Workspace as Template"
  gains an "Include tasks in the template file" checkbox (off by default) that
  carries the workspace's tasks into the template's body with their
  descriptions and comments. Recurrence is written as a compact shorthand
  (`weekly`, `every 2 weeks`, "… when completed"); rules the shorthand can't
  express are left out rather than flattened. The existing "Include archived"
  toggle now covers archived Projects *and* Tasks together so cross-links stay
  resolvable — links to anything still excluded are dropped instead of left
  dangling.
- **Your exported templates can seed tasks too.** A template that carries tasks
  gains the gallery's "Populate with example content" toggle, so a new
  workspace created from it starts with your tasks as lightweight copies, like
  the built-in templates' sample tasks.
- **Export entry points say what they export.** The right-click menus on
  **Workspaces**, **Views** and **Projects** now read "Export Tasks…" and
  "Export as Template…" instead of the ambiguous "Export…" / "Export Workspace
  as Template…", so a menu makes clear it's exporting data, not launching the
  template builder.

- **Task editor shows Created and Updated.** The property rail now has read-only
  "Created" and "Updated" rows — Created as a full date-time, Updated as a
  relative time ("3 hours ago") with the exact timestamp on hover.
- **Sidebar footer shows the plugin version.** The sidebar now pins a muted,
  centered footer to its bottom edge reading `v1.0.14 by JR Leonard`, linking
  the name to a profile. The footer hides in the collapsed/minimized state
  (`is-minimized`) like the rest of the sidebar chrome.

### Changed
- **The `u`+key quick field pickers can be filtered by typing.** Every
  menu-style picker opened by the `u` chord (status, priority, type, label,
  assignee, parent, project) now shows a search box above its option list —
  type to narrow the rows, arrow keys and `Enter` work on the filtered list.
  The Labels picker's search box doubles as its create field: type a name with
  no exact match and a "Create …" row appears to create and attach it, so the
  separate "Create label…" input is gone. The task editor rail's own pickers
  now always show their search box too.
- **Entity `type:` frontmatter is now `vertex-flow-`-prefixed.** Task, Project,
  Workspace, View and Dashboard notes carry `type: vertex-flow-task`,
  `vertex-flow-project`, and so on, matching the convention exported and
  template files already use. Notes with the old bare values (`task`,
  `project`, …) still load unchanged, and a background pass quietly rewrites
  them to the new value the next time the vault is indexed — nothing you need
  to do, and nothing changes in the app.
- **Template frontmatter `kind` is now `type`.** The workspace-template grammar
  uses `type: vertex-flow-workspace-template` (and `-snapshot`) instead of
  `kind: template`/`kind: snapshot`. Old `kind` frontmatter still loads. Files
  exported as templates get a `vertex-flow-template-` filename prefix while
  their frontmatter `id` stays unprefixed.
- **Saved Views and Dashboards store their filter as one query string.** A
  view note now keeps its whole definition — filters, layout, grouping, sort,
  hidden fields, sub-task mode — in a single `query:` line (the same syntax the
  Query Bar shows), and a dashboard note keeps its filter in a `filter:` line,
  instead of a block of separate `viewType:`/`filters:`/`groupBy:`/… keys. A
  Project's embedded view block moves the same way. Old-format notes still load,
  and a background pass rewrites each one the next time the vault is indexed —
  nothing you need to do, and nothing changes in the app.
- **Format migrations show up in Activity History.** When the indexer converts
  old-format notes (the storage split, the view/dashboard query cutover, or
  recurrence date-mode backfill), it records one `[system]` entry per note kind
  in the History feed so there's a trail of what was touched.
- **iCalendar only lets you toggle the description.** For ICS export, the
  dialog's field list now offers a single **Description** toggle; everything
  else a calendar event needs (identity, status, dates, sync stamps) is emitted
  unconditionally. An empty field selection is a valid calendar export.
- **Export dialog layout.** **Format** and **Scope** (and the View/Project
  sub-selects) now sit above the scrollable body so they're always visible,
  while the task count + estimated size settle into a footer with the action
  buttons.
- **Export field picker uses ★-style rows instead of checkboxes.** Each field —
  and **Include archived tasks** — is now a clickable menu row with a leading
  ✓ for the active state, matching the picker rows used elsewhere in the app
  (assignee, labels) rather than the browser-native checkbox.
- **"Include archived tasks" grouped under an Options box*.** The archived-task
  toggle now lives in its own bordered group beside the **Fields** group,
  rather than floating alone in the body.

### Fixed
- **Exported workspace templates no longer drop their views and dashboards.**
  Creating a workspace from an "Export Workspace as Template" file used to come
  out without any of the saved views or dashboards the template carried — the
  gallery's always-off "Populate with example content" toggle silently gated
  them away. A template that opts out of example content (an exported workspace
  ships no tasks or projects, only configuration) now applies everything it
  returns regardless of the toggle.
- **iCalendar all-day event end dates.** All-day events now emit
  `DTEND;VALUE=DATE` one day after the task's due date (exclusive end), matching
  how calendars like Google Calendar store all-day events — previously the end
  date came out a day early.
- **Tall dialogs scroll their body.** The dialog's header and footer stay
  pinned while only the content area scrolls, instead of the whole dialog
  overflowing the window. Applies across the editor's dialogs (Replace
  value/person, Person, Label, Widget config, Shortcuts, Export, and more).
- **The description textarea fills its row.** The task-editor description field
  now spans the full width of the field column instead of hugging the icon
  column.

## 1.0.14 — 2026-09-08

### Added
- **Workspace setting: default task type for new tasks.** A new "Task creation"
  section in workspace settings sets the Task Type every newly created task
  starts with (or "None" — a fully valid steady state, unlike status). The
  picker renders types as the same bordered pills List/Board rows and the task
  editor use. When no default is set, a help icon sits right after "Type" in
  the task editor's property rail; clicking it explains the setting and links
  straight to it. A stale/unknown id in `_workspace.md` clears itself to None on
  load rather than forcing a pick, and changing the setting shows up in Activity
  History like any other config field.
- **Workspace setting: where new tasks land.** "New tasks go to" chooses whether
  a brand-new task is ranked at the **top** of its siblings (the existing
  behavior, and the default — so nothing changes for existing workspaces) or the
  **bottom**. Applies to tasks created at the top level or under a parent, and
  to an orphaned recurring successor's fallback placement. Bulk content creation
  and template seeding are unaffected.
- **Reopen your last workspace on relaunch.** The plugin now remembers which
  workspace this device last had active and reopens it on load, falling back to
  the first workspace if it no longer exists. Stored per-device in the app's own
  storage, never in the vault — a shared or synced vault won't carry one
  machine's pointer onto every other machine.
- **On-close recurrence can now set Start/Due dates.** Status-triggered
  ("on close") repeats previously always spawned with no dates at all. Each
  of Start Date and Due Date can now independently be set to None (unchanged
  default for new rules going forward is Immediately), Immediately (today),
  or Shifted (preserves the source task's date range, anchored to the day it
  spawns — the same math on-date recurrence already uses). Existing on-close
  series are migrated to Immediately for both fields automatically. The
  configured date modes (including which date a "Shifted" field is anchored
  to) now show up in the Repeat row's one-line summary on the task and in the
  Activity History entry recorded when a repeat is set up or changed, not
  just in the Repeat editor.
- Comments are now selectable.
- **Edit comments.** A pencil icon on each comment switches it into an inline
  editable field with explicit Save/Cancel — no auto-save, and no restriction
  on whose comment can be edited, matching the existing unrestricted delete.
  An edited comment shows "· edited" next to its date, and the change is
  recorded in Activity History as "edited a comment on."
- **Reply to a specific comment.** A reply icon opens a dismissible "Replying
  to {author}: ..." strip above the comment composer; posting attaches a
  reference to that comment. Comments stay a flat, unthreaded list — a reply
  shows a small "↳ replying to {author}" line above it, clickable to jump to
  the original, or "↳ replying to a deleted comment" if it's since been
  removed. Replies get their own Activity History action ("replied to a
  comment on"), distinct from a plain comment.
- Added a copy icon to each comment, copying its raw Markdown source to the
  clipboard.
- Comment actions (reply, copy, edit, delete) now use consistent icons —
  including the same Trash icon used elsewhere for deletion — and sit
  grouped together on the right of each comment.

### Changed
-   Added padding to the task editor's title field, and title fields of Views, Dashboards and Projects.


## 1.0.13 — 2026-09-07

### Fixed
- **A weekly repeat no longer lands the next occurrence on the same day.** Setting up an on-date repeat on a task that carries a due (or start) date seeded the schedule's `nextDate` to the task's *own* anchor date — the day this task already occupies — so the Repeat dialog's preview showed the same day as the next landing, and once that date arrived the reconcile engine spawned an exact duplicate beside the source note. New recurrences now seed one full cadence **strictly past** the anchor (a weekly repeat on a task due today lands next week), matching the engine's "next cadence point strictly after" rule and the existing dateless-task behavior. The same fix applies to `repeat:` authored in a markdown workspace template, which mirrors the dialog's seeding logic.

## 1.0.12 — 2026-09-07

### Added
-   Added a Changelog page to the in-app Help system, generated directly from this file, so release notes are visible without leaving Obsidian.
-   Added the `g r` chord for Recurring, to the quick help.
-   Added in-app Help documentation for Recurring Tasks and Activity History, with links from the README.
-   Added the ability to press [Esc] button to clear all selections.

### Changed
-   Updated the docs to reflect correct sidebar order. 
-   **Task Type now shows on List rows, not just Board cards.** The "Type" field toggle previously did nothing in a List view; it now renders the Task Type as a bordered, bold pill in the row's trailing meta cluster (just before Priority), and toggling "Type" off in a Saved View hides it from both Board cards and List rows. Labels are unchanged — still plain tinted pills.

### Fixed
-   Collapsing a group in the List view works again — a 1.0.11 regression had left it dead on the Project detail view and the label / person views. Project task lists now persist group collapse to the Project note's `view:` block; label and person views keep it for the session.
-   **Board card labels no longer overflow the card.** `.vf-labels` had no `flex-wrap`, so a task with several labels laid them out in one unbroken row whose minimum width could exceed the fixed column width, spilling past the card edge with nothing clipping the overflow. Labels on Board cards now wrap onto additional lines; List row label rendering (single-line, clipped) is unchanged.


## 1.0.11 — 2026-09-07

### Added
-   Views, Dashboards and Projects can now be nested under a group in the sidebar and a "/" slash hint is added to the create/edit dialogs.
- **"Move to Trash" on the Task Editor page.** Previously only available as a row action in List/Board view — a task can now be moved to Trash directly from its own editor, in the property rail below the raw source view. Uses the same confirm dialog and sub-task cascade prompt as the existing row action; the tab closes itself once the task is gone.
- **Projects can now save their task-list view.** A Project's embedded view (sort, grouping, filters, sub-task display) used to reset on every visit — there was nowhere for it to persist. It now saves to the Project's own note as a `view:` frontmatter block, with a real **Save** button alongside Reset/Save view as…, and the usual unsaved-changes guard when navigating away. Column-collapse on a Project's task list, which previously attempted a silent broken write, is now a clean no-op.
- **Nested collapsible groups for Projects, Views and Dashboards in the sidebar** — the `/`-nested folder rendering that Labels already had is now a generic tree component (`buildTree` / `TreeList`, with an exported `defaultTreeSort` and an optional sibling-comparator hook reserved for a future manual-sort feature), applied to the Projects, Views and Dashboards sidebar sections as well. A Project, View or Dashboard whose name/title contains `/` (e.g. `Application/UI`) renders as independently collapsible folders showing only the leaf segment, full path in a hover tooltip; each section owns its own collapse-state namespace, so collapsing a "Projects" group never touches a same-named "Labels" group. This is display-only — storage, uniqueness, filtering, query round-tripping and every other Label/Project/View/Dashboard surface are unchanged; the hub Browse screens stay flat card grids. The Project, View and Dashboard naming dialogs (and the "Save view/dashboard as…" dialogs) now carry a "Use / to nest under a group in the sidebar" hint, and a project title with `/` now sanitizes to a hyphen in its vault filename (`Application/UI` → `Application-UI.md`) instead of losing the separator.
- **Nested collapsible label folders in the sidebar** — labels whose name contains `/` (e.g. `Application/UI/Forms`) now render as nested, independently collapsible folders in the sidebar's Labels section, Linear-style, one level per `/`. Each row shows only its leaf segment with the full path in a hover tooltip; folder collapse state persists across reopens via the existing sidebar-chrome mechanism. Folders and bare labels at the same depth are interleaved alphabetically by their own segment, and a bare label sharing a folder's name sorts directly above that folder. Storage, naming, filtering, and matching are unchanged — `TaxonomyValue.name` stays the full path everywhere outside the sidebar; the other Label views are untouched.

### Changed
-   Moved the comment editor to above the list of comments so a user doesn't have to scroll to the bottom to add a comment.

### Fixed
- **`u l` "Create label…" no longer attaches an existing label instead of the new one.** The quick-field picker's window-level arrow-nav/Enter listener intercepted Enter in capture phase before it could reach the "Create label…" input's own handler, so typing a new name and pressing Enter silently toggled whichever existing label was highlighted in the list above instead of creating and attaching the typed label. The list listener now ignores Enter when focus is in the create-label input, letting it run its own create-and-attach handler.
- **Sort control hidden when sub-tasks are Nested.** Nested rows always order by rank at every level regardless of the view's sort field (`buildNestedRows`), so the Sort chip was a dead control there — picking any field silently had no effect on what rendered. It's now hidden whenever a List view's sub-task display is set to Nested; switching back to Flat or Hidden brings it back.

## 1.0.10 — 2026-09-07

### Added
- **`repeat:` in the markdown template grammar** — a task field line can now carry a minimal recurrence: `repeat: weekly`, `repeat: every 2 weeks`, `repeat: monthly when completed`. Parsed to a lightweight `ParsedRepeat` (frequency, interval, on-date/on-close trigger) and resolved to a full `RecurrenceConfig` once the task's own dates are known — anchoring to the task's due (then start) date, or seeding one cadence step past today when it has neither, mirroring the Repeat dialog's `finalize()`. An unrecognized cadence fails template parsing with a line-numbered error. Demonstrated in the Getting Started (both trigger types), Sales Pipeline (weekly proposal follow-up), and Content Pipeline (quarterly audit) templates.
- **Sidebar page** — Added a 'Recurring' screen (accessible via `g r` and the command palette) that renders the recurring overview as a full sidebar-navigable tab, consistent with other hub screens like History and Trash.
- **Per-workspace identity UI.** The People settings section shows an always-accurate status line for this workspace on this device ("You're set as *Name*…" / "You haven't set who you are yet…") with an inline **Unset**, a labelled **Me** column, and — when no identity is set — a dismissible "Who are you in this workspace?" banner. The same banner appears in the sidebar's People section with a one-click link that opens Settings scrolled straight to the People section. Dismissing it is remembered per workspace and automatically resets if "me" is later cleared (e.g. that person is deleted).
- A **You** accent pill marks the current identity in the sidebar People list, the Assignee and Owner pickers (both the dropdown rows and the selected value), the People hub cards, and the person's page — replacing the earlier muted-grey "You" hint.
- Native plugin settings gain **Your name** and **Your aliases** fields. These set only a per-device convenience default that prefills the "Your name" prompt when you create a new workspace; they never point at or edit any workspace's roster.
- Every **workspace template** now ships with short descriptions for its content: each Task, Project, Saved View, Dashboard, and taxonomy value (Status, Priority, Type, Label) explains itself in a sentence, so a freshly created workspace reads like a finished example rather than a bare scaffold.
- Template descriptions are authored entirely in the template's own markdown: taxonomy values use a `"Name (category, #hex) - description"` shorthand in the frontmatter, and Task/Project/View/Dashboard descriptions are written straight into the template body. The Getting Started and Agency templates also demonstrate `[[internal wikilinks]]`, external Markdown links, and sub-headings inside a description.
- The markdown template parser now reconciles those descriptions onto the taxonomy engine's `TaxonomyValue.description`, so template-provided statuses, priorities, types, and labels surface their descriptions in the taxonomy settings and editor UI exactly like ones configured by hand.
- **Activity history** — an optional, per-workspace log of everything that happens in a workspace, **off by default**. Opt in from **Settings → Activity history** or the **New workspace** template config; while enabled, every change is appended to a plain-Markdown log under the workspace's own `History/` folder — one file per month, one flow-YAML entry per action with a per-month sequence number — and each entry records who did it (the workspace's own person via the People `isSelf` entry, `[unknown]` when nobody is set up, or the reserved `[system]` actor for machine-driven writes such as the seeded onboarding log) plus the targets touched and field-level `from`/`to` deltas. The log is deliberately **activity history, not a formal audit log**: the files are plain text users can read and hand-edit, so it carries no compliance weight.
- A new **Activity History** hub (`g e`, or the sidebar / tab-strip row) presents the log two ways: a reverse-chronological **Feed** of day-grouped "who did what" cards, and a dense mono **Ledger** of one line per entry, month-grouped. Both views filter by **person**, **target kind**, or **action**, and the filter chips stay visible even when a filter empties the list so they can always be cleared. The log refreshes live — entries appear without switching tabs.
- Recording spans the whole lifecycle: task create/update/move/bulk-update, comment add/update/delete, project create/duplicate/update/delete, view and dashboard create/delete, taxonomy value deletion, restore and delete-forever, and workspace config changes/deletion/restoration.
- Workspace templates can opt into history with a `history: true` flag, and the **New workspace** config step shows a **Start with activity history on** toggle that follows the template. Workspaces created that way with the template's example content get their log seeded with a believable first month, matching the freshly generated projects, tasks, views, and dashboards, so the hub isn't empty on day one.

### Changed
- **Activity history log format redesigned for sync-safe multi-device vaults** — each Obsidian install now owns its own per-device stream files (`History/YYYY-MM.<device>.md`, device token in localStorage, never synced), eliminating the read-modify-write race that could drop entries when two machines share a synced vault (iCloud, Dropbox, iDrive). The reader merges all stream files sorted by `(timestamp, stream)`.
- **Sequence numbers removed** — per-stream timestamps are clamped monotonic (`max(now, last+1ms)`) so no two entries in a stream share a timestamp; ordering is by timestamp then stream.
- **"Who am I" is now per-device and per-workspace** — a shared vault has real collaborators, so a single global identity in the synced `data.json` was a correctness bug: whoever last saved their "me" setting silently overwrote everyone else's, corrupting `self` filter results and history-log attribution for the whole team. Identity now lives in the app's own `localStorage` (never the vault), keyed per workspace and prefixed with a stable per-vault id, exactly like the history log's per-device stream tokens. The `MeBinding` type and the `mePerson` plugin setting are gone; a leftover `mePerson` key in an existing `data.json` is ignored. The People register in `_workspace.md` stays plain (no `isSelf` flag) — the `*` template marker still seeds each new workspace its own self-person.
- **New workspaces always prompt for your name** — the "Your name" field in the template config step is always shown (prefilled from a per-device convenience default), rather than only appearing when no global identity existed. Cross-workspace identity adoption is gone; every workspace seeds its own self-person independently.
- **Recurrence editor redesign** — merged the two timing questions into a single "Next occurrence appears" control with clearer labels ("As soon as it's due" / "Only once I close it"); moved the live preview above the schedule fields; collapsed "Ends" by default with an "Add an end condition" toggle; added "Carries forward" chip group for per-field control over what copies into new occurrences; updated "Counts as closed when status is" to use "Completed" terminology; added children warning when spawning a task with sub-tasks.
- **Recurrence/spawn mutations** — new `recentlySpawned` guard set in `src/obsidian/mutations.ts` prevents stale snapshots from re-planning already-handled sources; `reconcileRecurrences()` drops confirmed successors from the set and deletes stale plans, with `nextInChain` now imported from `../core/recurrence`.
- **Recurring hub is one row per series** — the overview now surfaces only each chain's newest live occurrence (every spawned occurrence carries its own copy of the recurrence block, so it previously showed one row per occurrence ever created). Each row shows a plain-language schedule summary and splits its actions into **Edit** (opens the Repeat editor inline), **Open Task**, and **Stop**. Archived series drop off the list entirely.
- **Archived recurring tasks are dormant** — an archived task no longer spawns new occurrences while it's hidden, and the Repeat editor shows an "Archived — repeats paused" note. Un-archiving resumes the schedule.
- **Automated recurrence writes are attributed to `[system]`** — a spawned occurrence's Activity History entry is now credited to the reserved system actor (not whichever device ran the reconcile) and carries an explicit `spawned from` link to its predecessor. In a catch-up batch that backfills several missed dates at once, only the newest occurrence keeps a live schedule; the source's own block is cleared once it has spawned.
- **Recurrence ghosts on Calendar and Timeline** — projected (not-yet-spawned) occurrences now render as dashed, accent-tinted, italic-titled ghost rows on Calendar chips and the Timeline (label, lane, and a striped ghost bar), matching the List/Board treatment. Timeline scroll columns stay row-aligned via pinned `box-sizing`.
- **Stopping a series is explicit about scope** — the Stop confirmation now states that every task in the series, including occurrences already spawned, has its repeat schedule cleared (no files are removed).
- **The Recurring hub moved up the sidebar** — its nav row now sits directly below the People section (with its own divider) rather than down in the bottom utility band next to Trash, grouping it with the workspace's content surfaces instead of the app-level History / Trash / Help / Settings block.
- The workspace template gallery is **markdown-only** from now on: the last TypeScript-authored templates (`software-sprint`, `feedback-roadmap`, `personal-admin`) were removed, making `templates/*.md` the single authoring form.
- A brand-new task is created **untitled** instead of carrying a placeholder ("New task") or displaying its ID as a name. The editor opens with the title field focused so the name can be typed immediately — no mouse needed — and any surface that shows a task's name (list rows, board cards, the timeline, tabs, breadcrumbs, and the trash/nest dialogs) renders a greyed **Untitled task** for one with no title yet. The task ID stays a separate identity badge and is never substituted for the name; clearing a title now leaves it empty rather than restoring the ID.
- The sidebar's bottom band is now split by a divider into two groups: **History** and **Trash** (the workspace's records of what happened and what was deleted) above the line, and **Help** and **Settings** (app-level operations) below it.

### Fixed
- Recurrence spawn guard now correctly drops successors once a snapshot confirms they exist, preventing double-spawns across lagging trailing passes.
- **A new repeat on a dateless task no longer fires immediately.** Setting up an on-date repeat for a task with no start/due date seeded the first occurrence on today, so the very next reconcile spawned it right away; it now seeds one full cadence step out.
- **Recurrence create / edit / stop are now recorded in Activity History.** These edits went through `updateTask`, whose field diff deliberately excludes the nested `recurrence` block, so nothing was logged. Setting up, editing, or turning off a repeat — and stopping a whole series — each now write a single entry (`repeat set: …` / `repeat changed: … → …` / `repeat turned off`) via a new `Mutations.setRecurrence`; `stopRecurrence` logs once for the series rather than once per chain member. The Activity History hub also renders the `recurringFrom` delta on spawn entries as a resolved task ID ("spawned from TSK-5").
- **Projected ghost rows were indistinguishable from archived ones** (both just dimmed). The ghost divider is now a 1px dashed accent-tinted stroke on every side it has — including a top border on the first row of a run — and the ghost title is italic.
- **Tab keyboard shortcuts restored** — `TabSwitcher` was imported but never mounted, so Option/Alt+Tab tab cycling, Option/Alt+1–9 tab jump, and Option/Alt+W close-all did nothing. It's now mounted in the workspace shell alongside `PrefixEngine`.
- **Task-menu resize grips** — replaced the `clip-path: polygon()` triangles (only partially supported on the WebKit engine Obsidian Mobile/iOS uses) with a rounded-corner hatch square; the diagonal pattern and accent-on-hover are unchanged.
- Cleared Obsidian plugin-review lint flags: unnecessary type assertions in `history/diff.ts` and `me-storage.ts`, an unsafe `any` assignment in `parseHistoryLog`, a dead `MONTH_NAMES` constant in the recurrence engine, and deleted the superseded `RecurringOverviewModal` (the `g r` chord and "Recurring overview" command already route to the tab-based Recurring screen).
- **Recurring hub layout and actions** — the Recurring tab rendered as a fixed-width dialog card in the corner of the pane instead of a full-width browse hub; it now uses the shared `BrowseHeader`/`BrowseList`/`BrowseEmpty` layout like Trash, Labels, and History. "Open" on a row was passing the human-facing task ID to `openTask` (which expects a vault path) and now opens the correct task; "Stop" called a leftover `window.close()` and never ran the mutation — it now calls `plugin.mutations.stopRecurrence(...)` and closes the confirm. The `g r` chord and "Recurring overview" command still open the original modal, unchanged.
- Activity history hub now populates instantly (write-through chained appends retained; no debounce/batch).
- History log continues monotonic timestamps across sessions by reading existing device stream files on first write.
- **`self` / `me` filters now resolve in views.** The view context wasn't being given the current identity, so "Assigned to Me" / "Mentions Me" (and any `assignee:me` / `mentions:me` query) matched nothing in List, Board, Calendar, Timeline, the project/label/person detail views, and dashboards. Creating a task from an "Assigned to Me" view now also seeds the assignee. All of it repaints live when you change "me".
- The comment composer resolves "me" against the **task's own workspace** roster, not `plugin.activeWorkspace()` (the last-touched pane, which can be a different workspace than the task being commented on), and updates without reopening the editor.
- The People settings "Me" radio now sticks on the first click and the UI reflects it immediately (was a stale non-reactive read plus a mount-only debounce); typing in a person's name field no longer writes the workspace file on every keystroke.

- Task notes created from a workspace template no longer lose their description. They previously got a bare `## Description` heading, which the editor's description parser doesn't recognize — so freshly onboarded tasks showed an empty description even though the raw markdown was sitting in the file. Template ingestion now wraps the description in the same `PLUGIN_DESCRIPTION_START`/`PLUGIN_DESCRIPTION_END` block that notes created in-app (new-task dialog, description editor) use, keeps an author's sub-headings intact, and still appends the comments block beneath it.
- Activity history no longer skips whole classes of events: creating a workspace with history on records a `workspace.create` entry, and renaming a Saved View or Dashboard (or swapping its icon or description) now logs a `view.update`/`dashboard.update` instead of staying silent. Two writer bugs were also fixed — a seeded log now bumps the store revision so an open Activity History hub repaints, and a burst of entries written on top of an existing month's file keeps a correct, non-colliding sequence number instead of restarting or duplicating.

## 1.0.9 — 2026-09-05

### Added
- The color picker is now a shared app-wide component and ships a much richer palette: a reordered 48-color **Spectrum Matrix** (8 columns of vertical color families — neutrals, then Reds · Oranges · Yellows · Limes/Greens · Teals/Cyans · Blues · Indigos/Purples · Pinks/Magentas across five intensity rows) rendered in the taxonomy settings (statuses, priorities, task types) and the label editor.
- A **Custom Color** row below the swatch grid lets advanced users pick any raw color via the native color wheel or a typed hex code, styled as a matching square swatch; the popover stays open while dragging the native picker and commits the choice on dismissal.
- Hovering a color swatch now shows Obsidian's styled tooltip with its friendly name and hex (e.g. "Soft Red · #fca5a5"); the custom-color wheel shows the same when its hex lands on a preset, otherwise just the hex.

### Changed
- The **New workspace** screen's config step and the workspace **Settings → General** screen now let you pick the workspace's icon with the same searchable picker the Edit-workspace dialog already had — so you can set the icon at creation time or change it any time afterwards, not just via the edit-modal path.
- Renamed `TAXONOMY_PALETTE` to `COLOR_PALETTE` and moved it out of taxonomy scope into a shared `src/core/color.ts` module (all importers updated).
- Standardized the spelling of "Color" (was "Colour") across the UI and comments.
- Greatly widened the color popover and tightened its swatch grid so the 8 columns fit comfortably inside the box, with the inner trigger swatch properly centered.
- Removed every `!important` from `styles.css` (224 → 0). Button-chrome resets are now element-scoped (`button.vf-nav-row` instead of `.vf-nav-row`), multi-tag resets (`.vf-browse-card-body`, `.vf-crumb`, `.vf-filter-tag-face`) split so only their `<button>` form fights the base button rule, `<input>` chrome resets use `input.`, and the compact-mode drawers keep their exact widths without a forced override (sidebar clamps via `max-width`; the properties rail drops its inline width while drawn).
- The **New view**, **New dashboard**, and **New project** buttons — both in the sidebar ("+") and the browse hubs — now behave like **New label**/**New person**: pressing them opens the name + icon modal first, and the item is only created once you confirm, instead of pre-creating a blank item and opening its tab before asking what to call it.
- The **New view**, **New dashboard**, and **New project** create dialogs now also collect a **Description** — the app-wide Markdown control with its Live Preview/Source toggle — persisted to the view/dashboard frontmatter (or the project note body) when you confirm. The **Label** create/edit dialogs and the inline chip editor use the same Description control instead of a plain textarea. In dialogs the field is boxed and vertically resizable, so where it starts and stops is always clear; the pane-level Description sections keep the borderless, fixed-height note surface.

### Fixed
- The label description textarea used to be freely resizeable in both directions, letting users drag its right edge outside the dialog; it now resizes vertically only, keeping the dialog margins constant.
- Realigned the palette matrix so every column holds a single consistent color family (cyan/teal, blue, purple, and pink/magenta columns no longer mix hues).
- Color swatch hovers no longer show a duplicate browser `title` tooltip next to Obsidian's styled one (the palette's `aria-label` container label that could flash a stray "Color" tooltip near the Custom Color row was also removed).
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
