import { describe, expect, it } from "vitest";
import { canvasGrouping } from "../../src/core/canvas/graph";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { evaluateView, newView, snapshotContext } from "../../src/core/views";
import { NONE, type GroupByField, type SavedView } from "../../src/core/types";

const snapshot = sampleSnapshot();
const context = snapshotContext(snapshot, null);

const view = (partial: Partial<SavedView> = {}): SavedView => ({
	...newView("canvas", "Canvas", "canvas"),
	...partial,
});

const run = (groupBy: GroupByField, partial: Partial<SavedView> = {}) => {
	const v = view({ groupBy, ...partial });
	const evaluated = evaluateView(snapshot, v, context);
	return { evaluated, grouping: canvasGrouping(evaluated.groups, evaluated.tasks, groupBy) };
};

describe("canvasGrouping — box groupings", () => {
	for (const field of [
		"status",
		"priority",
		"taskType",
		"assignee",
		"project",
	] as const) {
		it(`groups into compound boxes by ${field}`, () => {
			const { evaluated, grouping } = run(field);

			expect(grouping.grouped).toBe(true);
			expect(grouping.boxes.length).toBeGreaterThan(0);

			// Boxes are exactly the non-hidden, non-empty groups Board would show.
			expect(grouping.boxes.map((b) => b.key).sort()).toEqual(
				evaluated.groups
					.filter((g) => !g.hidden && g.tasks.length > 0)
					.map((g) => g.key)
					.sort(),
			);

			// Every rendered task belongs to exactly one box.
			const boxed = grouping.boxes.flatMap((b) => b.tasks.map((t) => t.path));
			expect(boxed.length).toBe(grouping.tasks.length);
			expect(new Set(boxed).size).toBe(boxed.length);
		});
	}

	it("renders the None group as its own box, label verbatim", () => {
		const { evaluated, grouping } = run("project");
		const noneGroup = evaluated.groups.find((g) => g.key === NONE);
		// The sample workspace has unprojected tasks.
		expect(noneGroup).toBeDefined();
		const noneBox = grouping.boxes.find((b) => b.key === NONE);
		expect(noneBox?.label).toBe(noneGroup?.label);
	});

	it("drops tasks in a hidden group entirely", () => {
		const { evaluated } = run("status");
		const target = evaluated.groups.find(
			(g) => !g.hidden && g.tasks.length > 0,
		)!;

		const { grouping } = run("status", {
			columns: { collapsed: [], hidden: [target.key] },
		});

		expect(grouping.boxes.map((b) => b.key)).not.toContain(target.key);
		for (const t of target.tasks) {
			expect(grouping.tasks.map((x) => x.path)).not.toContain(t.path);
		}
	});
});

describe("canvasGrouping — flat groupings", () => {
	for (const field of ["label", "none"] as const) {
		it(`renders flat for ${field}`, () => {
			const { evaluated, grouping } = run(field);
			expect(grouping.grouped).toBe(false);
			expect(grouping.boxes).toEqual([]);
			expect(grouping.tasks).toBe(evaluated.tasks);
		});
	}
});
