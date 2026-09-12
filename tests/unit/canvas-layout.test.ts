import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../../src/core/canvas/graph";
import {
	DEFAULT_GROUP_PADDING as PAD,
	ISOLATED_GRID_GAP,
	canvasEdgeLinePath,
	canvasEdgePoints,
	collectElkOrigins,
	createLayoutGuard,
	flattenCanvasLayout,
	mergeIsolatedIntoLayout,
	packCanvasGrid,
	type EdgeMeta,
	type ElkLayoutNode,
	type IsolatedGridBox,
} from "../../src/core/canvas/layout";
import { task } from "./fixtures";

const OPTS = { nodeWidth: 220, nodeHeight: 64 };
const noEdges = new Map<string, EdgeMeta>();

describe("flattenCanvasLayout — group box sizing", () => {
	it("tight-fits a group box to its children, ignoring ELK's inflated size", () => {
		// ELK reports the compound node as 2000×2000 (edge-routing slack) but its
		// two children only span x∈[10,240], y∈[40,344] in group-local coords.
		const root: ElkLayoutNode = {
			id: "root",
			width: 4000,
			height: 4000,
			children: [
				{
					id: "group:todo",
					x: 100,
					y: 50,
					width: 2000,
					height: 2000,
					children: [
						{ id: "W/Tasks/A", x: 10, y: 40, width: 220, height: 64 },
						{ id: "W/Tasks/B", x: 10, y: 280, width: 220, height: 64 },
					],
				},
			],
		};

		const flat = flattenCanvasLayout(root, noEdges, OPTS);
		const box = flat.groups.get("group:todo")!;

		// Children flattened to absolute: A at (110, 90), B at (110, 330)-(330,394).
		expect(box.x).toBe(110 - PAD.left);
		expect(box.y).toBe(90 - PAD.top);
		expect(box.width).toBe(220 + PAD.left + PAD.right);
		expect(box.height).toBe(304 + PAD.top + PAD.bottom);

		// Nowhere near ELK's 2000×2000.
		expect(box.width).toBeLessThan(300);
		expect(box.height).toBeLessThan(400);
	});

	it("does not let one inflated group box engulf a sibling", () => {
		const root: ElkLayoutNode = {
			id: "root",
			children: [
				{
					id: "group:a",
					x: 0,
					y: 0,
					width: 5000,
					height: 5000,
					children: [{ id: "W/Tasks/A", x: 10, y: 40, width: 220, height: 64 }],
				},
				{
					id: "group:b",
					x: 300,
					y: 0,
					width: 260,
					height: 200,
					children: [{ id: "W/Tasks/B", x: 10, y: 40, width: 220, height: 64 }],
				},
			],
		};

		const flat = flattenCanvasLayout(root, noEdges, OPTS);
		const a = flat.groups.get("group:a")!;
		const b = flat.groups.get("group:b")!;

		// A's right edge no longer overruns B's left edge.
		expect(a.x + a.width).toBeLessThanOrEqual(b.x);
	});

	it("flattens edge coordinates by the container origin and tags the kind", () => {
		const meta = new Map<string, EdgeMeta>([
			["e0", { kind: "hierarchy", source: "W/Tasks/A", target: "W/Tasks/B" }],
		]);
		const root: ElkLayoutNode = {
			id: "root",
			children: [{ id: "W/Tasks/A", x: 0, y: 0, width: 220, height: 64 }],
			edges: [
				{
					id: "e0",
					sections: [{ startPoint: { x: 5, y: 5 }, endPoint: { x: 15, y: 25 } }],
				},
			],
		};

		const flat = flattenCanvasLayout(root, meta, OPTS);
		expect(flat.edges).toEqual([
			{
				d: "M 5 5 L 15 25",
				kind: "hierarchy",
				source: "W/Tasks/A",
				target: "W/Tasks/B",
			},
		]);
	});

	it("offsets within-group edges by their container, not the root", () => {
		// ELK hoists every edge onto `root.edges`. An edge between two nodes
		// inside the same compound carries `container` = that compound and its
		// section points *relative to it* — flattening it against the root
		// origin would start the line ~12px inside the source card (hidden
		// behind it, visible only through a hover-dimmed card).
		const meta = new Map<string, EdgeMeta>([
			["within1", { kind: "hierarchy", source: "A", target: "B" }],
		]);
		const root: ElkLayoutNode = {
			id: "root",
			children: [
				{
					id: "group:todo",
					x: 12,
					y: 12,
					width: 4000,
					height: 4000,
					children: [
						{ id: "A", x: 16, y: 34, width: 220, height: 64 },
						{ id: "B", x: 16, y: 234, width: 220, height: 64 },
					],
				},
			],
			edges: [
				{
					id: "within1",
					container: "group:todo",
					sections: [
						{
							// A and B's boundaries in group-local space —
							// A's bottom edge centre (126, 98) and B's top
							// edge centre (126, 234).
							startPoint: { x: 126, y: 98 },
							endPoint: { x: 126, y: 234 },
						},
					],
				},
			],
		};

		const flat = flattenCanvasLayout(root, meta, OPTS);

		// Absolute anchors: A's bottom edge at 12+98 = 110, B's top at 246.
		expect(flat.edges).toEqual([
			{
				d: "M 138 110 L 138 246",
				kind: "hierarchy",
				source: "A",
				target: "B",
			},
		]);
	});

	it("treats a missing container as the root origin", () => {
		const meta = new Map<string, EdgeMeta>([
			["e0", { kind: "dependency", source: "A", target: "B" }],
		]);
		const root: ElkLayoutNode = {
			id: "root",
			children: [{ id: "A", x: 0, y: 0, width: 220, height: 64 }],
			edges: [
				{
					id: "e0",
					sections: [{ startPoint: { x: 2, y: 3 }, endPoint: { x: 9, y: 8 } }],
				},
			],
		};

		const flat = flattenCanvasLayout(root, meta, OPTS);
		expect(flat.edges[0].d).toBe("M 2 3 L 9 8");
	});
});

describe("collectElkOrigins", () => {
	it("records every node's absolute origin, including a leaf-less compound", () => {
		const root: ElkLayoutNode = {
			id: "root",
			children: [
				{
					id: "group:empty",
					x: 300,
					y: 40,
					children: [],
				},
				{
					id: "group:full",
					x: 12,
					y: 12,
					children: [{ id: "A", x: 4, y: 8, width: 220, height: 64 }],
				},
			],
		};
		const origins = collectElkOrigins(root);
		expect(origins.get("root")).toEqual({ x: 0, y: 0 });
		expect(origins.get("group:empty")).toEqual({ x: 300, y: 40 });
		expect(origins.get("group:full")).toEqual({ x: 12, y: 12 });
		expect(origins.get("A")).toEqual({ x: 16, y: 20 });
	});
});

describe("packCanvasGrid", () => {
	const node = (id: string): CanvasNode => ({ id, task: task({ id, path: id }) });

	it("preserves input order — never re-sorts", () => {
		const nodes = [node("C"), node("A"), node("B")];
		const positions = packCanvasGrid(nodes, 100, 50, 10, 3);
		expect(positions.map((p) => p.id)).toEqual(["C", "A", "B"]);
	});

	it("wraps into rows at the given column count", () => {
		const nodes = ["A", "B", "C", "D", "E"].map(node);
		const positions = packCanvasGrid(nodes, 100, 50, 10, 2);
		expect(positions).toEqual([
			{ id: "A", x: 0, y: 0 },
			{ id: "B", x: 110, y: 0 },
			{ id: "C", x: 0, y: 60 },
			{ id: "D", x: 110, y: 60 },
			{ id: "E", x: 0, y: 120 },
		]);
	});

	it("a single column stacks straight down", () => {
		const nodes = ["A", "B", "C"].map(node);
		const positions = packCanvasGrid(nodes, 100, 50, 10, 1);
		expect(positions.map((p) => p.y)).toEqual([0, 60, 120]);
		expect(positions.every((p) => p.x === 0)).toBe(true);
	});

	it("returns an empty array for an empty node set", () => {
		expect(packCanvasGrid([], 100, 50, 10, 3)).toEqual([]);
	});
});

describe("mergeIsolatedIntoLayout", () => {
	const gridBox = (id: string, x: number, y: number): IsolatedGridBox => ({
		id,
		x,
		y,
		width: 220,
		height: 64,
	});

	it("returns the base layout unchanged when there's nothing isolated", () => {
		const base = flattenCanvasLayout(
			{ id: "root", children: [{ id: "A", x: 0, y: 0, width: 220, height: 64 }] },
			new Map(),
			OPTS,
		);
		const merged = mergeIsolatedIntoLayout(base, new Map(), new Map(), "right");
		expect(merged).toBe(base);
	});

	it("appends the flat/root isolated grid below the connected block when direction is right", () => {
		const root: ElkLayoutNode = {
			id: "root",
			children: [{ id: "A", x: 0, y: 0, width: 220, height: 64 }],
		};
		const base = flattenCanvasLayout(root, new Map(), OPTS);
		const isolated = new Map([
			["root", [gridBox("B", 0, 0), gridBox("C", 230, 0)]],
		]);
		const merged = mergeIsolatedIntoLayout(base, isolated, collectElkOrigins(root), "right");

		expect(merged.nodes.get("A")).toEqual(base.nodes.get("A"));
		expect(merged.nodes.get("B")).toEqual({ x: 0, y: 64 + ISOLATED_GRID_GAP, width: 220, height: 64 });
		expect(merged.nodes.get("C")).toEqual({ x: 230, y: 64 + ISOLATED_GRID_GAP, width: 220, height: 64 });
		expect(merged.height).toBeGreaterThanOrEqual(64 + ISOLATED_GRID_GAP + 64);
	});

	it("appends to the right of the connected block when direction is down", () => {
		const root: ElkLayoutNode = {
			id: "root",
			children: [{ id: "A", x: 0, y: 0, width: 220, height: 64 }],
		};
		const base = flattenCanvasLayout(root, new Map(), OPTS);
		const isolated = new Map([["root", [gridBox("B", 0, 0)]]]);
		const merged = mergeIsolatedIntoLayout(base, isolated, collectElkOrigins(root), "down");

		expect(merged.nodes.get("B")).toEqual({
			x: 220 + ISOLATED_GRID_GAP,
			y: 0,
			width: 220,
			height: 64,
		});
	});

	it("starts at the root's own origin when nothing at all is connected (fully-edgeless degenerate case)", () => {
		const root: ElkLayoutNode = { id: "root", children: [] };
		const base = flattenCanvasLayout(root, new Map(), OPTS);
		const isolated = new Map([["root", [gridBox("A", 0, 0), gridBox("B", 230, 0)]]]);
		const merged = mergeIsolatedIntoLayout(base, isolated, collectElkOrigins(root), "right");
		expect(merged.nodes.get("A")).toEqual({ x: 0, y: 0, width: 220, height: 64 });
		expect(merged.nodes.get("B")).toEqual({ x: 230, y: 0, width: 220, height: 64 });
	});

	it("extends a partially-isolated group's box to tight-fit around its isolated grid too", () => {
		const root: ElkLayoutNode = {
			id: "root",
			children: [
				{
					id: "group:todo",
					x: 0,
					y: 0,
					children: [{ id: "A", x: 0, y: 0, width: 220, height: 64 }],
				},
			],
		};
		const base = flattenCanvasLayout(root, new Map(), OPTS);
		const before = base.groups.get("group:todo")!;

		const isolated = new Map([["group:todo", [gridBox("B", 0, 0)]]]);
		const merged = mergeIsolatedIntoLayout(base, isolated, collectElkOrigins(root), "right");
		const after = merged.groups.get("group:todo")!;

		// Same left/top edge (the isolated grid appends below, not left of).
		expect(after.x).toBe(before.x);
		expect(after.y).toBe(before.y);
		// Taller, to actually enclose the appended card.
		expect(after.height).toBeGreaterThan(before.height);
		expect(merged.nodes.get("B")!.y).toBeGreaterThanOrEqual(
			before.y + before.height,
		);
	});

	it("sizes a fully-isolated group from its grid alone, anchored to wherever ELK placed the empty compound", () => {
		const root: ElkLayoutNode = {
			id: "root",
			children: [{ id: "group:done", x: 400, y: 20, children: [] }],
		};
		const base = flattenCanvasLayout(root, new Map(), OPTS);
		// Nothing to tight-fit — the group never appears in `base.groups` at all.
		expect(base.groups.has("group:done")).toBe(false);

		const isolated = new Map([
			["group:done", [gridBox("X", 0, 0), gridBox("Y", 230, 0)]],
		]);
		const merged = mergeIsolatedIntoLayout(base, isolated, collectElkOrigins(root), "right");
		const box = merged.groups.get("group:done")!;

		// Anchored right back to where ELK placed the empty compound (padding
		// applied going in, then reversed coming back out of the tight-fit).
		expect(box.x).toBe(400);
		expect(box.y).toBe(20);
		expect(box.width).toBeGreaterThanOrEqual(230 + 220);
		expect(merged.nodes.get("X")).toBeDefined();
		expect(merged.nodes.get("Y")).toBeDefined();
	});

	it("extends the overall width/height so fitToView/the viewBox never crop the isolated grid", () => {
		const root: ElkLayoutNode = {
			id: "root",
			children: [{ id: "A", x: 0, y: 0, width: 220, height: 64 }],
		};
		const base = flattenCanvasLayout(root, new Map(), OPTS);
		const isolated = new Map([
			["root", [gridBox("B", 0, 0), gridBox("C", 0, 500)]],
		]);
		const merged = mergeIsolatedIntoLayout(base, isolated, collectElkOrigins(root), "right");
		expect(merged.height).toBeGreaterThanOrEqual(500 + 64);
		expect(merged.width).toBeGreaterThanOrEqual(base.width);
	});
});

describe("createLayoutGuard — out-of-order ELK resolutions", () => {
	it("commits only the most recent begin()", () => {
		const guard = createLayoutGuard();
		const first = guard.begin();
		const second = guard.begin();
		const third = guard.begin();
		// A slow response for `first` lands after a fast one for `third` — it
		// must be dropped, never overwrite the freshest layout.
		expect(guard.isCurrent(first)).toBe(false);
		expect(guard.isCurrent(second)).toBe(false);
		expect(guard.isCurrent(third)).toBe(true);
	});

	it("ids are strictly increasing", () => {
		const guard = createLayoutGuard();
		const ids = Array.from({ length: 50 }, () => guard.begin());
		for (let i = 1; i < ids.length; i += 1) {
			expect(ids[i]).toBe(ids[i - 1] + 1);
		}
	});

	it("a fresh guard has nothing current", () => {
		expect(createLayoutGuard().isCurrent(1)).toBe(false);
	});
});

describe("canvasEdgePoints — snapped overlay edge geometry", () => {
	// Cards are 100×40: `src` centre (50, 20), each `tgt` centre is chosen so
	// the numbers come out clean. Default target inset is 7.

	it("horizontal: exits the source right edge, enters the target left edge", () => {
		// `tgt` centre (250, 20), directly right of the source.
		const pts = canvasEdgePoints(
			{ x: 0, y: 0, width: 100, height: 40 },
			{ x: 200, y: 0, width: 100, height: 40 },
		)!;
		expect(pts.start).toEqual({ x: 100, y: 20 });
		expect(pts.end).toEqual({ x: 193, y: 20 }); // 200 − 7
	});

	it("reverse direction: source right of target", () => {
		// `tgt` centre (50, 20), directly left of the source.
		const pts = canvasEdgePoints(
			{ x: 200, y: 0, width: 100, height: 40 }, // centre (250, 20)
			{ x: 0, y: 0, width: 100, height: 40 }, // centre (50, 20)
		)!;
		expect(pts.start).toEqual({ x: 200, y: 20 });
		// End sits on the target's right edge, pulled back *toward the source*
		// (still +x), so it never pokes inside the target.
		expect(pts.end).toEqual({ x: 107, y: 20 }); // 100 + 7
	});

	it("vertical: exits the source bottom edge, enters the target top edge", () => {
		// `tgt` centre (50, 120), directly below the source.
		const pts = canvasEdgePoints(
			{ x: 0, y: 0, width: 100, height: 40 },
			{ x: 0, y: 100, width: 100, height: 40 },
		)!;
		expect(pts.start).toEqual({ x: 50, y: 40 });
		expect(pts.end).toEqual({ x: 50, y: 93 });
	});

	it("diagonal: exits whichever boundary the ray hits first, both ends on the line", () => {
		// `tgt` centre (290, 200). The ray (0.8, 0.6) reaches the source's
		// bottom edge (t = 20/0.6 ≈ 33.33) before its right edge (t = 62.5),
		// and the target's top edge at the same t from its centre.
		const pts = canvasEdgePoints(
			{ x: 0, y: 0, width: 100, height: 40 },
			{ x: 240, y: 180, width: 100, height: 40 },
		)!;
		expect(pts.start.x).toBeCloseTo(76.666667, 6);
		expect(pts.start.y).toBeCloseTo(40, 6);
		expect(pts.end.x).toBeCloseTo(257.733333, 6); // 263.333 − 0.8·7
		expect(pts.end.y).toBeCloseTo(175.8, 6); // 180 − 0.6·7
		// Both endpoints stay exactly on the centre-to-centre line.
		expect((pts.end.y - 20) / (pts.end.x - 50)).toBeCloseTo(0.75, 6);
		expect((pts.start.y - 20) / (pts.start.x - 50)).toBeCloseTo(0.75, 6);
	});

	it("target inset only moves the end, by the requested amount, along the line", () => {
		const src = { x: 0, y: 0, width: 100, height: 40 };
		const tgt = { x: 200, y: 0, width: 100, height: 40 };

		// inset 0 → the end lands exactly on the target's boundary.
		const flush = canvasEdgePoints(src, tgt, 0)!;
		expect(flush.end).toEqual({ x: 200, y: 20 });
		// The start is not inset — it stays on the source's boundary.
		expect(flush.start).toEqual({ x: 100, y: 20 });

		// default inset pulls back 7; a custom inset pulls back exactly 3.5.
		expect(canvasEdgePoints(src, tgt)!.end.x).toBe(193);
		expect(canvasEdgePoints(src, tgt, 3.5)!.end).toEqual({ x: 196.5, y: 20 });
	});

	it("formats the M…L path and returns null for coincident centres", () => {
		const src = { x: 0, y: 0, width: 100, height: 40 };
		const tgt = { x: 200, y: 0, width: 100, height: 40 };
		expect(canvasEdgeLinePath(src, tgt)).toBe("M 100 20 L 193 20");
		expect(canvasEdgeLinePath(src, src)).toBeNull();
	});
});
