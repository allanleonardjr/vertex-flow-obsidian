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
 * A vault-relative path to a note, e.g. `Product Team/Tasks/PRD-0104`.
 * Stored in frontmatter as a wikilink; normalized to a bare target internally.
 * See `links.ts`.
 */
export type LinkTarget = string;

/** ISO-8601 date (`2026-08-28`) or datetime (`2026-08-26T14:45:00Z`). */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Taxonomy (§5) — one engine, four configurations
// ---------------------------------------------------------------------------

/**
 * The fixed Status category enum (§5.1). Invisible to users; drives all logic
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
 * Lightweight register for `@mentions` and `assignee` (§5.5). No auth —
 * just names and aliases. At most one entry should carry `isSelf`.
 */
export interface Person {
	id: string;
	name: string;
	aliases?: string[];
	isSelf?: boolean;
}

// ---------------------------------------------------------------------------
// Task (§4.1)
// ---------------------------------------------------------------------------

/** Task relations (§7.3) — cross-cutting association without multiple parents. */
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
	/** LexoRank — global default order (§6). Always present. */
	rank: string;

	/**
	 * Exactly one primary parent (Golden Rule). `project` attaches the task to a
	 * Project; `parent` makes this a sub-task of another Task. A task with
	 * neither is unparented.
	 */
	project: LinkTarget | null;
	parent: LinkTarget | null;

	/** Single assignee only (§7.4). A `Person.id`. */
	assignee: string | null;
	/** Plain optional number, no enforced meaning (§5.4). */
	estimate: number | null;
	labels: string[];
	startDate: IsoDate | null;
	dueDate: IsoDate | null;
	/** Visibility flag, not a status and not a location (§7.7). */
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

/** A flat, unthreaded comment stored in the body's delimited block (§4.1). */
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
// Project (§4.2)
// ---------------------------------------------------------------------------

export interface Project {
	type: "project";
	title: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/** Reuses the Task status taxonomy (§5.1) — no separate system. */
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
	 * "who's doing it." Same underlying control as Task's assignee (§7.4).
	 */
	owner: string | null;
	/** Visibility flag, not a status and not a location (§7.7). */
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
// Workspace config (§4.5)
// ---------------------------------------------------------------------------

export interface ArchivingConfig {
	/** Manual archiving is the real v1 feature; this defaults to off (§7.7). */
	autoArchiveEnabled: boolean;
	autoArchiveDays: number;
}

export interface WorkspaceConfig {
	type: "workspace";
	name: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/** Must be unique vault-wide, not just per-workspace (§3). */
	idPrefix: string;
	archiving: ArchivingConfig;
	/** Configurable independently of status category (§5.1). */
	defaultNewTaskStatus: string;
	/** Cosmetic suffix only — the plugin never calculates on estimates (§5.4). */
	estimateUnitLabel: string | null;

	statuses: StatusValue[];
	priorities: PriorityValue[];
	taskTypes: TaskTypeValue[];
	labels: LabelValue[];
	people: Person[];

	/** Derived: the folder this workspace's `_workspace.md` lives in. */
	root: string;
}

// ---------------------------------------------------------------------------
// Saved Views (§4.6, §8.3)
// ---------------------------------------------------------------------------

/**
 * List and Board are v1; Timeline (Gantt) and Calendar follow (§8.1). The graph
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
	/** `[SELF]` powers the "Mentions Me" saved view (§7.6). */
	mentions?: string[];
	/** Free-text match against title. */
	text?: string;
	/** Defaults to hiding archived tasks (§7.7). */
	includeArchived?: boolean;
	/** Only tasks with no parent Task — i.e. hide sub-tasks from top level. */
	topLevelOnly?: boolean;
}

/** Per-Saved-View, not global (§8.2). */
export type EmptyColumnBehavior = "show-normal" | "auto-collapse" | "auto-hide";

export interface ViewColumnState {
	collapsed: string[];
	hidden: string[];
}

/**
 * Per-session Timeline chrome: current zoom and horizontal scroll position.
 *
 * Persisted to `_views.md` but deliberately **not** part of `ViewDefinition` —
 * same treatment as `columns` (§4.6). Panning or zooming the timeline writes
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
 * Persisted to `_views.md` but, like `ViewTimelineState`, deliberately **not**
 * part of `ViewDefinition` (§4.6) — paging between months writes straight
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
 * Task fields a Saved View can hide from its rows/cards (§8.4).
 *
 * Status icon, Task ID and Task title are mandatory and never members here.
 * `type` only renders on Board cards; other layouts ignore an entry they can't
 * show. Order is canonical — `canonicalizeHiddenFields` sorts into it.
 */
export const TASK_FIELDS = [
	"type",
	"priority",
	"assignee",
	"labels",
	"dueDate",
	"progress",
	"relations",
] as const;
export type TaskField = (typeof TASK_FIELDS)[number];

export interface SavedView {
	id: string;
	name: string;
	/** Curated icon id (see `ui/components/Icon.tsx`); optional, falls back at render. */
	icon?: string;
	/**
	 * Free-text note about what this view is for. Metadata, not part of
	 * `ViewDefinition` — editing it never marks the view unsaved, same as `name`
	 * and `icon`. Stored as a plain frontmatter string in `_views.md`.
	 */
	description?: string;
	viewType: ViewType;
	filters: ViewFilters;
	groupBy: GroupByField;
	sortBy: SortField;
	sortDirection: SortDirection;
	columns: ViewColumnState;
	emptyColumnBehavior: EmptyColumnBehavior;
	/** Task fields hidden from this view's rows/cards (§8.4); `[]` shows all. */
	hiddenFields: TaskField[];
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
	| "calendarDateField"
>;

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
}

// ---------------------------------------------------------------------------
// Derived / computed shapes
// ---------------------------------------------------------------------------

/**
 * Completion rollup. Computed, never stored (§4.2) — and never auto-synced
 * back into a status in either direction (§7.1, §7.2).
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
