import { describe, expect, it } from "vitest";
import { buildCanvasGraph } from "../../src/core/canvas/graph";
import { emptyRelations } from "../../src/core/types";
import { task } from "./fixtures";

const t = (id: string, relations: Partial<ReturnType<typeof emptyRelations>> = {}) =>
	task({
		id,
		path: `W/Tasks/${id}`,
		relations: { ...emptyRelations(), ...relations },
	});

describe("buildCanvasGraph", () => {
	it("makes one node per task, edge order blocker → blocked", () => {
		const a = t("A", { blocks: ["W/Tasks/B"] });
		const b = t("B");
		const { nodes, edges } = buildCanvasGraph([a, b]);

		expect(nodes.map((n) => n.id)).toEqual(["W/Tasks/A", "W/Tasks/B"]);
		expect(edges).toEqual([{ source: "W/Tasks/A", target: "W/Tasks/B" }]);
	});

	it("dedupes a relation declared from both sides", () => {
		const a = t("A", { blocks: ["W/Tasks/B"] });
		const b = t("B", { blockedBy: ["W/Tasks/A"] });
		const { edges } = buildCanvasGraph([a, b]);

		expect(edges).toEqual([{ source: "W/Tasks/A", target: "W/Tasks/B" }]);
	});

	it("reads a one-sided relation (forgiving-parse)", () => {
		const a = t("A");
		const b = t("B", { blockedBy: ["W/Tasks/A"] });
		const { edges } = buildCanvasGraph([a, b]);

		expect(edges).toEqual([{ source: "W/Tasks/A", target: "W/Tasks/B" }]);
	});

	it("drops an edge when an endpoint is filtered out of the visible set", () => {
		const a = t("A", { blocks: ["W/Tasks/GONE"] });
		const { nodes, edges } = buildCanvasGraph([a]);

		expect(nodes).toHaveLength(1);
		expect(edges).toEqual([]);
	});

	it("keeps tasks with no relations as isolated nodes", () => {
		const graph = buildCanvasGraph([t("A"), t("B"), t("C")]);

		expect(graph.nodes).toHaveLength(3);
		expect(graph.edges).toEqual([]);
	});

	it("ignores a self-referential relation", () => {
		const a = t("A", { blocks: ["W/Tasks/A"] });
		expect(buildCanvasGraph([a]).edges).toEqual([]);
	});
});
