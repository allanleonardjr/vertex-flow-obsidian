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
 * Prefix for the placeholder leaf a scope's isolated grid reserves in ELK
 * (`planIsolatedGrid`). Chosen to collide with neither a real task path nor
 * `GROUP_PREFIX` — see `planIsolatedGrid`'s own note.
 */
const GRID_PLACEHOLDER_PREFIX = "__vf-grid:";

/**
 * Every ELK node's absolute origin (top-left), keyed by id — `"root"` itself
 * is `(0, 0)`. `flattenCanvasLayout` uses this to translate each edge's
 * section points from its *container*'s space into absolute coordinates; kept
 * exported so tests can assert compound origin math directly.
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
 * A scope's isolated grid, planned up front as one reserve-then-fill unit:
 * the rect to reserve inside ELK (via a placeholder leaf only ELK sees, with
 * a size ELK absolutely trusts), plus the real member boxes positioned within
 * that rect in scope-local `(0, 0)` coords. During layout ELK treats the
 * placeholder as an ordinary leaf — sizing its compound around it and,
 * critically, spacing *sibling* compounds clear of it — then
 * `resolveIsolatedGrids` swaps the placeholder's resolved rect for the real
 * grid boxes.
 */
export interface IsolatedGridPlan {
	/** The scope's ELK id: `"root"` or `group:<key>`. */
	scopeId: string;
	/** Leaf id sent into ELK to reserve the grid's space. */
	placeholderId: string;
	/** The reserved rect; `x`/`y` are ignored (local to the scope). */
	placeholder: PlacedBox;
	/** Real member boxes, positioned within the placeholder rect. */
	boxes: IsolatedGridBox[];
}

/**
 * Plan one scope's isolated grid (see `IsolatedGridPlan`). `sizeById` must
 * hold an entry for every member and its heights are the row stride — the
 * caller already applies whatever floor it needs (e.g. the node height
 * budget), so rows always clear the tallest card. Consumes `isolated` in
 * order (already the view's sort); `packCanvasGrid` deliberately re-sorts
 * nothing.
 */
export function planIsolatedGrid(
	scopeId: string,
	isolated: readonly CanvasNode[],
	sizeById: ReadonlyMap<string, { width: number; height: number }>,
	cellWidth: number,
	gap: number,
	columns: number,
): IsolatedGridPlan {
	const cellHeight = Math.max(
		0,
		...isolated.map((n) => sizeById.get(n.id)?.height ?? 0),
	);
	const positions = packCanvasGrid(
		isolated,
		cellWidth,
		cellHeight,
		gap,
		Math.max(1, columns),
	);
	const boxes: IsolatedGridBox[] = [];
	let gridWidth = 0;
	let gridHeight = 0;
	for (const p of positions) {
		const size = sizeById.get(p.id);
		const width = size?.width ?? cellWidth;
		const height = size?.height ?? cellHeight;
		boxes.push({ id: p.id, x: p.x, y: p.y, width, height });
		gridWidth = Math.max(gridWidth, p.x + width);
		gridHeight = Math.max(gridHeight, p.y + height);
	}
	return {
		scopeId,
		// Deliberately nothing like a real task path, and not starting with
		// the `group:` prefix either — `flattenCanvasLayout` treats an id that
		// starts with `group:` as a compound to recurse into rather than a
		// leaf to place, which would drop the reservation entirely.
		placeholderId: `${GRID_PLACEHOLDER_PREFIX}${scopeId}`,
		placeholder: {
			x: 0,
			y: 0,
			width: Math.max(gridWidth, 1),
			height: Math.max(gridHeight, 1),
		},
		boxes,
	};
}

/**
 * Swap each plan's reserved placeholder leaf for its real grid boxes. During
 * `flattenCanvasLayout` the placeholder was a plain leaf inside its compound,
 * so it already helped tight-fit the group box AND ELK already spaced sibling
 * groups clear of it — resolution just positions the grid onto the
 * placeholder's resolved absolute rect and drops the placeholder. `boxes` are
 * in scope-local coords and their bbox equals the reserved rect, so overall
 * `width`/`height` barely move and each group box still encloses its grid.
 */
export function resolveIsolatedGrids(
	base: FlatCanvasLayout,
	plans: readonly IsolatedGridPlan[],
): FlatCanvasLayout {
	if (plans.length === 0) return base;

	const nodes = new Map(base.nodes);
	let width = base.width;
	let height = base.height;

	for (const plan of plans) {
		const rect = nodes.get(plan.placeholderId);
		if (!rect) continue;
		nodes.delete(plan.placeholderId);
		for (const b of plan.boxes) {
			const box: PlacedBox = {
				x: rect.x + b.x,
				y: rect.y + b.y,
				width: b.width,
				height: b.height,
			};
			nodes.set(b.id, box);
			width = Math.max(width, box.x + box.width);
			height = Math.max(height, box.y + box.height);
		}
	}

	return {
		nodes,
		groups: base.groups,
		edges: base.edges,
		width: Math.max(width, 1),
		height: Math.max(height, 1),
	};
}

/**
 * Fold the flat/ungrouped case's grid-packed isolated nodes (`"root"` scope
 * only) into an already-ELK-flattened layout.
 *
 * Grouped scopes never come through here — those reserve their grid space
 * *inside* ELK via `planIsolatedGrid`'s placeholder, because a grid appended
 * after layout anchors to the connected-block bbox and overlaps whichever
 * sibling group ELK had placed just outside it (commit 5e076fa's
 * grouped-layout regression). The root has no sibling to collide with, so it
 * keeps this direct append, which also preserves the design's "below the
 * block when `direction` is `"right"`, beside it when `"down"`".
 *
 * `boxes` (relative to `packCanvasGrid`'s local `(0, 0)`) are appended right
 * after the root's connected-block bbox, or at `(0, 0)` — the root's own
 * origin — when nothing is connected at all, and the overall `width`/`height`
 * extend to include them so `fitToView`/the SVG viewBox never crop the grid.
 */
export function mergeIsolatedIntoLayout(
	base: FlatCanvasLayout,
	isolated: ReadonlyMap<string, readonly IsolatedGridBox[]>,
	direction: CanvasDirection,
): FlatCanvasLayout {
	if (isolated.size === 0) return base;

	const nodes = new Map(base.nodes);
	let width = base.width;
	let height = base.height;

	for (const [scopeId, boxes] of isolated) {
		if (boxes.length === 0 || scopeId !== "root") continue;
		const hasBlock = base.nodes.size > 0;
		const blockWidth = hasBlock ? base.width : 0;
		const blockHeight = hasBlock ? base.height : 0;
		const gap = hasBlock ? ISOLATED_GRID_GAP : 0;
		const offsetX = direction === "down" ? blockWidth + gap : 0;
		const offsetY = direction === "right" ? blockHeight + gap : 0;

		for (const b of boxes) {
			const box: PlacedBox = {
				x: offsetX + b.x,
				y: offsetY + b.y,
				width: b.width,
				height: b.height,
			};
			nodes.set(b.id, box);
			width = Math.max(width, box.x + box.width);
			height = Math.max(height, box.y + box.height);
		}
	}

	return {
		nodes,
		groups: base.groups,
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
