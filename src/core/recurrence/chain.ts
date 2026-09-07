/**
 * Chain traversal — the `recurringFrom` link is the series' only structure.
 *
 * A chain is walked by following `recurringFrom` forward and backward through
 * the workspace's tasks. Stopped nodes (recurrence cleared, link kept) still
 * count as occurrences, which is what `endsAfter` measures against — the
 * physical notes exist, so the series budget accounts for them.
 */

import type {
	LinkTarget,
	Task,
	WorkspaceSnapshot,
} from "../types";

/** Every node in `node`'s chain, oldest first: ancestors, then self, then
 *  successors. Includes stopped occurrences (they still exist as notes). */
export function chainMembers(
	snapshot: WorkspaceSnapshot,
	node: Task,
): Task[] {
	const byPath = new Map<LinkTarget, Task>();
	const successorOf = new Map<LinkTarget, Task>();
	for (const task of snapshot.tasks) {
		byPath.set(task.path, task);
		if (task.recurringFrom) successorOf.set(task.recurringFrom, task);
	}

	const ordered: Task[] = [];
	const seen = new Set<string>();

	const pushOnce = (task: Task) => {
		if (!seen.has(task.path)) {
			seen.add(task.path);
			ordered.push(task);
		}
	};

	// Walk backward first so the result reads oldest → newest. Ancestors are
	// only collected here — `seen` stays empty until the forward pass, so an
	// ancestor can't be accidentally filtered out as a duplicate.
	const ancestors: Task[] = [];
	const visited = new Set<string>();
	let cursor = node;
	while (cursor.recurringFrom && !visited.has(cursor.path)) {
		visited.add(cursor.path);
		const parent = byPath.get(cursor.recurringFrom);
		if (!parent) break;
		ancestors.unshift(parent);
		cursor = parent;
	}
	for (const ancestor of ancestors) pushOnce(ancestor);

	pushOnce(node);

	cursor = node;
	for (;;) {
		const successor = successorOf.get(cursor.path);
		if (!successor || seen.has(successor.path)) break;
		pushOnce(successor);
		cursor = successor;
	}

	return ordered;
}

/** The chain's size — the denominator `endsAfter` is measured against. */
export function chainLength(snapshot: WorkspaceSnapshot, node: Task): number {
	return chainMembers(snapshot, node).length;
}

/** The single successor spawned from `node`, if any. */
export function nextInChain(
	snapshot: WorkspaceSnapshot,
	node: Task,
): Task | null {
	return (
		snapshot.tasks.find((task) => task.recurringFrom === node.path) ?? null
	);
}

/** `node`'s immediate parent occurrence, if `recurringFrom` resolves. */
export function prevInChain(
	snapshot: WorkspaceSnapshot,
	node: Task,
): Task | null {
	if (!node.recurringFrom) return null;
	return (
		snapshot.tasks.find((task) => task.path === node.recurringFrom) ?? null
	);
}

/**
 * Every chain member still carrying a recurrence block — the nodes a
 * whole-series "Stop repeating" must clear. Empty when the chain is already
 * stopped, making the mutation a cheap no-op.
 */
export function recurrenceNodesInChain(
	snapshot: WorkspaceSnapshot,
	node: Task,
): Task[] {
	return chainMembers(snapshot, node).filter((task) => task.recurrence != null);
}