/**
 * Cycle detection for the two directed relationships a write can introduce a
 * loop into: `blocks`/`blockedBy` dependencies and `parent` hierarchy.
 *
 * Both check the **full** task set passed in, never a filtered/visible
 * subset — a cycle can close through a task that isn't currently on screen
 * (e.g. Canvas's current filter), and checking only what's visible would miss
 * a real one. Callers (`Mutations.addDependency`, Canvas's drag-to-connect)
 * must pass the whole workspace's tasks, not `evaluated.tasks`.
 *
 * Pure and Obsidian-free (Golden Rule) — unit-tested in isolation.
 */

import { linksMatch } from "../links";
import type { LinkTarget, Task } from "../types";

/** Resolve a relation/parent link to the task path it actually points at. */
function resolvePath(tasks: Task[], link: LinkTarget): string | null {
	for (const task of tasks) {
		if (linksMatch(task.path, link)) return task.path;
	}
	return null;
}

/**
 * True if adding a `blocker` → `blocked` dependency (blocker must finish
 * before blocked) would close a cycle — i.e. `blocked` already, directly or
 * transitively, blocks `blocker`.
 */
export function wouldCreateDependencyCycle(
	allTasks: Task[],
	blockerPath: string,
	blockedPath: string,
): boolean {
	if (blockerPath === blockedPath) return true;

	const byPath = new Map(allTasks.map((t) => [t.path, t]));
	const seen = new Set<string>([blockedPath]);
	const queue: string[] = [blockedPath];

	while (queue.length > 0) {
		const current = queue.shift() as string;
		const task = byPath.get(current);
		if (!task) continue;

		for (const link of task.relations.blocks) {
			const next = resolvePath(allTasks, link);
			if (!next) continue;
			if (next === blockerPath) return true;
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}

	return false;
}

/**
 * True if setting `child.parent = proposedParent` would create an ancestor
 * cycle — `proposedParent === child`, or `proposedParent` is already a
 * descendant of `child` (walking up from it would eventually loop back).
 */
export function wouldCreateHierarchyCycle(
	allTasks: Task[],
	childPath: string,
	proposedParentPath: string,
): boolean {
	if (childPath === proposedParentPath) return true;

	const byPath = new Map(allTasks.map((t) => [t.path, t]));
	const seen = new Set<string>();
	let current: string | null = proposedParentPath;

	while (current) {
		if (current === childPath) return true;
		// A pre-existing cycle elsewhere in a corrupted vault must not hang
		// this walk — bail out rather than looping forever.
		if (seen.has(current)) return false;
		seen.add(current);

		const task: Task | undefined = byPath.get(current);
		current = task?.parent ? resolvePath(allTasks, task.parent) : null;
	}

	return false;
}
