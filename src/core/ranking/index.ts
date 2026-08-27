/**
 * Task-facing ranking helpers (§6).
 *
 * `rank` is global — one maintained order shared by the Backlog list and the
 * Board. `cycleRank` is the single legitimate per-context override, used only
 * when viewing tasks inside a Cycle, and falls back to `rank` when unset.
 * There are deliberately no per-view rank maps (Golden Rule).
 */

import type { Task } from "../types";
import { compareRanks, rankForPosition, sortByRank } from "./lexorank";

export * from "./lexorank";

/** Which of the two rank fields a given view is ordering by. */
export type RankField = "rank" | "cycleRank";

/**
 * Read the effective rank for a field, honouring the `cycleRank → rank`
 * fallback. This fallback is the reason `cycleRank` can stay unset on the vast
 * majority of tasks: a cycle board is only *reordered* for the handful of tasks
 * someone actually drags.
 */
export function effectiveRank(task: Task, field: RankField = "rank"): string {
	if (field === "cycleRank") return task.cycleRank ?? task.rank;
	return task.rank;
}

export function compareTasksByRank(
	a: Task,
	b: Task,
	field: RankField = "rank",
): number {
	return compareRanks(effectiveRank(a, field), effectiveRank(b, field));
}

export function sortTasksByRank(tasks: Task[], field: RankField = "rank"): Task[] {
	return sortByRank(tasks, (task) => effectiveRank(task, field));
}

/** The result of a drag/reorder: exactly which field on which task to write. */
export interface RankAssignment {
	taskPath: string;
	field: RankField;
	rank: string;
}

/**
 * Compute the rank a dragged task needs to land at `toIndex` among `siblings`.
 *
 * `siblings` is the destination list *including* the moved task if it was
 * already there — it gets filtered out here, so callers can pass the column
 * contents verbatim without worrying about whether this is an intra-column
 * reorder or a cross-column move.
 */
export function planReorder(
	moved: Task,
	siblings: Task[],
	toIndex: number,
	field: RankField = "rank",
): RankAssignment {
	const others = sortTasksByRank(
		siblings.filter((task) => task.path !== moved.path),
		field,
	);
	const rank = rankForPosition(
		others.map((task) => effectiveRank(task, field)),
		toIndex,
	);
	return { taskPath: moved.path, field, rank };
}

/**
 * Rank for a brand-new task placed at the top of `siblings` (Linear's default:
 * new work appears where you'll see it, not buried at the bottom).
 */
export function rankForNewTask(siblings: Task[], field: RankField = "rank"): string {
	const ordered = sortTasksByRank(siblings, field).map((task) =>
		effectiveRank(task, field),
	);
	return rankForPosition(ordered, 0);
}
