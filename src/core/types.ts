/**
 * Vertex Flow — core domain types.
 *
 * CLAUDE.md Golden Rule: nothing under `src/core/` may import the Obsidian API.
 * These types describe the *data*, not the files it lives in. The Obsidian glue
 * layer (`src/obsidian/`) is responsible for turning notes into these shapes.
 */

// ---------------------------------------------------------------------------
// Entity kinds
// ---------------------------------------------------------------------------

export type EntityType = "task" | "project" | "workspace";

/**
 * Every file-backed thing the vault index classifies into a `WorkspaceSnapshot`.
 *
 * Lives here rather than in `src/obsidian/index-store.ts` because it's a domain
 * concept, not a glue-layer detail — the index importing it from core is the
 * correct dependency direction. Views and Dashboards became file-backed (one
 * Markdown note each, under `Views/` / `Dashboards/`) alongside Tasks and
 * Projects; before that they were array entries inside shared config notes.
 */
export type EntityKind = "task" | "project" | "view" | "dashboard";

/**
 * The two synthetic, non-file items that still behave as first-class parts of
 * the model — the permanent "All Tasks" and "Untriaged" System Views. They're
 * injected into every workspace and never written to disk.
 */
export type SystemItemKind = "all-tasks" | "untriaged";

/** Every first-class thing in Vertex Flow's model, file-backed or synthetic. */
export type ItemKind = EntityKind | SystemItemKind;

/**
 * One item sitting in a workspace's `Trash/` folder — a Task/Project/View/
 * Dashboard whose deletion moved its file into `Workspace/Trash/<Kind>/` (with a
 * `vf-trashedAt` stamp) rather than into Obsidian's own trash. Lives here beside
 * `EntityKind` for the same reason: it's a domain concept the index populates,
 * not a glue-layer detail.
 */
export interface TrashedItem {
	kind: EntityKind;
	/** ISO datetime the item was moved into Trash (`vf-trashedAt`). */
	trashedAt: IsoDate;
	/**
	 * The fully parsed entity — the same `Task` / `Project` / `SavedView` /
	 * `DashboardConfig` shape it had while live, so the Trash hub can hand it
	 * straight to the card components the other hubs use.
	 */
	entity: Task | Project | SavedView | DashboardConfig;
}

/**
 * A vault-relative path to a note, e.g. `Product Team/Tasks/PRD-0104`.
 * Stored in frontmatter as a wikilink; normalized to a bare target internally.
 * See `links.ts`.
 */
export type LinkTarget = string;

/** ISO-8601 date (`2026-08-28`) or datetime (`2026-08-26T14:45:00Z`). */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Taxonomy — one engine, four configurations
// ---------------------------------------------------------------------------

/**
 * The fixed Status category enum. Invisible to users; drives all logic
 * (progress calculation, "is this active" filtering, board grouping). Users may
 * rename and recolor their statuses freely — the category underneath never
 * changes. A category may legitimately have zero statuses.
 */
export type StatusCategory =
	| "backlog"
	| "unstarted"
	| "started"
	| "completed"
	| "canceled";

export const STATUS_CATEGORIES: readonly StatusCategory[] = [
	"backlog",
	"unstarted",
	"started",
	"completed",
	"canceled",
] as const;

/** The four taxonomy instances the generic engine is configured as. */
export type TaxonomyKind = "status" | "priority" | "taskType" | "label";

/** Base shape shared by every taxonomy value in every taxonomy. */
export interface TaxonomyValue {
	id: string;
	name: string;
	color: string;
	/** Present only on ordered taxonomies (status, priority). */
	order?: number;
	/** Present only on categorized taxonomies (status). */
	category?: StatusCategory;
	/** Optional free text. Currently only surfaced in the UI for labels. */
	description?: string;
}

export interface StatusValue extends TaxonomyValue {
	order: number;
	category: StatusCategory;
}

export interface PriorityValue extends TaxonomyValue {
	order: number;
}

export type TaskTypeValue = TaxonomyValue;
export type LabelValue = TaxonomyValue;

/**
 * Lightweight register for `@mentions` and `assignee`. No auth —
 * just names and aliases. *Who "me" is* is not stored here, and is not a global
 * plugin setting: it's a per-device, per-workspace `personId` held in the app's
 * own `localStorage` (never in the vault) — see `src/obsidian/me-storage.ts` —
 * that resolves against this roster by id.
 */
export interface Person {
	id: string;
	name: string;
	aliases?: string[];
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/** Task relations — cross-cutting association without multiple parents. */
export interface TaskRelations {
	blocks: LinkTarget[];
	blockedBy: LinkTarget[];
	related: LinkTarget[];
	duplicateOf: LinkTarget | null;
}

export function emptyRelations(): TaskRelations {
	return { blocks: [], blockedBy: [], related: [], duplicateOf: null };
}

// ---------------------------------------------------------------------------
// Recurring tasks
// ---------------------------------------------------------------------------

/** When a series spawns its successor. */
export type RecurrenceTrigger = "on-close" | "on-date";

/** The cadence unit of a recurrence. */
export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** Which date field an occurrence's day is anchored to. */
export type RecurrenceAnchor = "dueDate" | "startDate";

/**
 * Lowercase short weekday names — the canonical encoding for a weekly
 * cadence. `["mon", "wed", "fri"]` reads better in frontmatter than day
 * numbers, and a human can hand-edit it without a decoder ring.
 */
export type Weekday =
	| "sun"
	| "mon"
	| "tue"
	| "wed"
	| "thu"
	| "fri"
	| "sat";

export const WEEKDAYS: readonly Weekday[] = [
	"sun",
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
] as const;

/**
 * The flat, durable recurrence definition — a data block with a documented
 * frontmatter shape rather than an object graph, because it's carried forward,
 * node by node, down a chain of spawned notes.
 *
 * `trigger` decides *what* fires the next occurrence, `freq`/`interval`/...
 * decide *when* it lands, and `endsAfter`/`endsOn` decide when the series
 * stops. `triggerStatus` is independent of frequency: a series can recur on a
 * mid-flow status (e.g. "when Review lands") without ever being Completed.
 */
export type TaskFieldKey =
	| "priority"
	| "taskType"
	| "assignee"
	| "estimate"
	| "labels"
	| "description"
	| "project"
	| "parent";

export interface RecurrenceConfig {
	trigger: RecurrenceTrigger;
	/**
	 * For `on-close`: the status that fires the next occurrence. `null` means
	 * "any status in the completed category". For `on-date`: unused (`null`).
	 */
	triggerStatus: string | null;
	freq: RecurrenceFrequency;
	/** Cadence multiplier — every `interval` days, weeks, months or years. */
	interval: number;
	/**
	 * Weekly-only: the weekdays within each week that can carry an occurrence.
	 * `[]` (the default) means the seed task's own weekday. Only honored at
	 * `interval === 1`; a multi-week cadence steps whole weeks from the seed
	 * (see `nextOccurrence`), so there's no week-block phase to drift.
	 */
	weekdays: Weekday[];
	/** Monthly "on the Nth day of the month". Mutually exclusive with `weekdayOfMonth`. */
	dayOfMonth: number | null;
	/** Monthly "on the Nth <weekday> of the month" (1-based). */
	weekdayOfMonth: number | null;
	/** Yearly: the month an annual recurrence lands in (1–12). */
	monthOfYear: number | null;
	/**
	 * Which date field the occurrence day drives. With both dates set, the
	 * source's range is shifted so this field lands on the occurrence day.
	 */
	anchor: RecurrenceAnchor;
	/** The status a spawned occurrence starts in; `null` = workspace default. */
	newStatus: string | null;
	/**
	 * Total occurrences the series yields *including* the node carrying this
	 * block. The chain halts once its length reaches this number.
	 * `null` = open-ended.
	 */
	endsAfter: number | null;
	/** No occurrence lands strictly after this date. `null` = no such limit. */
	endsOn: IsoDate | null;
	/** The next date this node should fire (On date) or land (On close) on. */
	nextDate: IsoDate;
	/**
	 * Which fields to copy from the source task when spawning the next
	 * occurrence. `null` (the default, and the value for all pre-existing
	 * blocks) means "copy everything." Title, Project, and Parent are never
	 * toggleable — they are always copied. Only the fields listed in
	 * `TaskFieldKey` can be opted out of.
	 */
	copyFields: TaskFieldKey[] | null;
}

export interface Task {
	type: "task";
	id: string;
	title: string;
	taskType: string | null;
	/** Status id. `null` when the workspace has no configured status. */
	status: string | null;
	priority: string | null;
	/** LexoRank — global default order. Always present. */
	rank: string;

	/**
	 * Exactly one primary parent (Golden Rule). `project` attaches the task to a
	 * Project; `parent` makes this a sub-task of another Task. A task with
	 * neither is unparented.
	 */
	project: LinkTarget | null;
	parent: LinkTarget | null;

	/**
	 * The task this occurrence was spawned from, when it's part of a recurring
	 * series. `null` on a non-recurring task and on the series' first note.
	 * This link is the chain: it never auto-updates, and a note keeps its
	 * ancestry even after the series is stopped, so the history reads.
	 */
	recurringFrom: LinkTarget | null;

	/** Single assignee only. A `Person.id`. */
	assignee: string | null;
	/** Plain optional number, no enforced meaning. */
	estimate: number | null;
	labels: string[];
	startDate: IsoDate | null;
	dueDate: IsoDate | null;
	/**
	 * The live recurrence schedule on this node. `null` on an ordinary task, on
	 * a stopped node, and on the terminal occurrence of a finite series.
	 * Successor occurrences carry an advanced copy of the block.
	 */
	recurrence: RecurrenceConfig | null;
	/** Visibility flag, not a status and not a location. */
	archived: boolean;
	archivedAt: IsoDate | null;
	relations: TaskRelations;
	createdAt: IsoDate;
	updatedAt: IsoDate;

	// --- Derived at index time; never written to frontmatter. -----------------

	/** Vault-relative path of the note backing this task. */
	path: LinkTarget;
	/** `Person.id`s @mentioned in the body/comments — powers `mentions: self`. */
	mentions: string[];

	/**
	 * A speculative future occurrence of a recurring series, synthesised by
	 * `projectRecurrences` for the `show:recurring` preview. Never a real note,
	 * never serialized, never a drag/rank/select target — a ghost row. Its
	 * `path` is synthetic (`<source>/occ/N`) and `recurringFrom` points at the
	 * chain member it was projected from.
	 */
	projected?: boolean;
}

/** A flat, unthreaded comment stored in the body's delimited block. */
export interface Comment {
	id: string;
	author: string;
	date: IsoDate;
	body: string;
	/** Emoji → count, e.g. `{ "👍": 2 }`. */
	reactions: Record<string, number>;
}

/**
 * A Task plus its note body. The index holds bare `Task` records for speed;
 * the full document is loaded only when a task is actually opened.
 */
export interface TaskDocument {
	task: Task;
	description: string;
	comments: Comment[];
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
	type: "project";
	title: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/** Reuses the Task status taxonomy — no separate system. `null` is "None". */
	status: string | null;
	/** Reuses the Task priority taxonomy — no separate system. `null` is "None". */
	priority: string | null;
	/** Reuses the Task label taxonomy/engine, multi-select. */
	labels: string[];
	startDate: IsoDate | null;
	dueDate: IsoDate | null;
	/**
	 * A `Person.id`. Deliberately `owner`, not `assignee`: a project isn't worked
	 * by one person the way a task is — this is "who's accountable for it," not
	 * "who's doing it." Same underlying control as Task's assignee.
	 */
	owner: string | null;
	/** Visibility flag, not a status and not a location. */
	archived: boolean;
	archivedAt: IsoDate | null;
	createdAt: IsoDate;
	updatedAt: IsoDate;
	path: LinkTarget;
	/**
	 * The embedded task-list viewport's saved sort/group/filter settings —
	 * absent until the user hits Save there at least once. `projectView()`
	 * (`ui/App.tsx`) merges this over its hardcoded defaults. No migration
	 * concern: older projects simply have none.
	 */
	view?: ViewDefinition | null;
}

/**
 * A Project plus its note body. The index holds bare `Project` records — the
 * full document is loaded only when a project is actually opened in the editor,
 * exactly mirroring `TaskDocument`.
 *
 * Unlike a Task, a Project has no comments block, so `description` is simply the
 * whole body, trimmed — there's nothing to split around. `description` is *not*
 * a frontmatter field, and deliberately not part of the bare `Project` type:
 * `Project` rides in every `WorkspaceSnapshot` and feeds filtering/grouping/
 * Browse cards, so it stays lean.
 */
export interface ProjectDocument {
	project: Project;
	description: string;
}

// ---------------------------------------------------------------------------
// Workspace config
// ---------------------------------------------------------------------------

export interface ArchivingConfig {
	/** Manual archiving is the real v1 feature; this defaults to off. */
	autoArchiveEnabled: boolean;
	autoArchiveDays: number;
}

/**
 * Per-workspace opt-in activity history. Lives on the workspace config (like
 * `archiving`) because recording is a property of the *workspace*, not of any
 * single entity. The log itself is append-only Markdown under the workspace's
 * own `History/` folder — see `src/core/history/` and the `HistoryLog` glue.
 */
export interface HistoryConfig {
	/**
	 * Off by default, and phrasing around this is deliberate: the log is
	 * "activity history", not a formal audit log — it's a hand-editable local
	 * file, so it can't borrow compliance authority.
	 */
	enabled: boolean;
}

/**
 * Who performed an action. A person is resolved from the workspace `people`
 * roster by the device's per-workspace "me" personId (there's no login, so "the
 * person holding the mouse"). `system` is reserved for machine-initiated
 * writes — the auto-archive sweep, a future recurring-task engine — never a
 * human action wearing a costume.
 */
export type HistoryActor =
	| { kind: "person"; id: string; name: string }
	| { kind: "system"; name: string };

/** What an action touched. Kinds mirror the entity/`EntityType` taxonomy; the
 *  extra `"workspace"` covers the config note itself. */
export type HistoryTargetKind = EntityKind | "workspace";

export interface HistoryTarget {
	kind: HistoryTargetKind;
	/** Task id, view/dashboard id, project title, or workspace root. */
	id: string;
	/** Vault path at the time of the action (a trashed path for a delete). */
	path: string;
}

/** One observed field delta in an entry's `changes`. `from`/`to` are JSON-ish
 *  values (strings, numbers, booleans, arrays); omitted when unsavoury (e.g. a
 *  body diff, or the LexoRank juggling behind a drag). */
export interface HistoryChange {
	field: string;
	from?: unknown;
	to?: unknown;
}

/**
 * One appended, immutable line in a workspace's history log. There is no
 * sequence number: within a stream the writer enforces a strictly increasing
 * `ts`, and across streams the reader orders by `ts` then file name — the
 * timestamp is the timeline, and a shared log is at bottom a merge of clocks.
 */
export interface HistoryEntry {
	/** ISO datetime the action happened — strictly increasing within a stream. */
	ts: IsoDate;
	actor: HistoryActor;
	action: string;
	/**
	 * The workspace root at the time of the action — the file already lives
	 * under that root's `History/` folder, so this is belt-and-braces for a
	 * log that gets copied somewhere or viewed out of context.
	 */
	workspace: string;
	targets: HistoryTarget[];
	changes?: HistoryChange[];
}

export interface WorkspaceConfig {
	type: "workspace";
	name: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/** Must be unique vault-wide, not just per-workspace. */
	idPrefix: string;
	archiving: ArchivingConfig;
	history: HistoryConfig;
	/** Configurable independently of status category. `null` when no status is defined. */
	defaultNewTaskStatus: string | null;
	/** Cosmetic suffix only — the plugin never calculates on estimates. */
	estimateUnitLabel: string | null;

	/**
	 * Set when the workspace has been soft-deleted: it stays on disk (its own
	 * `Trash/` folder can't be moved into itself) but is hidden from the
	 * switcher. Deliberately *not* named `archived`/`archivedAt` — `archiving`
	 * above is an unrelated task-auto-archive concept. `null` when live.
	 */
	deletedAt: IsoDate | null;

	statuses: StatusValue[];
	priorities: PriorityValue[];
	taskTypes: TaskTypeValue[];
	labels: LabelValue[];
	people: Person[];

	/** Derived: the folder this workspace's `_workspace.md` lives in. */
	root: string;
}

// ---------------------------------------------------------------------------
// Saved Views
// ---------------------------------------------------------------------------

/**
 * List and Board are v1; Timeline (Gantt) and Calendar follow. The graph
 * view is still phased in later.
 */
export type ViewType = "list" | "board" | "timeline" | "calendar";

export type GroupByField =
	| "none"
	| "status"
	| "priority"
	| "taskType"
	| "assignee"
	| "project"
	| "label";

export type SortField =
	| "rank"
	| "priority"
	| "status"
	| "title"
	| "dueDate"
	| "startDate"
	| "estimate"
	| "createdAt"
	| "updatedAt";

export type SortDirection = "asc" | "desc";

/**
 * How a view treats sub-tasks:
 *   - `nested` — indented under their parent, with a disclosure toggle (List only;
 *      other layouts fall back to `flat`).
 *   - `flat`   — loose rows alongside top-level tasks, marked with `↳`.
 *   - `hidden` — sub-tasks are dropped from the view entirely.
 *
 * Replaces the old `filters.topLevelOnly` boolean; a saved view carrying that
 * flag migrates to `hidden` on read.
 */
export const SUBTASK_DISPLAYS = ["nested", "flat", "hidden"] as const;
export type SubtaskDisplay = (typeof SUBTASK_DISPLAYS)[number];

/** Magic filter value resolving against the device's per-workspace "me" personId. */
export const SELF = "self";

/** Magic filter value matching tasks where the field is unset. */
export const NONE = "__none__";

export interface ViewFilters {
	status?: string[];
	priority?: string[];
	taskType?: string[];
	labels?: string[];
	assignee?: string[];
	project?: string[];
	parent?: string[];
	/** `[SELF]` powers the "Mentions Me" saved view. */
	mentions?: string[];
	/** Free-text match against title. */
	text?: string;
	/**
	 * Archived-task visibility. Defaults to hidden. `"included"` mixes archived
	 * tasks in with everything else; `"only"` filters to just them.
	 */
	archived?: "included" | "only";
	/** Only tasks whose status isn't Completed or Canceled (per taxonomy category). */
	openOnly?: boolean;
	/** Only tasks with neither a dueDate nor a startDate set. */
	unscheduled?: boolean;
	/** Only tasks carrying a live recurrence definition. */
	recurring?: boolean;
}

/** Per-Saved-View, not global. */
export type EmptyColumnBehavior = "show-normal" | "auto-collapse" | "auto-hide";

export interface ViewColumnState {
	collapsed: string[];
	hidden: string[];
}

/**
 * Per-session Timeline chrome: current zoom and horizontal scroll position.
 *
 * Persisted to the view's note but deliberately **not** part of `ViewDefinition` —
 * same treatment as `columns`. Panning or zooming the timeline writes
 * straight through and never marks the view unsaved.
 *
 * `scale` is pixels-per-day. The named zoom presets (Day/Week/Month/Quarter/
 * Year) are just scale values chosen in the UI layer; the "All" preset is
 * computed from the visible date range at render time and never stored.
 */
export interface ViewTimelineState {
	scale: number;
	/** Date pinned to the left edge of the scroll pane, or null for "not set". */
	scrollDate: IsoDate | null;
}

/**
 * Per-session Calendar chrome: which month the grid is showing.
 *
 * Persisted to the view's note but, like `ViewTimelineState`, deliberately **not**
 * part of `ViewDefinition` — paging between months writes straight
 * through and never marks the view unsaved. Always normalised to the 1st of the
 * month (`startOfMonth`) whenever it's written, so `visibleMonth` has one
 * canonical representation. `null` means "not set" — the view falls back to the
 * month containing today.
 *
 * The date field the grid buckets by is *not* here — that's `calendarDateField`
 * on `SavedView`, which is definitional (it changes what the view shows) and
 * flows through the normal draft/Save cycle.
 */
export interface ViewCalendarState {
	visibleMonth: IsoDate | null;
}

/**
 * Task fields a Saved View can hide from its rows/cards.
 *
 * Status icon, Task ID and Task title are mandatory and never members here.
 * `type` only renders on Board cards; other layouts ignore an entry they can't
 * show. Order is canonical — `canonicalizeHiddenFields` sorts into it.
 *
 * The list stores what's *hidden*, so a view written before a field existed
 * keeps working — but it also means a newly added field switches itself on
 * everywhere. Where that would be pure noise, suppress it contextually rather
 * than migrating every saved view (see `renderedHiddenFields`).
 */
export const TASK_FIELDS = [
	"type",
	"project",
	"priority",
	"assignee",
	"labels",
	"estimate",
	"startDate",
	"dueDate",
	"progress",
	"relations",
] as const;
export type TaskField = (typeof TASK_FIELDS)[number];

export interface SavedView {
	/** Discriminant — this is a `Views/<id>.md` note. */
	type: "view";
	/** Vault path of the backing note (`<root>/Views/<id>`), extension-less. */
	path: string;
	id: string;
	name: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/**
	 * Free-text note about what this view is for. Metadata, not part of
	 * `ViewDefinition` — editing it never marks the view unsaved, same as `name`
	 * and `icon`. Stored as a plain frontmatter string in the view's note.
	 */
	description?: string;
	viewType: ViewType;
	filters: ViewFilters;
	groupBy: GroupByField;
	sortBy: SortField;
	sortDirection: SortDirection;
	columns: ViewColumnState;
	emptyColumnBehavior: EmptyColumnBehavior;
	/** Task fields hidden from this view's rows/cards; `[]` shows all. */
	hiddenFields: TaskField[];
	/**
	 * How this view treats sub-tasks. Definitional — it changes what the
	 * view shows — so it rides in `ViewDefinition` and the draft/Save cycle.
	 */
	subtaskDisplay: SubtaskDisplay;
	/**
	 * Which date field the Calendar view buckets tasks by. Definitional (it
	 * changes what the view shows), so it participates in `ViewDefinition` and
	 * the draft/Save cycle — not furniture like `calendar` below.
	 */
	calendarDateField: "dueDate" | "startDate";
	/**
	 * Whether the Calendar and Timeline render this view's recurrences as
	 * projected, not-yet-created future occurrences. Definitional — it changes
	 * what the view shows — so it rides in `ViewDefinition` and the draft/Save
	 * cycle rather than writing through like `calendar` chrome. Projections are
	 * read-only: they preview, they never (and cannot) mutate the chain.
	 */
	recurringPreview: boolean;
	/**
	 * Timeline zoom/scroll chrome — present only once the view has been opened
	 * as a timeline and panned or zoomed. Excluded from `ViewDefinition`, like
	 * `columns`.
	 */
	timeline?: ViewTimelineState;
	/**
	 * Calendar visible-month chrome — present only once the view has been opened
	 * as a calendar and paged off its default month. Excluded from
	 * `ViewDefinition`, like `columns` and `timeline`.
	 */
	calendar?: ViewCalendarState;
}

/**
 * What a view *is*, as opposed to what it's called and where its columns sit.
 *
 * This is the unit the text query language round-trips (`core/query`) and the
 * unit `useViewDraft` compares to decide whether a view is unsaved — one
 * definition of "the same view" rather than two that can drift. `name`, `icon`
 * and `id` are identity; `columns`, `timeline` and `calendar` are per-session
 * furniture that writes straight through to disk.
 */
export type ViewDefinition = Pick<
	SavedView,
	| "filters"
	| "viewType"
	| "groupBy"
	| "sortBy"
	| "sortDirection"
	| "emptyColumnBehavior"
	| "hiddenFields"
	| "subtaskDisplay"
	| "calendarDateField"
	| "recurringPreview"
>;

// ---------------------------------------------------------------------------
// Dashboards (§Dashboards Phase 1)
// ---------------------------------------------------------------------------

/**
 * The chart kinds a dashboard widget can be. `timeline` here is a chart type
 * (cumulative area over time), unrelated to the Timeline/Gantt *view*.
 */
export type ChartType = "bar" | "line" | "pie" | "timeline" | "kpi";

export const CHART_TYPES: readonly ChartType[] = [
	"bar",
	"line",
	"pie",
	"timeline",
	"kpi",
] as const;

/** Discrete fields a bar/pie/line-grouping/kpi-scope can group or scope by. */
export type DashboardGroupingField =
	| "status"
	| "priority"
	| "taskType"
	| "label"
	| "assignee"
	| "project";

export const DASHBOARD_GROUPING_FIELDS: readonly DashboardGroupingField[] = [
	"status",
	"priority",
	"taskType",
	"label",
	"assignee",
	"project",
] as const;

/** X-axis fields a line/timeline chart can plot against. */
export type DashboardTemporalField = "dueDate" | "startDate" | "createdAt";

export const DASHBOARD_TEMPORAL_FIELDS: readonly DashboardTemporalField[] = [
	"dueDate",
	"startDate",
	"createdAt",
] as const;

/** How a line/timeline chart buckets its temporal axis. */
export type DashboardTimeBucket = "day" | "week" | "month";

export const DASHBOARD_TIME_BUCKETS: readonly DashboardTimeBucket[] = [
	"day",
	"week",
	"month",
] as const;

/**
 * What a KPI widget measures. `count` is the task count; the two `estimate`
 * aggregates sum/average the plain `estimate` number — the plugin does no
 * other math on it.
 */
export type DashboardMetric = "count" | "estimateSum" | "estimateAvg";

export const DASHBOARD_METRICS: readonly DashboardMetric[] = [
	"count",
	"estimateSum",
	"estimateAvg",
] as const;

/**
 * A single discrete predicate a KPI can be scoped to — e.g. `status === "done"`.
 * `value` is a taxonomy id, `Person.id`, project link target, or the `NONE`
 * sentinel; for `label` it matches tasks carrying that label.
 */
export interface DashboardScope {
	field: DashboardGroupingField;
	value: string;
}

export interface BarFieldMapping {
	chartType: "bar";
	groupBy: DashboardGroupingField;
}

export interface PieFieldMapping {
	chartType: "pie";
	groupBy: DashboardGroupingField;
}

export interface LineFieldMapping {
	chartType: "line";
	xField: DashboardTemporalField;
	bucket: DashboardTimeBucket;
	/** Optional secondary split into one series per discrete value. */
	groupBy: DashboardGroupingField | null;
}

export interface TimelineFieldMapping {
	chartType: "timeline";
	xField: DashboardTemporalField;
	bucket: DashboardTimeBucket;
	groupBy: DashboardGroupingField | null;
}

export interface KpiFieldMapping {
	chartType: "kpi";
	metric: DashboardMetric;
	/** Optional single discrete predicate narrowing which tasks are counted. */
	scope: DashboardScope | null;
}

/**
 * Shape depends on `chartType` — a discriminated union so an invalid
 * chart-type/field combination is unrepresentable (the config popover derives
 * its options from the compatibility matrix in `core/dashboards/compat`).
 */
export type DashboardFieldMapping =
	| BarFieldMapping
	| PieFieldMapping
	| LineFieldMapping
	| TimelineFieldMapping
	| KpiFieldMapping;

export interface DashboardWidgetLayout {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface DashboardWidget {
	id: string;
	chartType: ChartType;
	/** User-editable; an auto-generated default until `titleIsCustom`. */
	title: string;
	/** True once the user has renamed it — auto-titles never overwrite it. */
	titleIsCustom: boolean;
	fieldMapping: DashboardFieldMapping;
	layout: DashboardWidgetLayout;
}

export interface DashboardConfig {
	/** Discriminant — this is a `Dashboards/<id>.md` note. */
	type: "dashboard";
	/** Vault path of the backing note (`<root>/Dashboards/<id>`), extension-less. */
	path: string;
	id: string;
	name: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/**
	 * Free-text note about what this dashboard is for. Metadata, exactly like
	 * `SavedView.description` — not part of any definitional comparison.
	 */
	description?: string;
	widgets: DashboardWidget[];
	/**
	 * Dashboard-wide filter, applied once at the top-level data fetch (Phase 1 —
	 * widgets have no independent filters). Reuses `ViewFilters` so the filter
	 * bar shares the List/Board filter UI and the query engine wholesale.
	 */
	filters: ViewFilters;
}

export interface WorkspaceDashboards {
	dashboards: DashboardConfig[];
}

// ---------------------------------------------------------------------------
// Index snapshot
// ---------------------------------------------------------------------------

/**
 * Every entity in one Workspace, as the Obsidian glue layer indexed it.
 * Core logic takes this as a plain value — it has no idea files exist.
 */
export interface WorkspaceSnapshot {
	workspace: WorkspaceConfig;
	tasks: Task[];
	projects: Project[];
	views: SavedView[];
	dashboards: DashboardConfig[];
	/** Items sitting in this workspace's `Trash/` folder (see `TrashedItem`). */
	trash: TrashedItem[];
}

// ---------------------------------------------------------------------------
// Derived / computed shapes
// ---------------------------------------------------------------------------

/**
 * Completion rollup. Computed, never stored — and never auto-synced
 * back into a status in either direction.
 */
export interface Progress {
	total: number;
	completed: number;
	started: number;
	canceled: number;
	/** 0–100, counting completed against non-canceled total. */
	percent: number;
}

export function emptyProgress(): Progress {
	return { total: 0, completed: 0, started: 0, canceled: 0, percent: 0 };
}

/** A group of tasks produced by view evaluation. */
export interface TaskGroup {
	/** Taxonomy value id, link target, person id, or `NONE`. */
	key: string;
	label: string;
	color: string | null;
	tasks: Task[];
	collapsed: boolean;
	hidden: boolean;
}
