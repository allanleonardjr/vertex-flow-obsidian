import { describe, expect, it } from "vitest";
import { buildNestedRows, focusableRowPaths } from "../../src/core/views";
import type { HierarchyScope } from "../../src/core/hierarchy";
import { emptyRelations, type Task } from "../../src/core/types";

/** A task with just the fields the nesting builder reads. */
function task(path: string, parent: string | null, rank: string): Task {
	return {
		type: "task",
		path,
		id: path,
		title: path,
		taskType: null,
		status: "queue",
		priority: null,
		rank,
		project: null,
		parent,
		assignee: null,
		estimate: null,
		labels: [],
		startDate: null,
		dueDate: null,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		mentions: [],
	};
}

// A: B (→ C), E     D
const A = task("A", null, "0|a00000:");
const B = task("B", "A", "0|b00000:");
const C = task("C", "B", "0|c00000:");
const E = task("E", "A", "0|e00000:");
const D = task("D", null, "0|d00000:");
const ALL = [A, B, C, D, E];
const scope: HierarchyScope = { tasks: ALL, projects: [] };
const allPaths = new Set(ALL.map((t) => t.path));

const shape = (rows: ReturnType<typeof buildNestedRows>) =>
	rows.map((r) => `${r.ghost ? "~" : ""}${r.task.id}@${r.depth}`);

describe("buildNestedRows", () => {
	it("nests a full forest depth-first, rank-ordered per level", () => {
		const rows = buildNestedRows(ALL, scope, { matchedPaths: allPaths });
		expect(shape(rows)).toEqual(["A@0", "B@1", "C@2", "E@1", "D@0"]);
		expect(rows.find((r) => r.task.id === "A")?.hasChildren).toBe(true);
		expect(rows.find((r) => r.task.id === "C")?.hasChildren).toBe(false);
	});

	it("adds ghost ancestors when the parent chain was filtered out", () => {
		const rows = buildNestedRows([C], scope, {
			matchedPaths: new Set(["C"]),
		});
		expect(shape(rows)).toEqual(["~A@0", "~B@1", "C@2"]);
		expect(focusableRowPaths(rows)).toEqual(["C"]);
	});

	it("closes the gap under a shown ancestor without a ghost", () => {
		// B filtered out, A and C kept: C hangs off A directly.
		const rows = buildNestedRows([A, C], scope, {
			matchedPaths: new Set(["A", "C"]),
		});
		expect(shape(rows)).toEqual(["A@0", "C@1"]);
	});

	it("omits a collapsed subtree but keeps the parent", () => {
		const rows = buildNestedRows(ALL, scope, {
			matchedPaths: allPaths,
			collapsed: new Set(["A"]),
		});
		expect(shape(rows)).toEqual(["A@0", "D@0"]);
		expect(rows.find((r) => r.task.id === "A")?.hasChildren).toBe(true);
	});

	it("is cycle-safe when two tasks name each other as parent", () => {
		const x = task("X", "Y", "0|x00000:");
		const y = task("Y", "X", "0|y00000:");
		const cyclic: HierarchyScope = { tasks: [x, y], projects: [] };
		const rows = buildNestedRows([x, y], cyclic, {
			matchedPaths: new Set(["X", "Y"]),
		});
		expect(rows).toHaveLength(2);
	});
});
