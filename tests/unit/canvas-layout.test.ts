import { describe, expect, it } from "vitest";
import {
	DEFAULT_GROUP_PADDING as PAD,
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
});
