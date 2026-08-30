/**
 * Saved View filtering.
 *
 * Semantics: values within one filter are OR'd, filters are AND'd together —
 * `status: [todo, in-progress], taskType: [bug]` means "a bug that is either
 * todo or in progress". This is the behaviour every issue tracker has, so it
 * needs no explanation in the UI.
 */

import { linksMatch } from "../links";
import { isOpen } from "../taxonomy";
import {
	NONE,
	SELF,
	TASK_FIELDS,
	type LinkTarget,
	type SavedView,
	type Task,
	type TaskField,
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
	// Archived is a visibility flag, not a status: hidden by default, mixed in
	// by `archived: "included"`, and shown exclusively by `archived: "only"`.
	if (filters.archived === "only") {
		if (!task.archived) return false;
	} else if (!filters.archived && task.archived) {
		return false;
	}

	// Triaged-out predicates: finished work and scheduled work have both left
	// the "needs a decision" pool. Independent of the `archived` filter.
	if (filters.openOnly && !isOpen(context.taxonomies.status, task.status)) {
		return false;
	}
	if (filters.unscheduled && (task.dueDate || task.startDate)) return false;

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
	"text" | "archived" | "openOnly" | "unscheduled"
>;

export const FILTER_ARRAY_FIELDS: readonly ArrayFilterKey[] = [
	"status",
	"priority",
	"taskType",
	"labels",
	"assignee",
	"mentions",
	"project",
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
	if (filters.archived) out.archived = filters.archived;
	if (filters.openOnly) out.openOnly = true;
	if (filters.unscheduled) out.unscheduled = true;

	return out;
}

export function filtersEqual(a: ViewFilters, b: ViewFilters): boolean {
	return (
		JSON.stringify(canonicalizeFilters(a)) ===
		JSON.stringify(canonicalizeFilters(b))
	);
}

/**
 * One hidden-fields set, one representation: deduped and reordered into
 * `TASK_FIELDS` order so equality is a `JSON.stringify` comparison.
 *
 * Filter values stay unsorted (the query bar re-prints them under the user's
 * cursor), but a field checklist has no such concern — a fixed order also keeps
 * a view's note diff stable when the same set is toggled in a different sequence.
 */
export function canonicalizeHiddenFields(
	fields: readonly TaskField[] | undefined,
): TaskField[] {
	const set = new Set(fields ?? []);
	return TASK_FIELDS.filter((field) => set.has(field));
}

/**
 * The hidden-field set a view's rows and cards should actually render with —
 * the user's own choices plus anything the view's filters make redundant.
 *
 * Today that's the project chip inside a view already scoped to one project:
 * repeating the same project name on every row is noise, and the alternative
 * (seeding `project` into every existing view's `hiddenFields` on upgrade)
 * would be a migration that also takes the choice away from the user. This
 * suppression is presentation-only — it never touches the saved view, so
 * toggling the filter off brings the chip straight back, and the Fields
 * control still shows the field as "shown" because that's what's saved.
 */
export function renderedHiddenFields(
	view: Pick<SavedView, "filters" | "hiddenFields">,
): TaskField[] {
	const projects = view.filters.project ?? [];
	if (projects.length !== 1 || view.hiddenFields.includes("project")) {
		return [...view.hiddenFields];
	}
	return [...view.hiddenFields, "project"];
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
		hiddenFields: view.hiddenFields,
		subtaskDisplay: view.subtaskDisplay,
		calendarDateField: view.calendarDateField,
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
		hiddenFields: canonicalizeHiddenFields(definition.hiddenFields),
		subtaskDisplay: definition.subtaskDisplay,
		calendarDateField: definition.calendarDateField,
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
		!filters.parent?.length &&
		!filters.mentions?.length &&
		!filters.text?.trim() &&
		filters.archived !== "only"
	);
}
