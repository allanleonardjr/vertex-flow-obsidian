/**
 * Saved View sorting.
 *
 * `rank` sorts through the LexoRank engine; everything else is a conventional
 * field sort. Unset values always sort last regardless of direction — a task
 * with no due date is not "the most urgent thing", and flipping to descending
 * shouldn't suddenly make it so.
 */

import { childTasks, subtaskProgress } from "../hierarchy";
import { compareTasksByRank } from "../ranking";
import { getValue } from "../taxonomy/engine";
import { relationCount, type SortDirection, type SortField, type TableSortKey, type Task } from "../types";
import type { ViewContext } from "./context";

/** Ordered-taxonomy position, or `Infinity` for unset/unknown values. */
function taxonomyOrder(
	context: ViewContext,
	field: "status" | "priority" | "taskType",
	id: string | null,
): number {
	if (!id) return Number.POSITIVE_INFINITY;
	const value = getValue(context.taxonomies[field], id);
	return value?.order ?? Number.POSITIVE_INFINITY;
}

function compareNullable<T>(
	a: T | null,
	b: T | null,
	compare: (x: T, y: T) => number,
): number {
	// Nulls last, always — the caller applies direction *after* this, and these
	// return values are deliberately excluded from that flip.
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	return compare(a, b);
}

/** Signed comparison for a field, before direction is applied. */
export function compareField(
	a: Task,
	b: Task,
	field: SortField,
	context: ViewContext,
): { value: number; nullSkewed: boolean } {
	switch (field) {
		case "rank":
			return { value: compareTasksByRank(a, b), nullSkewed: false };

		case "priority":
		case "status": {
			const oa = taxonomyOrder(context, field, a[field]);
			const ob = taxonomyOrder(context, field, b[field]);
			return { value: oa === ob ? 0 : oa < ob ? -1 : 1, nullSkewed: false };
		}

		case "title":
			return { value: a.title.localeCompare(b.title), nullSkewed: false };

		case "id":
			return { value: a.id.localeCompare(b.id), nullSkewed: false };

		case "estimate": {
			const nullSkewed = a.estimate == null || b.estimate == null;
			return {
				value: compareNullable(a.estimate, b.estimate, (x, y) => x - y),
				nullSkewed,
			};
		}

		case "dueDate":
		case "startDate": {
			const nullSkewed = a[field] == null || b[field] == null;
			return {
				value: compareNullable(a[field], b[field], (x, y) => x.localeCompare(y)),
				nullSkewed,
			};
		}

		case "createdAt":
		case "updatedAt":
			return {
				value: compareNullable(a[field], b[field], (x, y) => x.localeCompare(y)),
				nullSkewed: false,
			};

		case "taskType": {
			const oa = taxonomyOrder(context, "taskType", a.taskType);
			const ob = taxonomyOrder(context, "taskType", b.taskType);
			return { value: oa === ob ? 0 : oa < ob ? -1 : 1, nullSkewed: false };
		}

		case "project": {
			// Compare by project *title*, not path — the path is a storage
			// detail and sorting by it would look arbitrary on screen. A
			// context without `titles` falls back to the raw link.
			const na = a.project ? (context.titles?.get(a.project) ?? a.project) : null;
			const nb = b.project ? (context.titles?.get(b.project) ?? b.project) : null;
			return {
				value: compareNullable(na, nb, (x, y) => x.localeCompare(y)),
				nullSkewed: na == null || nb == null,
			};
		}

		case "assignee": {
			const nameOf = (id: string | null) =>
				id ? (context.people.find((p) => p.id === id)?.name ?? id) : null;
			const na = nameOf(a.assignee);
			const nb = nameOf(b.assignee);
			return {
				value: compareNullable(na, nb, (x, y) => x.localeCompare(y)),
				nullSkewed: na == null || nb == null,
			};
		}

		case "labels": {
			// A task's position is its *first* label in taxonomy order, so
			// visually similar rows cluster. Unlabelled tasks are an absence.
			const firstOrder = (task: Task): number | null => {
				if (task.labels.length === 0) return null;
				let min = Number.POSITIVE_INFINITY;
				for (const id of task.labels) {
					const order = getValue(context.taxonomies.label, id)?.order;
					if (order != null && order < min) min = order;
				}
				return Number.isFinite(min) ? min : null;
			};
			const oa = firstOrder(a);
			const ob = firstOrder(b);
			return {
				value: compareNullable(oa, ob, (x, y) => x - y),
				nullSkewed: oa == null || ob == null,
			};
		}

		case "progress": {
			// No scope (bare-config context) or no sub-tasks => absent, not
			// zero. "Nothing to roll up" is not "0% done".
			const ratio = (task: Task): number | null => {
				if (!context.scope) return null;
				const progress = subtaskProgress(context.scope, task, context.taxonomies.status);
				return progress.total === 0 ? null : progress.completed / progress.total;
			};
			const ra = ratio(a);
			const rb = ratio(b);
			return {
				value: compareNullable(ra, rb, (x, y) => x - y),
				nullSkewed: ra == null || rb == null,
			};
		}

		case "relations":
			// Zero is a real value here, not an absence — a task with no
			// relations is meaningfully "least related", so this is never
			// null-skewed and descending order behaves as expected.
			return {
				value: relationCount(a) - relationCount(b),
				nullSkewed: false,
			};

		case "comments":
			// Same reasoning as `relations`: zero comments is a real, least
			// position. A task newer than the index's body-read pass has no
			// `commentCount` yet and reads as 0 here.
			return {
				value: (a.commentCount ?? 0) - (b.commentCount ?? 0),
				nullSkewed: false,
			};

		case "subtasks": {
			// Follows `progress`'s rule: no scope means absent, and a task with
			// no children is zero — not "missing data".
			if (!context.scope) return { value: 0, nullSkewed: false };
			const count = (task: Task) => childTasks(context.scope!, task.path).length;
			return {
				value: count(a) - count(b),
				nullSkewed: false,
			};
		}
	}
}

export function sortTasks(
	tasks: Task[],
	field: SortField,
	direction: SortDirection,
	context: ViewContext,
): Task[] {
	const flip = direction === "desc" ? -1 : 1;

	return tasks
		.map((task, index) => ({ task, index }))
		.sort((a, b) => {
			const { value, nullSkewed } = compareField(a.task, b.task, field, context);
			if (value !== 0) return nullSkewed ? value : value * flip;
			// Rank is the tiebreak for every other sort: two tasks with the same
			// due date still land in the order the user arranged them in.
			const byRank = compareTasksByRank(a.task, b.task);
			if (byRank !== 0) return byRank;
			return a.index - b.index;
		})
		.map((entry) => entry.task);
}

/**
 * The click-cycle state transition for a Table column header.
 *
 * Plain click: replaces `tableSort` entirely with `[{field, asc}]` — unless
 * `field` is already the *sole* active key, in which case it cycles
 * asc → desc → cleared (third click returns to `[]`, i.e. rank order).
 *
 * Shift-click: leaves every other key alone. Appends `{field, asc}` to the end
 * if `field` isn't already a key; flips that key's direction in place if it is.
 */
export function nextTableSort(
	current: readonly TableSortKey[],
	field: SortField,
	shiftKey: boolean,
): TableSortKey[] {
	if (shiftKey) {
		const index = current.findIndex((key) => key.field === field);
		if (index === -1) return [...current, { field, direction: "asc" }];
		return current.map((key, i) =>
			i === index
				? { field, direction: key.direction === "asc" ? "desc" : "asc" }
				: key,
		);
	}

	const sole = current.length === 1 && current[0].field === field;
	if (sole) {
		return current[0].direction === "asc"
			? [{ field, direction: "desc" }]
			: [];
	}
	return [{ field, direction: "asc" }];
}

/**
 * Table-only multi-column sort. Each key in turn, first non-zero result wins;
 * rank breaks a total tie — same null-handling and tiebreak convention as
 * `sortTasks`.
 */
export function sortTasksMulti(
	tasks: Task[],
	sorts: TableSortKey[],
	context: ViewContext,
): Task[] {
	const flips = sorts.map((s) => (s.direction === "desc" ? -1 : 1));

	return tasks
		.map((task, index) => ({ task, index }))
		.sort((a, b) => {
			for (let i = 0; i < sorts.length; i++) {
				const { value, nullSkewed } = compareField(a.task, b.task, sorts[i].field, context);
				if (value !== 0) return nullSkewed ? value : value * flips[i];
			}
			const byRank = compareTasksByRank(a.task, b.task);
			if (byRank !== 0) return byRank;
			return a.index - b.index;
		})
		.map((entry) => entry.task);
}
