/**
 * Saved View filtering (§8.3).
 *
 * Semantics: values within one filter are OR'd, filters are AND'd together —
 * `status: [todo, in-progress], taskType: [bug]` means "a bug that is either
 * todo or in progress". This is the behaviour every issue tracker has, so it
 * needs no explanation in the UI.
 */

import { linksMatch } from "../links";
import {
	NONE,
	SELF,
	type LinkTarget,
	type SavedView,
	type Task,
	type ViewDefinition,
	type ViewFilters,
} from "../types";
import type { ViewContext } from "./context";

/** Expand the `self` sentinel against the workspace's `isSelf` person. */
function resolvePeople(values: string[], context: ViewContext): string[] {
	const out: string[] = [];
	for (const value of values) {
		if (value === SELF) {
			// No one is flagged `isSelf` yet — a `self` filter then matches
			// nothing, which is honest. Silently matching everything would make
			// "Assigned to Me" look like "All Tasks".
			if (context.selfId) out.push(context.selfId);
		} else {
			out.push(value);
		}
	}
	return out;
}

/** OR-match a single-valued field, honouring the `NONE` sentinel. */
function matchesSingle(
	actual: string | null,
	allowed: string[] | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.includes(actual);
}

/** OR-match a multi-valued field (labels, mentions). */
function matchesAny(actual: string[], allowed: string[] | undefined): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual.length === 0) return allowed.includes(NONE);
	return actual.some((value) => allowed.includes(value));
}

/** OR-match a link field, tolerating short-form vs full-path wikilinks. */
function matchesLink(
	actual: LinkTarget | null,
	allowed: string[] | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.some(
		(value) => value !== NONE && (value === actual || linksMatch(actual, value)),
	);
}

export function matchesFilters(
	task: Task,
	filters: ViewFilters,
	context: ViewContext,
): boolean {
	// Archived is a visibility flag, not a status (§7.7): hidden by default,
	// revealed by the "Show archived" toggle rather than by a status filter.
	if (task.archived && !filters.includeArchived) return false;

	if (filters.topLevelOnly && task.parent) return false;

	if (!matchesSingle(task.status, filters.status)) return false;
	if (!matchesSingle(task.priority, filters.priority)) return false;
	if (!matchesSingle(task.taskType, filters.taskType)) return false;
	if (!matchesAny(task.labels, filters.labels)) return false;

	if (filters.assignee && filters.assignee.length > 0) {
		const allowed = resolvePeople(filters.assignee, context);
		const wantsNone = filters.assignee.includes(NONE);
		if (task.assignee == null) {
			if (!wantsNone) return false;
		} else if (!allowed.includes(task.assignee)) {
			return false;
		}
	}

	if (filters.mentions && filters.mentions.length > 0) {
		const allowed = resolvePeople(filters.mentions, context);
		if (!task.mentions.some((id) => allowed.includes(id))) return false;
	}

	if (!matchesLink(task.project, filters.project)) return false;
	if (!matchesLink(task.initiative, filters.initiative)) return false;
	if (!matchesLink(task.cycle, filters.cycle)) return false;
	if (!matchesLink(task.parent, filters.parent)) return false;

	if (filters.text && filters.text.trim()) {
		const needle = filters.text.trim().toLowerCase();
		const haystack = `${task.title} ${task.id}`.toLowerCase();
		if (!haystack.includes(needle)) return false;
	}

	return true;
}

export function applyFilters(
	tasks: Task[],
	filters: ViewFilters,
	context: ViewContext,
): Task[] {
	return tasks.filter((task) => matchesFilters(task, filters, context));
}

/* ------------------------------------------------------- canonicalisation -- */

/**
 * The array-valued filter fields, in the order canonical filters emit them.
 *
 * Typed as a `Record` key list rather than a bare array so that removing a
 * field from `ViewFilters` surfaces here as a type error instead of leaving a
 * silently-dead entry behind.
 */
export type ArrayFilterKey = Exclude<
	keyof ViewFilters,
	"text" | "includeArchived" | "topLevelOnly"
>;

export const FILTER_ARRAY_FIELDS: readonly ArrayFilterKey[] = [
	"status",
	"priority",
	"taskType",
	"labels",
	"assignee",
	"mentions",
	"project",
	"initiative",
	"cycle",
	"parent",
];

/**
 * One filter set, one representation.
 *
 * `matchesFilters` already treats an empty array, a blank `text`, and a `false`
 * boolean as no-ops, so canonical form simply drops them — and fixes key order,
 * which is what lets equality be a `JSON.stringify` comparison.
 *
 * Values are de-duplicated but deliberately **not sorted**: the query bar
 * re-prints its text from these arrays, so sorting would reorder the user's
 * tokens under their cursor and shuffle the chip row on every click.
 * First-occurrence dedup is idempotent, which is all canonicity needs here.
 */
export function canonicalizeFilters(filters: ViewFilters): ViewFilters {
	const out: ViewFilters = {};

	for (const key of FILTER_ARRAY_FIELDS) {
		const values = filters[key];
		if (!values || values.length === 0) continue;
		const deduped: string[] = [];
		for (const value of values) {
			if (!deduped.includes(value)) deduped.push(value);
		}
		out[key] = deduped;
	}

	const text = filters.text?.trim();
	if (text) out.text = text;
	if (filters.includeArchived) out.includeArchived = true;
	if (filters.topLevelOnly) out.topLevelOnly = true;

	return out;
}

export function filtersEqual(a: ViewFilters, b: ViewFilters): boolean {
	return (
		JSON.stringify(canonicalizeFilters(a)) ===
		JSON.stringify(canonicalizeFilters(b))
	);
}

/** Strip a view down to what it *is*, dropping identity and column furniture. */
export function viewDefinition(view: SavedView): ViewDefinition {
	return {
		filters: view.filters,
		viewType: view.viewType,
		groupBy: view.groupBy,
		sortBy: view.sortBy,
		sortDirection: view.sortDirection,
		emptyColumnBehavior: view.emptyColumnBehavior,
	};
}

export function canonicalizeDefinition(
	definition: ViewDefinition,
): ViewDefinition {
	return {
		filters: canonicalizeFilters(definition.filters),
		viewType: definition.viewType,
		groupBy: definition.groupBy,
		sortBy: definition.sortBy,
		sortDirection: definition.sortDirection,
		emptyColumnBehavior: definition.emptyColumnBehavior,
	};
}

export function definitionsEqual(a: ViewDefinition, b: ViewDefinition): boolean {
	return (
		JSON.stringify(canonicalizeDefinition(a)) ===
		JSON.stringify(canonicalizeDefinition(b))
	);
}

/** True when a view would show everything — used to label the empty state. */
export function isEmptyFilterSet(filters: ViewFilters): boolean {
	return (
		!filters.status?.length &&
		!filters.priority?.length &&
		!filters.taskType?.length &&
		!filters.labels?.length &&
		!filters.assignee?.length &&
		!filters.project?.length &&
		!filters.initiative?.length &&
		!filters.cycle?.length &&
		!filters.parent?.length &&
		!filters.mentions?.length &&
		!filters.text?.trim() &&
		!filters.topLevelOnly
	);
}
