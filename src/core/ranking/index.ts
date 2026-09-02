/**
 * Task-facing ranking helpers.
 *
 * `rank` is global — one maintained order shared by the Backlog list and the
 * Board. Every view is just a different rendering of that one order; there are
 * deliberately no per-view rank maps (Golden Rule).
 */

import type { Task } from "../types";
import { compareRanks, rankForPosition, sortByRank } from "./lexorank";

export * from "./lexorank";

export function compareTasksByRank(a: Task, b: Task): number {
	return compareRanks(a.rank, b.rank);
}

export function sortTasksByRank(tasks: Task[]): Task[] {
	return sortByRank(tasks, (task) => task.rank);
}

/** The result of a drag/reorder: which task to write, and its new rank. */
export interface RankAssignment {
	taskPath: string;
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
): RankAssignment {
	const others = sortTasksByRank(
		siblings.filter((task) => task.path !== moved.path),
	);
	const rank = rankForPosition(
		others.map((task) => task.rank),
		toIndex,
	);
	return { taskPath: moved.path, rank };
}

/**
 * Rank for a brand-new task placed at the top of `siblings`:
 * new work appears where you'll see it, not buried at the bottom.
 */
export function rankForNewTask(siblings: Task[]): string {
	const ordered = sortTasksByRank(siblings).map((task) => task.rank);
	return rankForPosition(ordered, 0);
}
