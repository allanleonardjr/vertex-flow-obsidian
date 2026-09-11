/**
 * Flatten an `elkjs` layout result into absolute screen coordinates for the
 * Canvas view.
 *
 * Pure and Obsidian-free (Golden Rule) — and deliberately typed against a
 * minimal structural shape rather than importing `elkjs`, so `src/core/` keeps
 * its dependency allowlist and this stays unit-testable with synthetic trees.
 * `elkjs`'s `ElkNode` is structurally assignable to `ElkLayoutNode`.
 *
 * Two things this does NOT trust ELK for:
 *   - a **compound (group) node's own `width`/`height`**: with
 *     `hierarchyHandling: INCLUDE_CHILDREN` ELK pads a compound node to route
 *     cross-group edges, so its reported box can be far larger than its
 *     contents. The rendered `.vf-canvas-group` box is instead the tight
 *     bounding box of that group's own leaf nodes plus `groupPadding`.
 *   - the **root's `width`/`height`**: the SVG canvas is sized to the union of
 *     everything actually placed.
 *
 * Both *edge* coordinate spaces are trusted: ELK hoists every edge onto
 * `root.edges` and tags it with the node whose space its section points live
 * in (`container` — the root for cross-group/top-level edges, a compound's id
 * for edges between two nodes inside that compound). `flattenCanvasLayout`
 * translates each edge's points by its container's absolute origin, so an
 * edge inside a group box starts and ends exactly on the card boundaries it
 * connects rather than 12px inside one of them.
 *
 * ELK's reported *positions* (`x`/`y`, relative to the parent) are trusted —
 * only sizes are recomputed.
 */

import type { LayeringEdgeKind } from "./graph";

export interface ElkPoint {
	x: number;
	y: number;
}

export interface ElkLayoutEdgeSection {
	startPoint: ElkPoint;
	endPoint: ElkPoint;
	bendPoints?: ElkPoint[];
}

export interface ElkLayoutEdge {
	id?: string;
	sections?: ElkLayoutEdgeSection[];
	/**
	 * The id of the node whose coordinate space the sections live in. ELK
	 * hoists every laid-out edge onto `root.edges`; edges that connect two
	 * nodes *inside* the same compound (`hierarchyHandling: INCLUDE_CHILDREN`)
	 * report this as that compound's id and keep their points relative to it,
	 * while cross-group and top-level edges report `root`. Absent, or for an id
	 * we don't know, defaults to the root's origin `(0, 0)`.
	 */
	container?: string;
}

export interface ElkLayoutNode {
	id: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	children?: ElkLayoutNode[];
	edges?: ElkLayoutEdge[];
}

export interface PlacedBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A rendered layering-edge segment, carrying its endpoints back for hover. */
export interface FlatLayeringEdge {
	d: string;
	kind: LayeringEdgeKind;
	source: string;
	target: string;
}

export interface FlatCanvasLayout {
	/** Task nodes, absolute coords, keyed by task path. */
	nodes: Map<string, PlacedBox>;
	/** Group boxes, absolute coords, keyed by `group:${key}` — tight-fit. */
	groups: Map<string, PlacedBox>;
	/** One SVG path per layering-edge segment. */
	edges: FlatLayeringEdge[];
	width: number;
	height: number;
}

/** What each ELK edge id maps back to — its kind and its original endpoints. */
export interface EdgeMeta {
	kind: LayeringEdgeKind;
	source: string;
	target: string;
}

export interface GroupPadding {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

/** Extra room inside a group box; `top` leaves space for the header. */
export const DEFAULT_GROUP_PADDING: GroupPadding = {
	top: 34,
	left: 16,
	bottom: 16,
	right: 16,
};

/** The same padding as an `elk.padding` option string. */
export function elkPaddingOption(pad: GroupPadding = DEFAULT_GROUP_PADDING): string {
	return `[top=${pad.top}.0,left=${pad.left}.0,bottom=${pad.bottom}.0,right=${pad.right}.0]`;
}

const GROUP_PREFIX = "group:";

export function flattenCanvasLayout(
	root: ElkLayoutNode,
	edgeMeta: Map<string, EdgeMeta>,
	opts: {
		nodeWidth: number;
		nodeHeight: number;
		groupPadding?: GroupPadding;
	},
): FlatCanvasLayout {
	const pad = opts.groupPadding ?? DEFAULT_GROUP_PADDING;
	const nodes = new Map<string, PlacedBox>();
	const edges: FlatLayeringEdge[] = [];
	/** Leaf boxes enclosed by each group id, for the tight-fit pass. */
	const groupLeaves = new Map<string, PlacedBox[]>();
	/**
	 * Absolute origin (top-left) of every node id, for translating edge
	 * sections whose `container` isn't the root into absolute coordinates.
	 * Root itself is `(0, 0)`.
	 */
	const origins = new Map<string, ElkPoint>([["root", { x: 0, y: 0 }]]);

	// First pass: record every node's absolute origin. Edges must not be
	// flattened until all of them are known — ELK hoists within-compound edges
	// onto `root.edges` with *group-relative* sections, and the group they
	// reference may not have been visited yet if we interleaved the two.
	const collectOrigins = (node: ElkLayoutNode, x: number, y: number) => {
		origins.set(node.id, { x, y });
		for (const child of node.children ?? []) {
			collectOrigins(child, x + (child.x ?? 0), y + (child.y ?? 0));
		}
	};
	collectOrigins(root, 0, 0);

	const visit = (
		node: ElkLayoutNode,
		absX: number,
		absY: number,
		enclosing: string[],
	) => {
		for (const edge of node.edges ?? []) {
			const meta = edgeMeta.get(edge.id ?? "");
			// Points are in the edge's *container*'s space, not the node whose
			// `edges` array it happened to be hoisted onto — offset by that
			// container's absolute origin (root when unspecified/unknown).
			const origin = origins.get(edge.container ?? "root") ?? { x: 0, y: 0 };
			for (const section of edge.sections ?? []) {
				const pts = [
					section.startPoint,
					...(section.bendPoints ?? []),
					section.endPoint,
				];
				const d = pts
					.map(
						(p, i) =>
							`${i === 0 ? "M" : "L"} ${p.x + origin.x} ${p.y + origin.y}`,
					)
					.join(" ");
				edges.push({
					d,
					kind: meta?.kind ?? "dependency",
					source: meta?.source ?? "",
					target: meta?.target ?? "",
				});
			}
		}

		for (const child of node.children ?? []) {
			const cx = absX + (child.x ?? 0);
			const cy = absY + (child.y ?? 0);
			if (child.id.startsWith(GROUP_PREFIX)) {
				if (!groupLeaves.has(child.id)) groupLeaves.set(child.id, []);
				visit(child, cx, cy, [...enclosing, child.id]);
			} else {
				const box: PlacedBox = {
					x: cx,
					y: cy,
					width: child.width ?? opts.nodeWidth,
					height: child.height ?? opts.nodeHeight,
				};
				nodes.set(child.id, box);
				for (const gid of enclosing) groupLeaves.get(gid)?.push(box);
			}
		}
	};

	visit(root, 0, 0, []);

	const groups = new Map<string, PlacedBox>();
	for (const [gid, leaves] of groupLeaves) {
		if (leaves.length === 0) continue;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const b of leaves) {
			minX = Math.min(minX, b.x);
			minY = Math.min(minY, b.y);
			maxX = Math.max(maxX, b.x + b.width);
			maxY = Math.max(maxY, b.y + b.height);
		}
		groups.set(gid, {
			x: minX - pad.left,
			y: minY - pad.top,
			width: maxX - minX + pad.left + pad.right,
			height: maxY - minY + pad.top + pad.bottom,
		});
	}

	let width = root.width ?? 0;
	let height = root.height ?? 0;
	for (const b of [...nodes.values(), ...groups.values()]) {
		width = Math.max(width, b.x + b.width);
		height = Math.max(height, b.y + b.height);
	}

	return { nodes, groups, edges, width: Math.max(width, 1), height: Math.max(height, 1) };
}

/**
 * Monotonically-increasing request ids for async layout passes.
 *
 * ELK resolves out of order; if a slow response for an older signature lands
 * after a fast one for the newest signature, it must be dropped rather than
 * overwrite the canvas. The component calls `begin()` at the top of each pass
 * and checks `isCurrent(id)` before committing the result, so only the most
 * recent pass can ever win.
 */
export function createLayoutGuard(): {
	begin(): number;
	isCurrent(id: number): boolean;
} {
	let current = 0;
	return {
		begin() {
			current += 1;
			return current;
		},
		isCurrent(id) {
			return id === current;
		},
	};
}
