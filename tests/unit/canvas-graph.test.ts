import { describe, expect, it } from "vitest";
import {
	buildCanvasGraph,
	canvasEdgePlan,
	canvasLayoutSignature,
	canvasTopologyKey,
	filterCanvasGraph,
	getCanvasElkOptions,
} from "../../src/core/canvas/graph";
import { emptyRelations } from "../../src/core/types";
import { task } from "./fixtures";

const t = (
	id: string,
	overrides: {
		relations?: Partial<ReturnType<typeof emptyRelations>>;
		parent?: string;
	} = {},
) =>
	task({
		id,
		path: `W/Tasks/${id}`,
		parent: overrides.parent ?? null,
		relations: { ...emptyRelations(), ...overrides.relations },
	});

const deps = (g: ReturnType<typeof buildCanvasGraph>) =>
	g.layeringEdges
		.filter((e) => e.kind === "dependency")
		.map((e) => ({ source: e.source, target: e.target }));

describe("buildCanvasGraph — dependency edges", () => {
	it("makes one node per task, edge order blocker → blocked", () => {
		const a = t("A", { relations: { blocks: ["W/Tasks/B"] } });
		const b = t("B");
		const g = buildCanvasGraph([a, b]);

		expect(g.nodes.map((n) => n.id)).toEqual(["W/Tasks/A", "W/Tasks/B"]);
		expect(deps(g)).toEqual([{ source: "W/Tasks/A", target: "W/Tasks/B" }]);
	});

	it("dedupes a relation declared from both sides", () => {
		const a = t("A", { relations: { blocks: ["W/Tasks/B"] } });
		const b = t("B", { relations: { blockedBy: ["W/Tasks/A"] } });
		expect(deps(buildCanvasGraph([a, b]))).toEqual([
			{ source: "W/Tasks/A", target: "W/Tasks/B" },
		]);
	});

	it("drops an edge when an endpoint isn't visible", () => {
		const a = t("A", { relations: { blocks: ["W/Tasks/GONE"] } });
		const g = buildCanvasGraph([a]);
		expect(g.nodes).toHaveLength(1);
		expect(g.layeringEdges).toEqual([]);
	});

	it("ignores a self-referential relation", () => {
		const a = t("A", { relations: { blocks: ["W/Tasks/A"] } });
		expect(buildCanvasGraph([a]).layeringEdges).toEqual([]);
	});
});

describe("buildCanvasGraph — hierarchy edges", () => {
	it("adds a thin parent → child edge, independent of grouping", () => {
		const parent = t("PAR");
		const child = t("CHI", { parent: "W/Tasks/PAR" });

		const g = buildCanvasGraph([parent, child]);

		expect(g.layeringEdges).toContainEqual({
			source: "W/Tasks/PAR",
			target: "W/Tasks/CHI",
			kind: "hierarchy",
		});
	});

	it("drops a hierarchy edge whose parent isn't visible", () => {
		const child = t("CHI", { parent: "W/Tasks/GONE" });
		expect(buildCanvasGraph([child]).layeringEdges).toEqual([]);
	});
});

describe("buildCanvasGraph — related edges", () => {
	it("dedupes a related pair regardless of which side declared it", () => {
		const a = t("A", { relations: { related: ["W/Tasks/B"] } });
		const b = t("B", { relations: { related: ["W/Tasks/A"] } });

		const g = buildCanvasGraph([a, b]);

		expect(g.relatedEdges).toEqual([{ a: "W/Tasks/A", b: "W/Tasks/B" }]);
		expect(g.layeringEdges).toEqual([]);
	});

	it("drops a related link pointing outside the visible set", () => {
		const a = t("A", { relations: { related: ["W/Tasks/GONE"] } });
		expect(buildCanvasGraph([a]).relatedEdges).toEqual([]);
	});
});

describe("filterCanvasGraph — relation-kind visibility", () => {
	const build = () => {
		const par = t("PAR");
		const chi = t("CHI", {
			parent: "W/Tasks/PAR",
			relations: { blocks: ["W/Tasks/PAR"], related: ["W/Tasks/PAR"] },
		});
		return buildCanvasGraph([par, chi]);
	};

	it("returns the same object when nothing is hidden", () => {
		const g = build();
		expect(filterCanvasGraph(g, [])).toBe(g);
	});

	it("drops hidden dependency edges from layeringEdges (so ELK never sees them)", () => {
		const g = filterCanvasGraph(build(), ["dependency"]);
		expect(g.layeringEdges.map((e) => e.kind)).toEqual(["hierarchy"]);
		expect(g.relatedEdges).toHaveLength(1);
	});

	it("drops hidden hierarchy edges from layeringEdges", () => {
		const g = filterCanvasGraph(build(), ["hierarchy"]);
		expect(g.layeringEdges.map((e) => e.kind)).toEqual(["dependency"]);
	});

	it("drops related edges only, leaving layering edges untouched", () => {
		const g = filterCanvasGraph(build(), ["related"]);
		expect(g.relatedEdges).toEqual([]);
		expect(g.layeringEdges).toHaveLength(2);
	});

	it("can hide every kind at once", () => {
		const g = filterCanvasGraph(build(), ["dependency", "hierarchy", "related"]);
		expect(g.layeringEdges).toEqual([]);
		expect(g.relatedEdges).toEqual([]);
		expect(g.nodes).toHaveLength(2);
	});
});

describe("getCanvasElkOptions", () => {
	it("maps flow → layered and tree → mrtree", () => {
		expect(getCanvasElkOptions("flow", "right")).toMatchObject({
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
		});
		expect(getCanvasElkOptions("tree", "down")).toMatchObject({
			"elk.algorithm": "mrtree",
			"elk.direction": "DOWN",
		});
	});

	it("never emits the ELK identifiers themselves as the direction option", () => {
		expect(getCanvasElkOptions("tree", "right")).toEqual({
			"elk.algorithm": "mrtree",
			"elk.direction": "RIGHT",
		});
	});
});

describe("canvasEdgePlan", () => {
	const build = () => {
		const par = t("PAR");
		const chi = t("CHI", {
			parent: "W/Tasks/PAR",
			relations: { blocks: ["W/Tasks/PAR"], related: ["W/Tasks/PAR"] },
		});
		return buildCanvasGraph([par, chi]);
	};

	it("flow feeds every layering edge to ELK and overlays nothing", () => {
		const plan = canvasEdgePlan(build(), "flow");
		expect(plan.layoutEdges).toHaveLength(2);
		expect(plan.overlayDependencyEdges).toEqual([]);
	});

	it("tree feeds only hierarchy edges to ELK", () => {
		const plan = canvasEdgePlan(build(), "tree");
		expect(plan.layoutEdges.map((e) => e.kind)).toEqual(["hierarchy"]);
	});

	it("tree overlays dependency edges for post-layout rendering", () => {
		const plan = canvasEdgePlan(build(), "tree");
		expect(plan.overlayDependencyEdges).toEqual([
			{ source: "W/Tasks/CHI", target: "W/Tasks/PAR", kind: "dependency" },
		]);
	});

	it("reports an empty layout edge set for a tree with no hierarchy — the fallback signal", () => {
		const a = t("A", { relations: { blocks: ["W/Tasks/B"] } });
		const b = t("B");
		const plan = canvasEdgePlan(buildCanvasGraph([a, b]), "tree");
		expect(plan.layoutEdges).toEqual([]);
		expect(plan.overlayDependencyEdges).toHaveLength(1);
	});

	it("respects hidden kinds: hiding hierarchy in tree mode leaves nothing to rank", () => {
		const par = t("PAR");
		const chi = t("CHI", {
			parent: "W/Tasks/PAR",
			relations: { blocks: ["W/Tasks/PAR"] },
		});
		const filtered = filterCanvasGraph(buildCanvasGraph([par, chi]), ["hierarchy"]);
		expect(canvasEdgePlan(filtered, "tree").layoutEdges).toEqual([]);
	});
});

describe("canvasTopologyKey / canvasLayoutSignature", () => {
	const par = t("PAR", { relations: { blocks: ["W/Tasks/A"] } });
	const chi = t("CHI", { parent: "W/Tasks/PAR" });
	const a = t("A");

	it("is stable across a title-only edit (cards repaint in place)", () => {
		const before = canvasTopologyKey([par, chi, a], []);
		const retitled = a;
		retitled.title = "Renamed just now";
		expect(canvasTopologyKey([par, chi, retitled], [])).toBe(before);
	});

	it("flips when a task is re-parented", () => {
		const before = canvasTopologyKey([par, chi, a], []);
		const reparented = t("CHI", { parent: "W/Tasks/A" });
		expect(canvasTopologyKey([par, reparented, a], [])).not.toBe(before);
	});

	it("flips when a relation changes", () => {
		const before = canvasTopologyKey([par, chi, a], []);
		const edited = t("A", { relations: { blocks: ["W/Tasks/PAR"] } });
		expect(canvasTopologyKey([par, chi, edited], [])).not.toBe(before);
	});

	it("tracks which box each task sits in", () => {
		const boxes = [{ key: "todo", tasks: [par, a] }];
		const flat = canvasTopologyKey([par, a], []);
		const grouped = canvasTopologyKey([par, a], boxes);
		expect(grouped).not.toBe(flat);
	});

	it("layout signature flips with arrangement and direction, not titles", () => {
		const opts = {
			grouped: false,
			arrangement: "flow" as const,
			direction: "right" as const,
		};
		const retitled = { ...a, title: "Other title" };
		expect(
			canvasLayoutSignature([par, chi, retitled], [], opts),
		).toBe(canvasLayoutSignature([par, chi, a], [], opts));
		expect(
			canvasLayoutSignature([par, chi, a], [], { ...opts, arrangement: "tree" }),
		).not.toBe(canvasLayoutSignature([par, chi, a], [], opts));
		expect(
			canvasLayoutSignature([par, chi, a], [], { ...opts, direction: "down" }),
		).not.toBe(canvasLayoutSignature([par, chi, a], [], opts));
	});
});
