/**
 * `_views.md` — Saved View definitions (§4.6).
 *
 * Filter values are written the way a human would write them (`assignee: self`,
 * `taskType: [bug]`, `cycle: "Cycles/2026-Cycle-18"`), so parsing normalizes
 * every scalar into an array and every wikilink into a bare target.
 */

import { parseLink } from "../links";
import {
	type EmptyColumnBehavior,
	type GroupByField,
	type SavedView,
	type SortDirection,
	type SortField,
	type ViewFilters,
	type ViewType,
} from "../types";
import {
	IssueLog,
	asBoolean,
	asString,
	asStringArray,
	asRecord,
	compact,
	type ParseResult,
} from "./coerce";

const VIEW_TYPES: ViewType[] = ["list", "board"];
const GROUP_FIELDS: GroupByField[] = [
	"none",
	"status",
	"priority",
	"taskType",
	"assignee",
	"project",
	"initiative",
	"cycle",
	"label",
];
const SORT_FIELDS: SortField[] = [
	"rank",
	"cycleRank",
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

export function parseFilters(raw: unknown): ViewFilters {
	const record = asRecord(raw);
	return compact({
		status: listFilter(record.status),
		priority: listFilter(record.priority),
		taskType: listFilter(record.taskType),
		labels: listFilter(record.labels),
		assignee: listFilter(record.assignee),
		mentions: listFilter(record.mentions),
		project: linkFilter(record.project),
		initiative: linkFilter(record.initiative),
		cycle: linkFilter(record.cycle),
		parent: linkFilter(record.parent),
		text: asString(record.text) ?? undefined,
		includeArchived: record.includeArchived != null
			? asBoolean(record.includeArchived, false)
			: undefined,
		topLevelOnly: record.topLevelOnly != null
			? asBoolean(record.topLevelOnly, false)
			: undefined,
	}) as ViewFilters;
}

export function parseView(raw: unknown, index: number): ParseResult<SavedView> {
	const record = asRecord(raw);
	const log = new IssueLog();

	const id = asString(record.id) ?? `view-${index + 1}`;
	const viewType = pick(record.viewType, VIEW_TYPES, "list", log, "viewType");
	const columns = asRecord(record.columns);

	return {
		value: {
			id,
			name: asString(record.name) ?? id,
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
				asString(record.sortDirection) === "desc"
					? ("desc" as SortDirection)
					: ("asc" as SortDirection),
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
		},
		issues: log.issues.map((issue) => `View "${id}": ${issue}`),
	};
}

export function parseViews(raw: unknown): ParseResult<SavedView[]> {
	const record = asRecord(raw);
	const list = Array.isArray(record.views) ? record.views : [];
	const views: SavedView[] = [];
	const issues: string[] = [];

	list.forEach((entry, index) => {
		const parsed = parseView(entry, index);
		if (views.some((view) => view.id === parsed.value.id)) {
			issues.push(`Duplicate view id "${parsed.value.id}"; keeping the first.`);
			return;
		}
		views.push(parsed.value);
		issues.push(...parsed.issues);
	});

	return { value: views, issues };
}

export function serializeView(view: SavedView): Record<string, unknown> {
	return compact({
		id: view.id,
		name: view.name,
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
	});
}

export function serializeViews(views: SavedView[]): Record<string, unknown> {
	return { views: views.map(serializeView) };
}
