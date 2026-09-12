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

import type { CanvasDirection } from "../types";
import type { CanvasNode, LayeringEdgeKind } from "./graph";

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

/**
 * Every ELK node's absolute origin (top-left), keyed by id — `"root"` itself
 * is `(0, 0)`. Exported standalone (not just as `flattenCanvasLayout`'s
 * internal bookkeeping) because it's the only place a *zero-leaf* compound's
 * position survives: `flattenCanvasLayout`'s own tight-fit pass skips a
 * group with no leaves entirely (nothing to fit around), so a fully-isolated
 * group's box — sized purely from its grid-packed contents, never from ELK —
 * still needs *somewhere* to anchor to, and this is where that comes from.
 */
export function collectElkOrigins(root: ElkLayoutNode): Map<string, ElkPoint> {
	const origins = new Map<string, ElkPoint>([["root", { x: 0, y: 0 }]]);
	const visit = (node: ElkLayoutNode, x: number, y: number) => {
		origins.set(node.id, { x, y });
		for (const child of node.children ?? []) {
			visit(child, x + (child.x ?? 0), y + (child.y ?? 0));
		}
	};
	visit(root, 0, 0);
	return origins;
}

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
	const origins = collectElkOrigins(root);

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

/* ------------------------------------------------------- isolated grid --- */

export interface GridPosition {
	id: string;
	x: number;
	y: number;
}

/**
 * Plain left-to-right, top-to-bottom packing for a node set with nothing for
 * ELK to rank. Consumes `nodes` in the order given — that order already
 * reflects the view's own sort (rank by default via `evaluated.tasks`), so
 * this deliberately does no sorting of its own; reordering here would
 * silently override whatever sort the person actually chose.
 */
export function packCanvasGrid(
	nodes: readonly CanvasNode[],
	cellWidth: number,
	cellHeight: number,
	gap: number,
	columns: number,
): GridPosition[] {
	return nodes.map((n, i) => ({
		id: n.id,
		x: (i % columns) * (cellWidth + gap),
		y: Math.floor(i / columns) * (cellHeight + gap),
	}));
}

/** A grid-packed isolated node, already sized (unlike bare `GridPosition`). */
export interface IsolatedGridBox extends PlacedBox {
	id: string;
}

/** Gap between a scope's ELK-connected block and its appended isolated grid. */
export const ISOLATED_GRID_GAP = 24;

/**
 * Fold grid-packed isolated nodes (`partitionByConnectivity` +
 * `packCanvasGrid`) into an already-ELK-flattened layout, one scope at a
 * time — `"root"` for the flat/ungrouped case's own isolated set, or a
 * group's ELK id for that group's own.
 *
 * Each scope's isolated boxes (still positioned relative to `packCanvasGrid`'s
 * local `(0, 0)`) are appended right after that scope's own connected-block
 * bounding box: below it when `direction` is `"right"` (the primary flow axis
 * is horizontal, so stacking vertically doesn't fight it), to its right when
 * `"down"` (mirrored reasoning). A scope with no connected leaves at all —
 * the fully-edgeless degenerate case, at either granularity — has a
 * zero-sized connected block, so the offset math places the grid right at
 * the scope's own origin with no special-casing: `(0, 0)` for the root, or
 * (since a *group* with zero leaves is entirely absent from
 * `flattenCanvasLayout`'s own `groups` map — nothing to tight-fit around)
 * wherever ELK still placed that now-empty compound, from `elkOrigins`
 * (`collectElkOrigins`, run on the same raw ELK result).
 *
 * Also extends each touched group's tight-fit box, and the overall
 * `width`/`height`, to include the newly-appended content — a group whose
 * members are entirely isolated would otherwise keep whatever box (or lack
 * of one) the ELK-only pass gave it, and `fitToView`/the SVG viewBox would
 * crop the isolated grid at the root level the same way.
 */
export function mergeIsolatedIntoLayout(
	base: FlatCanvasLayout,
	isolated: ReadonlyMap<string, readonly IsolatedGridBox[]>,
	elkOrigins: ReadonlyMap<string, ElkPoint>,
	direction: CanvasDirection,
	groupPadding: GroupPadding = DEFAULT_GROUP_PADDING,
): FlatCanvasLayout {
	if (isolated.size === 0) return base;

	const nodes = new Map(base.nodes);
	const groups = new Map(base.groups);
	let width = base.width;
	let height = base.height;

	for (const [scopeId, boxes] of isolated) {
		if (boxes.length === 0) continue;
		const isRoot = scopeId === "root";
		const connectedBox = isRoot ? undefined : base.groups.get(scopeId);

		let blockX = 0;
		let blockY = 0;
		let blockWidth = 0;
		let blockHeight = 0;
		// The raw (unpadded) bbox to tight-fit this group around, seeded with
		// its existing connected leaves — recovered by reversing the padding
		// the earlier tight-fit pass already applied, so re-padding below
		// doesn't double up. Absent for the root (which isn't padded) and for
		// a group with no connected leaves (nothing to recover).
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		if (isRoot) {
			// Nothing connected at the root case's degenerate extreme (the
			// fully-edgeless workspace) — `(0, 0)`, the root's own origin,
			// exactly the "no special case needed" the offset math relies on.
			if (base.nodes.size > 0) {
				blockWidth = base.width;
				blockHeight = base.height;
			}
		} else if (connectedBox) {
			// The isolated grid is offset relative to the *raw* (unpadded)
			// leaves bbox — recovered by reversing the padding the earlier
			// tight-fit pass applied — not the padded outer box. Anchoring to
			// the padded edge instead would double-count that padding once
			// the union below gets re-padded to produce the final box.
			minX = connectedBox.x + groupPadding.left;
			minY = connectedBox.y + groupPadding.top;
			maxX = connectedBox.x + connectedBox.width - groupPadding.right;
			maxY = connectedBox.y + connectedBox.height - groupPadding.bottom;
			blockX = minX;
			blockY = minY;
			blockWidth = maxX - minX;
			blockHeight = maxY - minY;
		} else {
			const origin = elkOrigins.get(scopeId) ?? { x: 0, y: 0 };
			blockX = origin.x + groupPadding.left;
			blockY = origin.y + groupPadding.top;
		}

		const hasBlock = blockWidth > 0 || blockHeight > 0;
		const gap = hasBlock ? ISOLATED_GRID_GAP : 0;
		const offsetX = direction === "down" ? blockX + blockWidth + gap : blockX;
		const offsetY = direction === "right" ? blockY + blockHeight + gap : blockY;

		for (const b of boxes) {
			const box: PlacedBox = {
				x: offsetX + b.x,
				y: offsetY + b.y,
				width: b.width,
				height: b.height,
			};
			nodes.set(b.id, box);
			minX = Math.min(minX, box.x);
			minY = Math.min(minY, box.y);
			maxX = Math.max(maxX, box.x + box.width);
			maxY = Math.max(maxY, box.y + box.height);
			width = Math.max(width, box.x + box.width);
			height = Math.max(height, box.y + box.height);
		}

		if (!isRoot) {
			const groupBox: PlacedBox = {
				x: minX - groupPadding.left,
				y: minY - groupPadding.top,
				width: maxX - minX + groupPadding.left + groupPadding.right,
				height: maxY - minY + groupPadding.top + groupPadding.bottom,
			};
			groups.set(scopeId, groupBox);
			width = Math.max(width, groupBox.x + groupBox.width);
			height = Math.max(height, groupBox.y + groupBox.height);
		}
	}

	return {
		nodes,
		groups,
		edges: base.edges,
		width: Math.max(width, 1),
		height: Math.max(height, 1),
	};
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

export interface CanvasPoint {
	x: number;
	y: number;
}

export interface CanvasEdgePoints {
	start: CanvasPoint;
	end: CanvasPoint;
}

/**
 * How far the target endpoint of an overlay edge is pulled back along the
 * line, so the `markerEnd` arrowhead (which straddles the path's final
 * vertex, ~0.7px on its pointy end over a 7-unit marker) stays fully outside
 * the target card.
 */
export const DEFAULT_CANVAS_EDGE_INSET = 7;

/**
 * Edge endpoints for a straight, marker-ended canvas overlay edge.
 *
 * Both task cards are axis-aligned rectangles (absolute `PlacedBox`es). The
 * connector runs along the source-centre → target-centre line: the start is
 * where that ray exits the source rectangle, the end is where it enters the
 * target rectangle, pulled back toward the source by `targetInset` so the
 * arrowhead tip never pokes inside the card. Returns `null` when both boxes
 * share a centre (no meaningful direction).
 */
export function canvasEdgePoints(
	source: PlacedBox,
	target: PlacedBox,
	targetInset = DEFAULT_CANVAS_EDGE_INSET,
): CanvasEdgePoints | null {
	const sx = source.x + source.width / 2;
	const sy = source.y + source.height / 2;
	const tx = target.x + target.width / 2;
	const ty = target.y + target.height / 2;

	const dx = tx - sx;
	const dy = ty - sy;
	const len = Math.hypot(dx, dy);
	if (len === 0) return null;
	const ux = dx / len;
	const uy = dy / len;

	const start = exitThrough(source, sx, sy, ux, uy);
	const end = exitThrough(target, tx, ty, -ux, -uy);

	return {
		start,
		end: { x: end.x - ux * targetInset, y: end.y - uy * targetInset },
	};
}

/** The point where the ray `from cx,cy along (ux,uy)` leaves `box`. */
function exitThrough(
	box: PlacedBox,
	cx: number,
	cy: number,
	ux: number,
	uy: number,
): CanvasPoint {
	const halfW = box.width / 2;
	const halfH = box.height / 2;
	const t = Math.min(
		ux !== 0 ? halfW / Math.abs(ux) : Infinity,
		uy !== 0 ? halfH / Math.abs(uy) : Infinity,
	);
	return { x: cx + ux * t, y: cy + uy * t };
}

/** The `M start.x start.y L end.x end.y` path for the snapped edge. */
export function canvasEdgeLinePath(
	source: PlacedBox,
	target: PlacedBox,
	targetInset = DEFAULT_CANVAS_EDGE_INSET,
): string | null {
	const points = canvasEdgePoints(source, target, targetInset);
	if (!points) return null;
	return `M ${points.start.x} ${points.start.y} L ${points.end.x} ${points.end.y}`;
}
