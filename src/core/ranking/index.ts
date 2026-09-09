/**
 * Task-facing ranking helpers.
 *
 * `rank` is global — one maintained order shared by the Backlog list and the
 * Board. Every view is just a different rendering of that one order; there are
 * deliberately no per-view rank maps (Golden Rule).
 */

import type { Task } from "../types";
import { compareRanks, rankForPosition, rankBetween, ranksBetween, sortByRank } from "./lexorank";

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
 * Like `planReorder`, but for a batch dragged together. `moved` keeps its
 * existing relative order (sorted by current rank) — that's what "drag the
 * selection" is supposed to preserve — and lands as a contiguous block
 * starting at `toIndex` among the non-moved siblings.
 */
export function planReorderMany(
	moved: Task[],
	siblings: Task[],
	toIndex: number,
): RankAssignment[] {
	const movedPaths = new Set(moved.map((task) => task.path));
	const others = sortTasksByRank(
		siblings.filter((task) => !movedPaths.has(task.path)),
	);
	const orderedMoved = sortTasksByRank(moved);

	const index = Math.max(0, Math.min(toIndex, others.length));
	const prev = index > 0 ? (others[index - 1].rank as string) : null;
	const next = index < others.length ? (others[index].rank as string | null) : null;
	const ranks = ranksBetween(prev, next, orderedMoved.length);

	return orderedMoved.map((task, i) => ({
		taskPath: task.path,
		rank: ranks[i],
	}));
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
 * Rank for a brand-new task among `siblings`, at whichever end
 * `placement` names. `"top"` is the historical default — new work appears
 * where you'll see it — `"bottom"` queues it after everything else.
 */
export function rankForNewTask(
	siblings: Task[],
	placement: "top" | "bottom",
): string {
	const ordered = sortTasksByRank(siblings).map((task) => task.rank);
	return rankForPosition(ordered, placement === "bottom" ? ordered.length : 0);
}
