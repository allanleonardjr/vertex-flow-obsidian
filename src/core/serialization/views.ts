/**
 * `Views/<id>.md` — one Saved View definition per note.
 *
 * The whole definitional half of a view (`filters`, `viewType`, `groupBy`,
 * `sortBy`/`sortDirection`, `emptyColumnBehavior`, `hiddenFields`,
 * `subtaskDisplay`, `calendarDateField`, `recurringPreview`) is persisted as a
 * single `query:` string — the same text the Query Bar round-trips
 * (`core/query`'s `printQuery`/`parseQuery`). Identity (`name`/`icon`/
 * `description`) and per-session chrome (`columns`/`timeline`/`calendar`) keep
 * their own keys.
 *
 * `parseLegacyViewValue`/`parseLegacyViewDefinition` read the retired structured
 * shape and exist only for the one-time migration (`_views.md` array split, and
 * the per-file `query:` cutover in `VaultIndex`). Nothing on the live path calls
 * them.
 */

import { basename, parseLink } from "../links";
import { canonicalizeHiddenFields, viewDefinition } from "../views/filter";
import {
	parseQuery,
	printQuery,
	emptyQueryContext,
	type QueryContext,
} from "../query";
import {
	CANVAS_RELATION_KINDS,
	SUBTASK_DISPLAYS,
	TASK_FIELDS,
	type CanvasRelationKind,
	type EmptyColumnBehavior,
	type GroupByField,
	type ProjectViewSettings,
	type SavedView,
	type SortField,
	type SubtaskDisplay,
	type ViewCalendarState,
	type ViewDefinition,
	type ViewFilters,
	type ViewTimelineState,
	type ViewType,
} from "../types";
import {
	IssueLog,
	asBoolean,
	asDate,
	asNumber,
	asString,
	asStringArray,
	asRecord,
	compact,
	type ParseResult,
} from "./coerce";

const VIEW_TYPES: ViewType[] = [
	"list",
	"board",
	"timeline",
	"calendar",
	"canvas",
];

/**
 * Canvas (DAG) layout direction, normalised onto `"right"`/`"down"`. The keys
 * include the legacy frontmatter spellings `"LR"` (left-to-right) and `"TB"`
 * (top-to-bottom) that predate the query string, so pre-arrangement view notes
 * migrate in place.
 */
const CANVAS_DIRECTION_NORMALIZATION: Record<
	string,
	NonNullable<SavedView["canvasDirection"]>
> = {
	right: "right",
	LR: "right",
	down: "down",
	TB: "down",
};

const CANVAS_RELATION_KIND_SET = new Set<string>(CANVAS_RELATION_KINDS);

const CALENDAR_DATE_FIELDS: SavedView["calendarDateField"][] = [
	"dueDate",
	"startDate",
];

/** Fallback pixels-per-day when a timeline block is present but `scale` isn't. */
const DEFAULT_TIMELINE_SCALE = 16;

/**
 * Parse the optional per-session Timeline chrome. Absent (or empty) block →
 * `undefined`, so it never lands in serialized frontmatter until the view is
 * actually opened as a timeline and panned or zoomed.
 */
function parseTimeline(raw: unknown): ViewTimelineState | undefined {
	if (raw == null) return undefined;
	const record = asRecord(raw);
	const scale = asNumber(record.scale);
	const scrollDate = asDate(record.scrollDate);
	if (scale == null && scrollDate == null) return undefined;
	return {
		scale: scale != null && scale > 0 ? scale : DEFAULT_TIMELINE_SCALE,
		scrollDate: scrollDate ?? null,
	};
}

/**
 * Parse the optional per-session Calendar chrome. Absent (or empty) block →
 * `undefined`, mirroring `parseTimeline` — it never lands in serialized
 * frontmatter until the view is opened as a calendar and paged off its default
 * month.
 */
function parseCalendar(raw: unknown): ViewCalendarState | undefined {
	if (raw == null) return undefined;
	const record = asRecord(raw);
	const visibleMonth = asDate(record.visibleMonth);
	if (visibleMonth == null) return undefined;
	return { visibleMonth };
}
const GROUP_FIELDS: GroupByField[] = [
	"none",
	"status",
	"priority",
	"taskType",
	"assignee",
	"project",
	"label",
];
const SORT_FIELDS: SortField[] = [
	"rank",
	"priority",
	"status",
	"title",
	"dueDate",
	"startDate",
	"estimate",
	"createdAt",
	"updatedAt",
];
const EMPTY_BEHAVIORS: EmptyColumnBehavior[] = [
	"show-normal",
	"auto-collapse",
	"auto-hide",
];

function pick<T extends string>(
	raw: unknown,
	allowed: T[],
	fallback: T,
	log: IssueLog,
	field: string,
): T {
	const value = asString(raw) as T | null;
	if (!value) return fallback;
	if (allowed.includes(value)) return value;
	log.add(`Unknown ${field} "${value}"; using "${fallback}".`);
	return fallback;
}

/** `pick` for a closed-enum *list* — drops unknown members and logs each. */
function pickAll<T extends string>(
	raw: unknown,
	allowed: readonly T[],
	log: IssueLog,
	field: string,
): T[] {
	const out: T[] = [];
	for (const value of asStringArray(raw)) {
		if (allowed.includes(value as T)) {
			if (!out.includes(value as T)) out.push(value as T);
		} else {
			log.add(`Unknown ${field} "${value}"; ignoring.`);
		}
	}
	return out;
}

/** Link filters accept wikilinks or bare paths; both normalize to a target. */
function linkFilter(raw: unknown): string[] | undefined {
	const values = asStringArray(raw)
		.map((value) => parseLink(value) ?? value)
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function listFilter(raw: unknown): string[] | undefined {
	const values = asStringArray(raw);
	return values.length > 0 ? values : undefined;
}

/**
 * The `archived` tri-state, tolerating the legacy `includeArchived: true`
 * boolean that older view files carry — it reads as `"included"`.
 */
function parseArchived(record: Record<string, unknown>): ViewFilters["archived"] {
	const value = asString(record.archived);
	if (value === "only") return "only";
	if (value === "included") return "included";
	if (asBoolean(record.includeArchived, false)) return "included";
	return undefined;
}

export function parseFilters(raw: unknown): ViewFilters {
	const record = asRecord(raw);
	return compactFilters({
		status: listFilter(record.status),
		priority: listFilter(record.priority),
		taskType: listFilter(record.taskType),
		labels: listFilter(record.labels),
		assignee: listFilter(record.assignee),
		mentions: listFilter(record.mentions),
		project: linkFilter(record.project),
		parent: linkFilter(record.parent),
		text: asString(record.text) ?? undefined,
		archived: parseArchived(record),
	});
}

export interface ViewParseOptions {
	/** Vault path of the note. Its basename is the id fallback when frontmatter omits one. */
	path: string;
	/**
	 * Resolves the `query:` string's names into stored ids. A workspace-only
	 * context (taxonomies + people, no project/task lists) is enough — an
	 * unresolved project path or task id is preserved verbatim by the resolver.
	 * Omitted means "resolve nothing", i.e. keep every value verbatim.
	 */
	context?: QueryContext;
}

/** Like `compact`, but drops null/undefined/empty-array members of a `ViewFilters` shape. */
export function compactFilters(filters: ViewFilters): ViewFilters {
	const out: ViewFilters = {};
	for (const [key, value] of Object.entries(filters)) {
		if (value == null) continue;
		if (Array.isArray(value) && value.length === 0) continue;
		(out as Record<string, unknown>)[key] = value;
	}
	return out;
}

/**
 * The definitional half of a view — everything but the `type`/`path`
 * discriminants — read from the `query:` string plus the identity/chrome keys.
 */
function parseViewValue(
	record: Record<string, unknown>,
	id: string,
	log: IssueLog,
	context: QueryContext,
): Omit<SavedView, "type" | "path"> {
	const parsed = parseQuery(asString(record.query) ?? "", context);
	for (const issue of parsed.issues) {
		if (issue.severity === "error") log.add(`query: ${issue.message}`);
	}
	const def = parsed.definition;
	const columns = asRecord(record.columns);
	return {
		id,
		name: asString(record.name) ?? id,
		icon: asString(record.icon) ?? undefined,
		description: asString(record.description) ?? undefined,
		viewType: def.viewType,
		filters: def.filters,
		groupBy: def.groupBy,
		sortBy: def.sortBy,
		sortDirection: def.sortDirection,
		columns: {
			collapsed: asStringArray(columns.collapsed),
			hidden: asStringArray(columns.hidden),
		},
		emptyColumnBehavior: def.emptyColumnBehavior,
		hiddenFields: def.hiddenFields,
		subtaskDisplay: def.subtaskDisplay,
		calendarDateField: def.calendarDateField,
		recurringPreview: def.recurringPreview,
		canvasArrangement: def.canvasArrangement,
		// The query string owns `canvasDirection`; the legacy frontmatter key
		// (LR/TB) still wins when present so pre-query files migrate in place.
		canvasDirection:
			parseCanvasDirection(record.canvasDirection) ?? def.canvasDirection,
		canvasHiddenRelationKinds: parseCanvasHiddenRelationKinds(
			record.canvasHiddenRelationKinds,
		),
		timeline: parseTimeline(record.timeline),
		calendar: parseCalendar(record.calendar),
	};
}

/**
 * Read the retired structured shape of a view definition. Migration-only: the
 * `_views.md` array split and the per-file `query:` cutover both need to
 * understand the old top-level keys one last time.
 */
function parseLegacyViewValue(
	record: Record<string, unknown>,
	id: string,
	log: IssueLog,
): Omit<SavedView, "type" | "path"> {
	const viewType = pick(record.viewType, VIEW_TYPES, "list", log, "viewType");
	const columns = asRecord(record.columns);

	// Migration: the retired `filters.topLevelOnly` boolean becomes
	// `subtaskDisplay: "hidden"` when no explicit `subtaskDisplay` is present.
	const subtaskDisplay: SubtaskDisplay =
		record.subtaskDisplay != null
			? pick(
					record.subtaskDisplay,
					[...SUBTASK_DISPLAYS],
					"flat",
					log,
					"subtaskDisplay",
				)
			: asBoolean(asRecord(record.filters).topLevelOnly, false)
				? "hidden"
				: "flat";

	return {
			id,
			name: asString(record.name) ?? id,
			icon: asString(record.icon) ?? undefined,
			description: asString(record.description) ?? undefined,
			viewType,
			filters: parseFilters(record.filters),
			groupBy: pick(
				record.groupBy,
				GROUP_FIELDS,
				viewType === "board" ? "status" : "none",
				log,
				"groupBy",
			),
			sortBy: pick(record.sortBy, SORT_FIELDS, "rank", log, "sortBy"),
			sortDirection:
				asString(record.sortDirection) === "desc" ? "desc" : "asc",
			columns: {
				collapsed: asStringArray(columns.collapsed),
				hidden: asStringArray(columns.hidden),
			},
			emptyColumnBehavior: pick(
				record.emptyColumnBehavior,
				EMPTY_BEHAVIORS,
				"show-normal",
				log,
				"emptyColumnBehavior",
			),
			hiddenFields: canonicalizeHiddenFields(
				pickAll(record.hiddenFields, TASK_FIELDS, log, "hiddenFields"),
			),
			subtaskDisplay,
			calendarDateField: pick(
				record.calendarDateField,
				CALENDAR_DATE_FIELDS,
				"dueDate",
				log,
				"calendarDateField",
			),
			recurringPreview: asBoolean(record.recurringPreview, false),
			canvasDirection: parseCanvasDirection(record.canvasDirection),
			canvasHiddenRelationKinds: parseCanvasHiddenRelationKinds(
				record.canvasHiddenRelationKinds,
			),
			timeline: parseTimeline(record.timeline),
			calendar: parseCalendar(record.calendar),
	};
}

/**
 * Canvas (DAG) layout direction — normalised from the legacy frontmatter
 * spellings `"LR"`/`"TB"` and the current `"right"`/`"down"` into the latter.
 * Absent or unrecognised parses to `undefined` (readers apply the `"right"`
 * default); it never fails validation.
 */
function parseCanvasDirection(
	raw: unknown,
): SavedView["canvasDirection"] {
	const value = asString(raw);
	if (!value) return undefined;
	return CANVAS_DIRECTION_NORMALIZATION[value];
}

/**
 * Canvas relation kinds hidden from this view — a plain frontmatter key like
 * `canvasDirection`, not part of the `query:` string. Unknown entries are
 * dropped; an empty result becomes `undefined` (the "show all" default).
 */
function parseCanvasHiddenRelationKinds(
	raw: unknown,
): SavedView["canvasHiddenRelationKinds"] {
	const kinds = asStringArray(raw).filter((k) =>
		CANVAS_RELATION_KIND_SET.has(k),
	) as CanvasRelationKind[];
	return kinds.length > 0 ? kinds : undefined;
}

/**
 * Parse one `Views/<id>.md` note. The id comes from frontmatter; a note that
 * genuinely omits it falls back to its filename, the way a Task without an `id`
 * does (`parseTask`).
 */
export function parseView(
	raw: unknown,
	options: ViewParseOptions,
): ParseResult<SavedView> {
	const record = asRecord(raw);
	const log = new IssueLog();
	const id = asString(record.id) ?? basename(options.path);

	return {
		value: {
			type: "vertex-flow-view",
			path: options.path,
			...parseViewValue(record, id, log, options.context ?? emptyQueryContext()),
		},
		issues: log.issues.map((issue) => `View "${id}": ${issue}`),
	};
}

/**
 * Read a legacy structured view record (top-level `viewType`/`filters`/… keys)
 * into a `ViewDefinition`. Used by `VaultIndex.migrateViewQueries` to convert an
 * old file into a `query:` string. Never called on the live path.
 */
export function parseLegacyViewDefinition(
	record: Record<string, unknown>,
): ViewDefinition {
	const value = parseLegacyViewValue(asRecord(record), "", new IssueLog());
	return viewDefinition({ type: "vertex-flow-view", path: "", ...value });
}

/**
 * Parse the retired shared `_views.md` array. Migration-only — see the module
 * header. The `path` is left blank: these objects are transient, read once to be
 * re-written as individual files (and `serializeView` never emits `path`).
 */
export function parseViews(raw: unknown): ParseResult<SavedView[]> {
	const record = asRecord(raw);
	const list = Array.isArray(record.views) ? record.views : [];
	const views: SavedView[] = [];
	const issues: string[] = [];

	list.forEach((entry, index) => {
		const entryRecord = asRecord(entry);
		const log = new IssueLog();
		const id = asString(entryRecord.id) ?? `view-${index + 1}`;
		if (views.some((view) => view.id === id)) {
			issues.push(`Duplicate view id "${id}"; keeping the first.`);
			return;
		}
		views.push({
			type: "vertex-flow-view",
			path: "",
			...parseLegacyViewValue(entryRecord, id, log),
		});
		issues.push(...log.issues.map((issue) => `View "${id}": ${issue}`));
	});

	return { value: views, issues };
}

/**
 * Per-workspace duplicate-id detector. Two `Views/*.md` notes resolving to the
 * same id (hand-edited frontmatter) make `viewById` lookups ambiguous. Non-fatal
 * and surfaced per file, exactly like `detectProjectTitleCollisions`.
 */
export interface ViewIdCollision {
	path: string;
	id: string;
}

export function detectViewIdCollisions(
	views: readonly SavedView[],
): ViewIdCollision[] {
	const groups = new Map<string, SavedView[]>();
	for (const view of views) {
		const group = groups.get(view.id) ?? [];
		group.push(view);
		groups.set(view.id, group);
	}

	const out: ViewIdCollision[] = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		for (const view of group) out.push({ path: view.path, id: view.id });
	}
	return out;
}

export function serializeView(
	view: SavedView,
	context: QueryContext = emptyQueryContext(),
): Record<string, unknown> {
	return compact({
		type: "vertex-flow-view",
		id: view.id,
		name: view.name,
		icon: view.icon,
		description: view.description,
		query: printQuery(viewDefinition(view), context) || undefined,
		// `canvasDirection` now rides in the `query:` string (as
		// `canvas-direction:`) — never written as a separate frontmatter key
		// any more. The legacy `LR`/`TB` key is still *read* (see
		// `parseCanvasDirection`), purely so old view notes migrate in place.
		canvasHiddenRelationKinds: view.canvasHiddenRelationKinds,
		columns: {
			collapsed: view.columns.collapsed,
			hidden: view.columns.hidden,
		},
		timeline: view.timeline
			? compact({
					scale: view.timeline.scale,
					scrollDate: view.timeline.scrollDate,
				})
			: undefined,
		calendar: view.calendar?.visibleMonth
			? { visibleMonth: view.calendar.visibleMonth }
			: undefined,
	});
}

/**
 * Parse a Project's own `view:` frontmatter block — a `query:` string plus group
 * collapse/hide (`columns`), which (unlike a `Views/<id>.md` note) is the only
 * per-session furniture it carries. No id/name/icon.
 */
export function parseProjectView(
	raw: unknown,
	log: IssueLog,
	context: QueryContext = emptyQueryContext(),
): ProjectViewSettings {
	const record = asRecord(raw);
	const parsed = parseQuery(asString(record.query) ?? "", context);
	for (const issue of parsed.issues) {
		if (issue.severity === "error") log.add(`view query: ${issue.message}`);
	}
	const definition = parsed.definition;
	const columns = asRecord(record.columns);
	const collapsed = asStringArray(columns.collapsed);
	const hidden = asStringArray(columns.hidden);
	return collapsed.length || hidden.length
		? { ...definition, columns: { collapsed, hidden } }
		: definition;
}

/**
 * Read the retired structured shape of a Project's `view:` block into a
 * `ProjectViewSettings`. Migration-only — see `parseLegacyViewDefinition`.
 */
export function parseLegacyProjectView(raw: unknown): ProjectViewSettings {
	const record = asRecord(raw);
	const value = parseLegacyViewValue(record, "", new IssueLog());
	const definition = viewDefinition({
		type: "vertex-flow-view",
		path: "",
		...value,
	});
	const { collapsed, hidden } = value.columns;
	return collapsed.length || hidden.length
		? { ...definition, columns: { collapsed, hidden } }
		: definition;
}

/** The serialized counterpart of `parseProjectView`. */
export function serializeProjectView(
	definition: ProjectViewSettings,
	context: QueryContext = emptyQueryContext(),
): Record<string, unknown> {
	const collapsed = definition.columns?.collapsed ?? [];
	const hidden = definition.columns?.hidden ?? [];
	return compact({
		query: printQuery(definition, context) || undefined,
		columns:
			collapsed.length || hidden.length ? { collapsed, hidden } : undefined,
	});
}

/**
 * Serialize a view in the retired structured shape (top-level `viewType`/
 * `filters`/… keys). The plural `_views.md` array used this format on disk, so
 * `serializeViews` still emits it — the pair models the retired file, read and
 * written. The live per-file path is `serializeView` (a `query:` string).
 */
export function serializeLegacyView(view: SavedView): Record<string, unknown> {
	return compact({
		type: "vertex-flow-view",
		id: view.id,
		name: view.name,
		icon: view.icon,
		description: view.description,
		viewType: view.viewType,
		filters: compact(view.filters as Record<string, unknown>),
		groupBy: view.groupBy,
		sortBy: view.sortBy,
		sortDirection: view.sortDirection,
		columns: {
			collapsed: view.columns.collapsed,
			hidden: view.columns.hidden,
		},
		emptyColumnBehavior: view.emptyColumnBehavior,
		hiddenFields: view.hiddenFields,
		subtaskDisplay:
			view.subtaskDisplay === "flat" ? undefined : view.subtaskDisplay,
		calendarDateField:
			view.calendarDateField === "dueDate"
				? undefined
				: view.calendarDateField,
		recurringPreview: view.recurringPreview ? true : undefined,
		canvasDirection: view.canvasDirection,
		canvasHiddenRelationKinds: view.canvasHiddenRelationKinds,
		timeline: view.timeline
			? compact({
					scale: view.timeline.scale,
					scrollDate: view.timeline.scrollDate,
				})
			: undefined,
		calendar: view.calendar?.visibleMonth
			? { visibleMonth: view.calendar.visibleMonth }
			: undefined,
	});
}

export function serializeViews(views: SavedView[]): Record<string, unknown> {
	return { views: views.map(serializeLegacyView) };
}
