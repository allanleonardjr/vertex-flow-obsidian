/**
 * Saved View filtering.
 *
 * Semantics: values within one filter are OR'd, filters are AND'd together —
 * `status: [todo, in-progress], taskType: [bug]` means "a bug that is either
 * todo or in progress". This is the behaviour every issue tracker has, so it
 * needs no explanation in the UI.
 */

import { relationScope, type HierarchyScope } from "../hierarchy";
import { linksMatch } from "../links";
import { getValue, isOpen, type Taxonomy } from "../taxonomy";
import { DEFAULT_DEFINITION } from "./defaults";
import {
	CANVAS_RELATION_KINDS,
	NONE,
	SELF,
	TASK_FIELDS,
	type CanvasRelationKind,
	type LinkTarget,
	type SavedView,
	type SortField,
	type Task,
	type TableSortKey,
	type TaskField,
	type ViewDefinition,
	type ViewFilters,
} from "../types";
import type { ViewContext } from "./context";

/** Expand the `self` sentinel against the device's per-workspace "me" personId. */
function resolvePeople(values: string[], context: ViewContext): string[] {
	const out: string[] = [];
	for (const value of values) {
		if (value === SELF) {
			// No `me` is set in this workspace — a `self` filter then matches
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

/** Does `name` fall under the group named by a `"Parent/*"` pattern? */
function matchesGroupPattern(name: string | null, pattern: string): boolean {
	if (name == null || !pattern.endsWith("/*")) return false;
	return name.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
}

/** OR-match labels: exact id, or a live group-pattern match on the
 *  label's current name (any nesting depth). */
function matchesLabels(
	actual: string[],
	allowed: string[] | undefined,
	taxonomy: Taxonomy,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual.length === 0) return allowed.includes(NONE);
	return actual.some((id) =>
		allowed.some(
			(pattern) =>
				pattern === id ||
				matchesGroupPattern(getValue(taxonomy, id)?.name ?? null, pattern),
		),
	);
}

/** OR-match project: exact path (tolerating wikilink forms, as today), or
 *  a live group-pattern match on the project's current title. */
function matchesProject(
	actual: LinkTarget | null,
	allowed: string[] | undefined,
	titles: Map<LinkTarget, string> | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.some(
		(pattern) =>
			(pattern !== NONE &&
				(pattern === actual || linksMatch(actual, pattern))) ||
			matchesGroupPattern(titles?.get(actual) ?? null, pattern),
	);
}

/** OR-match an exact-day field, day-truncating a full timestamp. */
function matchesDateExact(
	actual: string | null,
	allowed: string[] | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	const day = actual.slice(0, 10);
	return allowed.some((value) => value === day);
}

/** Exclusive before/after bound on an (optionally full-timestamp) date field. */
function matchesDateRange(
	actual: string | null,
	before: string | undefined,
	after: string | undefined,
): boolean {
	if (!before && !after) return true;
	if (actual == null) return false;
	const day = actual.slice(0, 10);
	if (before && !(day < before)) return false;
	if (after && !(day > after)) return false;
	return true;
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
	if (filters.recurring && !task.recurrence) return false;

	if (!matchesSingle(task.status, filters.status)) return false;
	if (!matchesSingle(task.priority, filters.priority)) return false;
	if (!matchesSingle(task.taskType, filters.taskType)) return false;
	if (!matchesLabels(task.labels, filters.labels, context.taxonomies.label))
		return false;

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

	if (!matchesProject(task.project, filters.project, context.titles))
		return false;
	if (!matchesLink(task.parent, filters.parent)) return false;

	if (!matchesDateExact(task.dueDate, filters.dueDate)) return false;
	if (!matchesDateRange(task.dueDate, filters.dueDateBefore, filters.dueDateAfter))
		return false;
	if (!matchesDateExact(task.startDate, filters.startDate)) return false;
	if (
		!matchesDateRange(task.startDate, filters.startDateBefore, filters.startDateAfter)
	)
		return false;
	if (!matchesDateExact(task.createdAt, filters.createdAt)) return false;
	if (
		!matchesDateRange(task.createdAt, filters.createdAtBefore, filters.createdAtAfter)
	)
		return false;
	if (!matchesDateExact(task.updatedAt, filters.updatedAt)) return false;
	if (
		!matchesDateRange(task.updatedAt, filters.updatedAtBefore, filters.updatedAtAfter)
	)
		return false;
	if (!matchesDateExact(task.completedAt, filters.completedAt)) return false;
	if (
		!matchesDateRange(
			task.completedAt,
			filters.completedAtBefore,
			filters.completedAtAfter,
		)
	)
		return false;

	/* -- exclusions: task fails if its value falls in any excluded list -- */

	if (filters.excludeStatus?.length && matchesSingle(task.status, filters.excludeStatus))
		return false;
	if (
		filters.excludePriority?.length &&
		matchesSingle(task.priority, filters.excludePriority)
	)
		return false;
	if (
		filters.excludeTaskType?.length &&
		matchesSingle(task.taskType, filters.excludeTaskType)
	)
		return false;
	if (
		filters.excludeLabels?.length &&
		matchesLabels(task.labels, filters.excludeLabels, context.taxonomies.label)
	)
		return false;

	if (filters.excludeAssignee && filters.excludeAssignee.length > 0) {
		const excluded = resolvePeople(filters.excludeAssignee, context);
		const wantsNone = filters.excludeAssignee.includes(NONE);
		if (task.assignee == null) {
			if (wantsNone) return false;
		} else if (excluded.includes(task.assignee)) {
			return false;
		}
	}

	if (filters.excludeMentions && filters.excludeMentions.length > 0) {
		const excluded = resolvePeople(filters.excludeMentions, context);
		if (task.mentions.some((id) => excluded.includes(id))) return false;
	}

	if (
		filters.excludeProject?.length &&
		matchesProject(task.project, filters.excludeProject, context.titles)
	)
		return false;
	if (filters.excludeParent?.length && matchesLink(task.parent, filters.excludeParent))
		return false;

	if (filters.excludeDueDate?.length && matchesDateExact(task.dueDate, filters.excludeDueDate))
		return false;
	if (
		filters.excludeStartDate?.length &&
		matchesDateExact(task.startDate, filters.excludeStartDate)
	)
		return false;
	if (
		filters.excludeCreatedAt?.length &&
		matchesDateExact(task.createdAt, filters.excludeCreatedAt)
	)
		return false;
	if (
		filters.excludeUpdatedAt?.length &&
		matchesDateExact(task.updatedAt, filters.excludeUpdatedAt)
	)
		return false;
	if (
		filters.excludeCompletedAt?.length &&
		matchesDateExact(task.completedAt, filters.excludeCompletedAt)
	)
		return false;

	if (filters.text && filters.text.trim()) {
		const needle = filters.text.trim().toLowerCase();
		const haystack = `${task.title} ${task.id}`.toLowerCase();
		if (!haystack.includes(needle)) return false;
	}

	return true;
}

/**
 * Build one reachable-path `Set` per distinct root value, so membership
 * checks become a `Set.has()` lookup per task instead of a fresh
 * `relationScope` walk per (root × task) pair.
 */
function buildRootScopeSets(
	roots: string[],
	scope: HierarchyScope,
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const root of roots) {
		if (out.has(root)) continue;
		const rootTask = scope.tasks.find((t) => linksMatch(t.path, root));
		const paths = new Set<string>();
		paths.add(rootTask ? rootTask.path : root);
		for (const task of relationScope(scope, root)) paths.add(task.path);
		out.set(root, paths);
	}
	return out;
}

/** Does `task.path` fall inside any of these precomputed root scopes? */
function inAnyScope(task: Task, scopeSets: Map<string, Set<string>>): boolean {
	for (const paths of scopeSets.values()) {
		if (paths.has(task.path)) return true;
	}
	return false;
}

export function applyFilters(
	tasks: Task[],
	filters: ViewFilters,
	context: ViewContext,
): Task[] {
	const scope = context.scope;
	if (!scope || !(filters.root?.length || filters.excludeRoot?.length)) {
		return tasks.filter((task) => matchesFilters(task, filters, context));
	}

	const included = filters.root?.length
		? buildRootScopeSets(filters.root, scope)
		: null;
	const excluded = filters.excludeRoot?.length
		? buildRootScopeSets(filters.excludeRoot, scope)
		: null;

	const pool = tasks.filter((task) => {
		if (included && !inAnyScope(task, included)) return false;
		if (excluded && inAnyScope(task, excluded)) return false;
		return true;
	});
	return pool.filter((task) => matchesFilters(task, filters, context));
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
	| "text"
	| "archived"
	| "openOnly"
	| "unscheduled"
	| "recurring"
	| "dueDateBefore"
	| "dueDateAfter"
	| "startDateBefore"
	| "startDateAfter"
	| "createdAtBefore"
	| "createdAtAfter"
	| "updatedAtBefore"
	| "updatedAtAfter"
	| "completedAtBefore"
	| "completedAtAfter"
	| "excludeStatus"
	| "excludePriority"
	| "excludeTaskType"
	| "excludeLabels"
	| "excludeAssignee"
	| "excludeMentions"
	| "excludeProject"
	| "excludeParent"
	| "excludeRoot"
	| "excludeDueDate"
	| "excludeStartDate"
	| "excludeCreatedAt"
	| "excludeUpdatedAt"
	| "excludeCompletedAt"
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
	"root",
	"dueDate",
	"startDate",
	"createdAt",
	"updatedAt",
	"completedAt",
];

/** The 13 `ViewFilters` property names that hold excluded values. */
export type ExcludeFilterKey =
	| "excludeStatus"
	| "excludePriority"
	| "excludeTaskType"
	| "excludeLabels"
	| "excludeAssignee"
	| "excludeMentions"
	| "excludeProject"
	| "excludeParent"
	| "excludeRoot"
	| "excludeDueDate"
	| "excludeStartDate"
	| "excludeCreatedAt"
	| "excludeUpdatedAt"
	| "excludeCompletedAt";

/**
 * `ArrayFilterKey` → the `ViewFilters` property holding its excluded
 * values. One exhaustive table (like `FILTER_FIELDS` in grammar.ts) so a
 * new filterable field can't silently skip exclusion support — adding it
 * to `ArrayFilterKey` forces an entry here too.
 */
export const EXCLUDE_FIELD_KEY: Record<ArrayFilterKey, ExcludeFilterKey> = {
	status: "excludeStatus",
	priority: "excludePriority",
	taskType: "excludeTaskType",
	labels: "excludeLabels",
	assignee: "excludeAssignee",
	mentions: "excludeMentions",
	project: "excludeProject",
	parent: "excludeParent",
	root: "excludeRoot",
	dueDate: "excludeDueDate",
	startDate: "excludeStartDate",
	createdAt: "excludeCreatedAt",
	updatedAt: "excludeUpdatedAt",
	completedAt: "excludeCompletedAt",
};

export const EXCLUDE_ARRAY_FIELDS: readonly ExcludeFilterKey[] =
	Object.values(EXCLUDE_FIELD_KEY);

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

	for (const key of EXCLUDE_ARRAY_FIELDS) {
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
	if (filters.recurring) out.recurring = true;

	if (filters.dueDateBefore) out.dueDateBefore = filters.dueDateBefore;
	if (filters.dueDateAfter) out.dueDateAfter = filters.dueDateAfter;
	if (filters.startDateBefore) out.startDateBefore = filters.startDateBefore;
	if (filters.startDateAfter) out.startDateAfter = filters.startDateAfter;
	if (filters.createdAtBefore) out.createdAtBefore = filters.createdAtBefore;
	if (filters.createdAtAfter) out.createdAtAfter = filters.createdAtAfter;
	if (filters.updatedAtBefore) out.updatedAtBefore = filters.updatedAtBefore;
	if (filters.updatedAtAfter) out.updatedAtAfter = filters.updatedAtAfter;
	if (filters.completedAtBefore) out.completedAtBefore = filters.completedAtBefore;
	if (filters.completedAtAfter) out.completedAtAfter = filters.completedAtAfter;

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
 * One table-sort set, one representation: deduped by field, first occurrence
 * wins. Unlike `canonicalizeHiddenFields`, order is meaningful (index 0 is the
 * primary key) so it's preserved in encounter order rather than sorted into
 * `TASK_FIELDS`/`SortField` canonical order.
 */
export function canonicalizeTableSort(
	sorts: readonly TableSortKey[] | undefined,
): TableSortKey[] {
	const seen = new Set<SortField>();
	const out: TableSortKey[] = [];
	for (const key of sorts ?? []) {
		if (seen.has(key.field)) continue;
		seen.add(key.field);
		out.push(key);
	}
	return out;
}

export function canonicalizeHiddenRelationKinds(
	kinds: readonly CanvasRelationKind[] | undefined,
): CanvasRelationKind[] {
	const set = new Set(kinds ?? []);
	return CANVAS_RELATION_KINDS.filter((kind) => set.has(kind));
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
		canvasArrangement: view.canvasArrangement,
		canvasDirection: view.canvasDirection,
		canvasHiddenRelationKinds: view.canvasHiddenRelationKinds,
		recurringPreview: view.recurringPreview,
		tableSort: view.tableSort,
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
		// Canvas arrangement/direction resolve to their defaults when absent —
		// a pre-arrangement view note carries neither, and canonical canonicity
		// (the round-trip invariant) needs those as explicit values.
		canvasArrangement:
			definition.canvasArrangement ?? DEFAULT_DEFINITION.canvasArrangement,
		canvasDirection:
			definition.canvasDirection ?? DEFAULT_DEFINITION.canvasDirection,
		// A *hidden* list, like `hiddenFields` — absent or empty means "show all
		// three", so canonicalizing to `[]` when unset introduces no second
		// meaning for "unset" between the Phase 3 toolbar and the query language.
		canvasHiddenRelationKinds: canonicalizeHiddenRelationKinds(
			definition.canvasHiddenRelationKinds,
		),
		recurringPreview: definition.recurringPreview,
		tableSort: canonicalizeTableSort(definition.tableSort),
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
		!filters.root?.length &&
		!filters.excludeRoot?.length &&
		!filters.mentions?.length &&
		!filters.text?.trim() &&
		!filters.recurring &&
		filters.archived !== "only" &&
		!filters.dueDate?.length &&
		!filters.startDate?.length &&
		!filters.createdAt?.length &&
		!filters.updatedAt?.length &&
		!filters.completedAt?.length &&
		!filters.dueDateBefore &&
		!filters.dueDateAfter &&
		!filters.startDateBefore &&
		!filters.startDateAfter &&
		!filters.createdAtBefore &&
		!filters.createdAtAfter &&
		!filters.updatedAtBefore &&
		!filters.updatedAtAfter &&
		!filters.completedAtBefore &&
		!filters.completedAtAfter &&
		!filters.excludeStatus?.length &&
		!filters.excludePriority?.length &&
		!filters.excludeTaskType?.length &&
		!filters.excludeLabels?.length &&
		!filters.excludeAssignee?.length &&
		!filters.excludeMentions?.length &&
		!filters.excludeProject?.length &&
		!filters.excludeParent?.length &&
		!filters.excludeDueDate?.length &&
		!filters.excludeStartDate?.length &&
		!filters.excludeCreatedAt?.length &&
		!filters.excludeUpdatedAt?.length &&
		!filters.excludeCompletedAt?.length
	);
}
