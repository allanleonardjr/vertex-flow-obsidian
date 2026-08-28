/**
 * Saved View sorting.
 *
 * `rank` sorts through the LexoRank engine; everything else is a conventional
 * field sort. Unset values always sort last regardless of direction — a task
 * with no due date is not "the most urgent thing", and flipping to descending
 * shouldn't suddenly make it so.
 */

import { compareTasksByRank } from "../ranking";
import { getValue } from "../taxonomy/engine";
import type { SortDirection, SortField, Task } from "../types";
import type { ViewContext } from "./context";

/** Ordered-taxonomy position, or `Infinity` for unset/unknown values. */
function taxonomyOrder(
	context: ViewContext,
	field: "status" | "priority",
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
function compareField(
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
