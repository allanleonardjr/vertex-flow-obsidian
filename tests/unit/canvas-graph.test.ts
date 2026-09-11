import { describe, expect, it } from "vitest";
import {
	buildCanvasGraph,
	filterCanvasGraph,
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
