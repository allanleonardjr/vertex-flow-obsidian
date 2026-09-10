/**
 * Pure graph-building for the Canvas (DAG) view.
 *
 * Kept free of the Obsidian API and of React so it stays unit-testable in
 * isolation (Golden Rule: `src/core/` never imports the Obsidian API). The
 * component feeds the result straight into `elkjs` for layout.
 */

import { linksMatch } from "../links";
import type { LinkTarget, Task } from "../types";

export interface CanvasNode {
	/** Stable id — the task's vault path. */
	id: string;
	task: Task;
}

export interface CanvasEdge {
	/** Blocker task path. */
	source: string;
	/** Blocked task path. */
	target: string;
}

export interface CanvasGraph {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

/**
 * Build the directed dependency graph for a set of already-filtered tasks.
 *
 * One node per task. A directed edge blocker → blocked is added for every
 * `blocks` / `blockedBy` relation whose *both* endpoints are in the visible
 * set. Both sides of the relation are read and de-duplicated: forgiving-parse
 * means a hand-edited note can declare only one direction, so we reflect
 * whatever link data actually exists rather than trusting one side to be
 * authoritative. Relations pointing outside the visible set are silently
 * dropped — Phase 1 shows no badges or counts for hidden connections.
 */
export function buildCanvasGraph(tasks: Task[]): CanvasGraph {
	const nodes: CanvasNode[] = tasks.map((task) => ({ id: task.path, task }));

	// Resolve a relation link (`[[Tasks/TSK-0099]]`, a bare path, …) to a
	// visible task's path, or null when it isn't in the set.
	const resolve = (link: LinkTarget): string | null => {
		for (const task of tasks) {
			if (linksMatch(task.path, link)) return task.path;
		}
		return null;
	};

	const edgeKeys = new Set<string>();
	const edges: CanvasEdge[] = [];
	const addEdge = (source: string | null, target: string | null) => {
		if (!source || !target || source === target) return;
		const key = `${source}->${target}`;
		if (edgeKeys.has(key)) return;
		edgeKeys.add(key);
		edges.push({ source, target });
	};

	for (const task of tasks) {
		for (const blockerLink of task.relations.blockedBy) {
			addEdge(resolve(blockerLink), task.path);
		}
		for (const blockedLink of task.relations.blocks) {
			addEdge(task.path, resolve(blockedLink));
		}
	}

	return { nodes, edges };
}
