/**
 * Nested sub-task rows for the List view (`subtaskDisplay: "nested"`).
 *
 * The List view groups tasks exactly as always; this turns one group's flat list
 * into an indented forest. Nesting is *within the group* — a task sits under an
 * ancestor only when that ancestor is also in the same group. A matched task
 * whose parent was filtered out gets a muted "ghost" parent row for context, so
 * the child still reads as a sub-task rather than a loose top-level row (the
 * filter-orphan rule).
 *
 * Pure core logic — no Obsidian imports. Row order is `rank` at every level
 * (Golden Rule: one global order).
 */

import { linksMatch } from "../links";
import { sortTasksByRank } from "../ranking";
import type { HierarchyScope } from "../hierarchy/resolve";
import type { Task } from "../types";

export interface NestedRow {
	task: Task;
	/** Indentation level. Roots of the group's forest are 0. */
	depth: number;
	/** At least one child row is rendered (or hidden by collapse) beneath this one. */
	hasChildren: boolean;
	/** A filtered-out ancestor pulled in for context — not part of the result set. */
	ghost: boolean;
}

export interface NestOptions {
	/** Paths of every task the view matched, across all groups. */
	matchedPaths: ReadonlySet<string>;
	/** Paths whose subtree the user has collapsed (transient session state). */
	collapsed?: ReadonlySet<string>;
}

export function buildNestedRows(
	groupTasks: Task[],
	scope: HierarchyScope,
	options: NestOptions,
): NestedRow[] {
	const collapsed = options.collapsed ?? new Set<string>();
	const byPath = new Map(scope.tasks.map((task) => [task.path, task]));
	const inGroup = new Set(groupTasks.map((task) => task.path));

	const parentOf = (task: Task): Task | null => {
		if (!task.parent) return null;
		const link = task.parent;
		return (
			byPath.get(link) ??
			scope.tasks.find((candidate) => linksMatch(candidate.path, link)) ??
			null
		);
	};

	// The row a task hangs off inside this group: its nearest ancestor that is
	// itself in the group. `null` => the task is a root of this group's forest.
	const groupParent = (task: Task): Task | null => {
		const seen = new Set<string>([task.path]);
		let current = parentOf(task);
		while (current && !seen.has(current.path)) {
			if (inGroup.has(current.path)) return current;
			seen.add(current.path);
			current = parentOf(current);
		}
		return null;
	};

	const roots: Task[] = [];
	const childrenOf = new Map<string, Task[]>();
	for (const task of groupTasks) {
		const parent = groupParent(task);
		if (parent) {
			const list = childrenOf.get(parent.path) ?? [];
			list.push(task);
			childrenOf.set(parent.path, list);
		} else {
			roots.push(task);
		}
	}

	const rows: NestedRow[] = [];

	// Filtered-out ancestors above a root, outermost first. Stops at the first
	// ancestor that *was* matched (it owns the task in its own group) or a cycle.
	const ghostChainFor = (task: Task): Task[] => {
		const chain: Task[] = [];
		const seen = new Set<string>([task.path]);
		let current = parentOf(task);
		while (
			current &&
			!seen.has(current.path) &&
			!options.matchedPaths.has(current.path)
		) {
			chain.push(current);
			seen.add(current.path);
			current = parentOf(current);
		}
		return chain.reverse();
	};

	// `covered` includes rows hidden inside a collapsed subtree; `rows` doesn't.
	const covered = new Set<string>();
	const markCovered = (task: Task): void => {
		if (covered.has(task.path)) return;
		covered.add(task.path);
		for (const kid of childrenOf.get(task.path) ?? []) markCovered(kid);
	};
	const emitSubtree = (task: Task, depth: number): void => {
		if (covered.has(task.path)) return;
		covered.add(task.path);
		const kids = sortTasksByRank(childrenOf.get(task.path) ?? []);
		rows.push({ task, depth, hasChildren: kids.length > 0, ghost: false });
		if (collapsed.has(task.path)) {
			for (const kid of kids) markCovered(kid);
			return;
		}
		for (const kid of kids) emitSubtree(kid, depth + 1);
	};

	const ghostEmitted = new Set<string>();
	for (const root of sortTasksByRank(roots)) {
		const chain = ghostChainFor(root);
		let depth = 0;
		for (const ghost of chain) {
			if (!ghostEmitted.has(ghost.path)) {
				ghostEmitted.add(ghost.path);
				rows.push({ task: ghost, depth, hasChildren: true, ghost: true });
			}
			depth += 1;
		}
		emitSubtree(root, depth);
	}

	// A corrupted vault can leave every task in a group pointing at another as
	// its parent (a cycle) — nothing is a root, so nothing was emitted. Surface
	// the stragglers at depth 0 rather than dropping them silently.
	for (const task of groupTasks) {
		if (!covered.has(task.path)) emitSubtree(task, 0);
	}

	return rows;
}

/** The visible, focusable rows in order — ghosts excluded (they're not focusable). */
export function focusableRowPaths(rows: NestedRow[]): string[] {
	return rows.filter((row) => !row.ghost).map((row) => row.task.path);
}
