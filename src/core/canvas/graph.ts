/**
 * Pure graph-building for the Canvas view.
 *
 * Kept free of the Obsidian API and of React so it stays unit-testable in
 * isolation (Golden Rule: `src/core/` never imports the Obsidian API). The
 * component feeds the result straight into `elkjs` for layout.
 *
 * This computes the *edges* only. Grouping into boxes is the component's job —
 * it reuses `evaluated.groups` (the same `TaskGroup[]` the Board renders its
 * columns from) so the "None" group, hidden-group filtering and per-group
 * colour all come for free.
 *
 * `task.parent` is read directly here — this deliberately does *not* use
 * `primaryParent()`, which collapses a task to one hierarchy position for the
 * List view and would silently drop the parent → child edge of any grouped
 * task.
 */

import { linksMatch } from "../links";
import type {
	CanvasRelationKind,
	GroupByField,
	LinkTarget,
	Task,
	TaskGroup,
} from "../types";

/**
 * `groupBy` values that place each task in exactly one box. `label` can put a
 * task in several groups at once and a compound-graph node has one parent, so
 * it renders flat; `none` has nothing to box.
 */
export const CANVAS_BOX_GROUPINGS: readonly GroupByField[] = [
	"status",
	"priority",
	"taskType",
	"assignee",
	"project",
];

export interface CanvasGrouping {
	/** True when `groupBy` maps to compound boxes. */
	grouped: boolean;
	/** The boxes to draw — non-hidden, non-empty. Empty when not grouped. */
	boxes: TaskGroup[];
	/** The tasks that actually render (hidden-group members already removed). */
	tasks: Task[];
}

/**
 * Decide Canvas's boxes and visible task set from the view's own grouping.
 *
 * Reuses the Board's `TaskGroup[]` verbatim: the "None" group's label, the
 * `hidden` flag and each group's `color` are all already resolved there, so
 * Canvas never re-derives them. A task in a hidden group is dropped entirely
 * (same as Board's `groups.filter(g => !g.hidden)`), not floated.
 */
export function canvasGrouping(
	groups: TaskGroup[],
	tasks: Task[],
	groupBy: GroupByField,
): CanvasGrouping {
	const grouped = CANVAS_BOX_GROUPINGS.includes(groupBy);
	const boxes = grouped
		? groups.filter((g) => !g.hidden && g.tasks.length > 0)
		: [];
	return {
		grouped,
		boxes,
		tasks: grouped ? boxes.flatMap((g) => g.tasks) : tasks,
	};
}

export interface CanvasNode {
	/** Stable id — the task's vault path. */
	id: string;
	task: Task;
}

export type LayeringEdgeKind = "dependency" | "hierarchy";

/** An edge that participates in ELK's layered ranking. */
export interface LayeringEdge {
	source: string;
	target: string;
	/** `dependency` = blocks/blockedBy; `hierarchy` = parent → child. */
	kind: LayeringEdgeKind;
}

/** An undirected `related` link — rendered between final node centres only. */
export interface RelatedEdge {
	/** Lexicographically smaller endpoint (so `{X,Y}` and `{Y,X}` collapse). */
	a: string;
	b: string;
}

export interface CanvasGraph {
	nodes: CanvasNode[];
	layeringEdges: LayeringEdge[];
	relatedEdges: RelatedEdge[];
}

/**
 * Build the Canvas graph for a set of already-filtered, already-visible tasks
 * (`evaluated.tasks` minus any hidden-group members, which the component drops
 * before calling this).
 *
 * Every edge (dependency, hierarchy, related) is dropped unless *both* endpoints
 * are in the visible task set, matching Phase 1.
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

	// --- Layering edges: dependency (Phase 1) + hierarchy (parent → child) ----
	const layeringKeys = new Set<string>();
	const layeringEdges: LayeringEdge[] = [];
	const addLayering = (
		source: string | null,
		target: string | null,
		kind: LayeringEdgeKind,
	) => {
		if (!source || !target || source === target) return;
		const key = `${kind}:${source}->${target}`;
		if (layeringKeys.has(key)) return;
		layeringKeys.add(key);
		layeringEdges.push({ source, target, kind });
	};

	for (const task of tasks) {
		for (const blockerLink of task.relations.blockedBy) {
			addLayering(resolve(blockerLink), task.path, "dependency");
		}
		for (const blockedLink of task.relations.blocks) {
			addLayering(task.path, resolve(blockedLink), "dependency");
		}
	}
	for (const task of tasks) {
		if (!task.parent) continue;
		addLayering(resolve(task.parent), task.path, "hierarchy");
	}

	// --- Related edges: undirected, rendered only, deduped as unordered pairs -
	const relatedKeys = new Set<string>();
	const relatedEdges: RelatedEdge[] = [];
	for (const task of tasks) {
		for (const link of task.relations.related) {
			const other = resolve(link);
			if (!other || other === task.path) continue;
			const [a, b] = task.path < other ? [task.path, other] : [other, task.path];
			const key = `${a} ${b}`;
			if (relatedKeys.has(key)) continue;
			relatedKeys.add(key);
			relatedEdges.push({ a, b });
		}
	}

	return { nodes, layeringEdges, relatedEdges };
}

/**
 * Drop the relation kinds the view has toggled off.
 *
 * A hidden `dependency`/`hierarchy` kind is removed from `layeringEdges` *before*
 * they reach ELK, so it stops influencing the layered ranking — not merely
 * hidden after layout. `related` is removed from `relatedEdges` only; it never
 * fed the layout, so hiding it moves nothing.
 */
export function filterCanvasGraph(
	graph: CanvasGraph,
	hidden: readonly CanvasRelationKind[],
): CanvasGraph {
	if (hidden.length === 0) return graph;
	const h = new Set(hidden);
	return {
		nodes: graph.nodes,
		layeringEdges: graph.layeringEdges.filter((e) => !h.has(e.kind)),
		relatedEdges: h.has("related") ? [] : graph.relatedEdges,
	};
}
