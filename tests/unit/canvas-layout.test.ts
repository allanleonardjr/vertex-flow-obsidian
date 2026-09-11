import { describe, expect, it } from "vitest";
import {
	DEFAULT_GROUP_PADDING as PAD,
	canvasEdgeLinePath,
	canvasEdgePoints,
	createLayoutGuard,
	flattenCanvasLayout,
	type EdgeMeta,
	type ElkLayoutNode,
} from "../../src/core/canvas/layout";

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
