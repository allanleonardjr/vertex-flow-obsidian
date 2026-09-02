/**
 * `Views/<id>.md` — one Saved View definition per note.
 *
 * Filter values are written the way a human would write them (`assignee: self`,
 * `taskType: [bug]`, `project: "Projects/Kanban UI Engine"`), so parsing
 * normalizes every scalar into an array and every wikilink into a bare target.
 *
 * `parseViews`/`serializeViews` (plural) survive only for the one-time migration
 * off the retired shared `_views.md` array — the live scan path is per-file
 * `parseView`/`serializeView`.
 */

import { basename, parseLink } from "../links";
import { canonicalizeHiddenFields } from "../views/filter";
import {
	SUBTASK_DISPLAYS,
	TASK_FIELDS,
	type EmptyColumnBehavior,
	type GroupByField,
	type SavedView,
	type SortDirection,
	type SortField,
	type SubtaskDisplay,
	type ViewCalendarState,
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

const VIEW_TYPES: ViewType[] = ["list", "board", "timeline", "calendar"];

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

/** The definitional half of a view — everything but the `type`/`path` discriminants. */
function parseViewValue(
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
			timeline: parseTimeline(record.timeline),
			calendar: parseCalendar(record.calendar),
	};
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
			type: "view",
			path: options.path,
			...parseViewValue(record, id, log),
		},
		issues: log.issues.map((issue) => `View "${id}": ${issue}`),
	};
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
			type: "view",
			path: "",
			...parseViewValue(entryRecord, id, log),
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

export function serializeView(view: SavedView): Record<string, unknown> {
	return compact({
		type: "view",
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
		// Omitted at the default, like `hiddenFields: []` — keeps a view's note diff quiet for the common case.
		subtaskDisplay:
			view.subtaskDisplay === "flat" ? undefined : view.subtaskDisplay,
		calendarDateField:
			view.calendarDateField === "dueDate"
				? undefined
				: view.calendarDateField,
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
	return { views: views.map(serializeView) };
}
