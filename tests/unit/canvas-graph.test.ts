import { describe, expect, it } from "vitest";
import { buildCanvasGraph } from "../../src/core/canvas/graph";
import { emptyRelations } from "../../src/core/types";
import { project, task } from "./fixtures";

const t = (
	id: string,
	overrides: {
		relations?: Partial<ReturnType<typeof emptyRelations>>;
		project?: string;
		parent?: string;
	} = {},
) =>
	task({
		id,
		path: `W/Tasks/${id}`,
		project: overrides.project ?? null,
		parent: overrides.parent ?? null,
		relations: { ...emptyRelations(), ...overrides.relations },
	});

const deps = (g: ReturnType<typeof buildCanvasGraph>) =>
	g.layeringEdges
		.filter((e) => e.kind === "dependency")
		.map((e) => ({ source: e.source, target: e.target }));

describe("buildCanvasGraph — dependency edges (Phase 1)", () => {
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

	it("drops an edge when an endpoint is filtered out of the visible set", () => {
		const a = t("A", { relations: { blocks: ["W/Tasks/GONE"] } });
		const g = buildCanvasGraph([a]);
		expect(g.nodes).toHaveLength(1);
		expect(g.layeringEdges).toEqual([]);
	});

	it("keeps tasks with no relations as isolated nodes", () => {
		const g = buildCanvasGraph([t("A"), t("B"), t("C")]);
		expect(g.nodes).toHaveLength(3);
		expect(g.layeringEdges).toEqual([]);
	});

	it("ignores a self-referential relation", () => {
		const a = t("A", { relations: { blocks: ["W/Tasks/A"] } });
		expect(buildCanvasGraph([a]).layeringEdges).toEqual([]);
	});
});

describe("buildCanvasGraph — project grouping (Phase 2)", () => {
	it("groups every task sharing a project into one box", () => {
		const p = project({ path: "W/Projects/P", title: "P" });
		const a = t("A", { project: "W/Projects/P" });
		const b = t("B", { project: "W/Projects/P" });
		const c = t("C");

		const g = buildCanvasGraph([a, b, c], [p]);

		expect(g.projectGroups).toHaveLength(1);
		expect(g.projectGroups[0]).toMatchObject({
			id: "project:W/Projects/P",
			taskPaths: ["W/Tasks/A", "W/Tasks/B"],
		});
	});

	it("falls back to top-level for a broken/missing project reference", () => {
		const a = t("A", { project: "W/Projects/GONE" });
		const g = buildCanvasGraph([a], []);

		expect(g.projectGroups).toEqual([]);
		expect(g.nodes.map((n) => n.id)).toEqual(["W/Tasks/A"]);
	});
});

describe("buildCanvasGraph — hierarchy edges (Phase 2)", () => {
	it("adds a hierarchy edge parent → child crossing two projects", () => {
		const p1 = project({ path: "W/Projects/P1" });
		const p2 = project({ path: "W/Projects/P2" });
		const parent = t("PAR", { project: "W/Projects/P1" });
		const child = t("CHI", { project: "W/Projects/P2", parent: "W/Tasks/PAR" });

		const g = buildCanvasGraph([parent, child], [p1, p2]);

		expect(g.layeringEdges).toContainEqual({
			source: "W/Tasks/PAR",
			target: "W/Tasks/CHI",
			kind: "hierarchy",
		});
		// The two still land in different boxes.
		expect(g.projectGroups.map((grp) => grp.id).sort()).toEqual([
			"project:W/Projects/P1",
			"project:W/Projects/P2",
		]);
	});

	it("drops a hierarchy edge whose parent isn't visible", () => {
		const child = t("CHI", { parent: "W/Tasks/GONE" });
		expect(buildCanvasGraph([child]).layeringEdges).toEqual([]);
	});
});

describe("buildCanvasGraph — related edges (Phase 2)", () => {
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
