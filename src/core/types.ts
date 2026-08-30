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
 * just names and aliases. At most one entry should carry `isSelf`.
 */
export interface Person {
	id: string;
	name: string;
	aliases?: string[];
	isSelf?: boolean;
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

export interface Task {
	type: "task";
	id: string;
	title: string;
	taskType: string | null;
	status: string;
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

	/** Single assignee only. A `Person.id`. */
	assignee: string | null;
	/** Plain optional number, no enforced meaning. */
	estimate: number | null;
	labels: string[];
	startDate: IsoDate | null;
	dueDate: IsoDate | null;
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
	/** Reuses the Task status taxonomy — no separate system. */
	status: string;
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

export interface WorkspaceConfig {
	type: "workspace";
	name: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/** Must be unique vault-wide, not just per-workspace. */
	idPrefix: string;
	archiving: ArchivingConfig;
	/** Configurable independently of status category. */
	defaultNewTaskStatus: string;
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

/** Magic filter value resolving against the `people` entry with `isSelf`. */
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
