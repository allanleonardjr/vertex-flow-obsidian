import { describe, expect, it } from "vitest";
import {
	DEFAULT_STATUSES,
	addValue,
	applyTaxonomyDeletion,
	categoryOf,
	createTaxonomy,
	describeUsage,
	displayName,
	findTaxonomyUsage,
	isCompleted,
	isOpen,
	listValues,
	planTaxonomyDeletion,
	reassignValue,
	reassignValues,
	reorderValues,
	statusesInCategory,
	updateValue,
	workspaceTaxonomies,
	withTaxonomy,
} from "../../src/core/taxonomy";
import { sampleSnapshot } from "../../src/core/sample/generate";
import type { LabelValue, PriorityValue, StatusValue } from "../../src/core/types";

const statuses = () => createTaxonomy<StatusValue>("status", DEFAULT_STATUSES);
const priorities = () =>
	createTaxonomy<PriorityValue>("priority", [
		{ id: "high", name: "High", color: "#f00", order: 1 },
		{ id: "low", name: "Low", color: "#00f", order: 2 },
	]);
const labels = () =>
	createTaxonomy<LabelValue>("label", [
		{ id: "perf", name: "Performance", color: "#f97316" },
		{ id: "design", name: "Design", color: "#a855f7" },
	]);

describe("schema configuration", () => {
	it("configures the four taxonomies as §5 specifies", () => {
		expect(statuses().schema).toMatchObject({
			multiSelect: false,
			ordered: true,
			categorized: true,
		});
		expect(priorities().schema).toMatchObject({
			multiSelect: false,
			ordered: true,
			categorized: false,
		});
		expect(createTaxonomy("taskType", []).schema).toMatchObject({
			multiSelect: false,
			ordered: false,
			categorized: false,
		});
		expect(labels().schema).toMatchObject({
			multiSelect: true,
			ordered: false,
			categorized: false,
		});
	});
});

describe("reading", () => {
	it("sorts ordered taxonomies by order and unordered ones by name", () => {
		expect(listValues(priorities()).map((v) => v.id)).toEqual(["high", "low"]);
		expect(listValues(labels()).map((v) => v.id)).toEqual(["design", "perf"]);
	});

	it("falls back to the raw id for a value that no longer exists", () => {
		expect(displayName(statuses(), "ghost")).toBe("ghost");
		expect(displayName(statuses(), null)).toBe("None");
		expect(displayName(statuses(), "done")).toBe("Done");
	});
});

describe("status categories", () => {
	it("drives logic from the category, not the name", () => {
		// Rename "Done" to something else entirely — the category must still win.
		const renamed = updateValue(statuses(), "done", { name: "Shipped 🚢" });
		expect(displayName(renamed, "done")).toBe("Shipped 🚢");
		expect(categoryOf(renamed, "done")).toBe("completed");
		expect(isCompleted(renamed, "done")).toBe(true);
		expect(isOpen(renamed, "done")).toBe(false);
	});

	it("treats canceled as closed but not completed", () => {
		expect(isCompleted(statuses(), "canceled")).toBe(false);
		expect(isOpen(statuses(), "canceled")).toBe(false);
	});

	it("tolerates a category with zero statuses (§5.1)", () => {
		const withoutCanceled = statuses();
		const plan = planTaxonomyDeletion(withoutCanceled, "canceled", 0);
		const { taxonomy } = applyTaxonomyDeletion(withoutCanceled, plan, null);
		expect(statusesInCategory(taxonomy, "canceled")).toEqual([]);
		expect(statusesInCategory(taxonomy, "completed")).toHaveLength(1);
	});
});

describe("mutation", () => {
	it("adds a value with a slugified id and a trailing order", () => {
		const next = addValue(priorities(), { name: "No Priority", color: "#999" });
		const added = next.values.find((v) => v.id === "no-priority");
		expect(added?.order).toBe(3);
	});

	it("requires a category when adding a status", () => {
		expect(() => addValue(statuses(), { name: "Blocked", color: "#f00" })).toThrow(
			/needs a category/,
		);
		expect(() =>
			addValue(statuses(), { name: "Blocked", color: "#f00", category: "started" }),
		).not.toThrow();
	});

	it("rejects a duplicate id", () => {
		expect(() =>
			addValue(priorities(), { id: "high", name: "High Again", color: "#f00" }),
		).toThrow(/already exists/);
	});

	it("never mutates the original taxonomy", () => {
		const original = priorities();
		addValue(original, { name: "Urgent", color: "#f00" });
		expect(original.values).toHaveLength(2);
	});

	it("renumbers order on reorder", () => {
		const next = reorderValues(statuses(), ["done", "queue"]);
		expect(next.values.map((v) => [v.id, v.order])).toEqual([
			["done", 1],
			["queue", 2],
			["todo", 3],
			["in-progress", 4],
			["canceled", 5],
		]);
	});

	it("refuses to reorder an unordered taxonomy", () => {
		expect(() => reorderValues(labels(), ["perf"])).toThrow(/not an ordered/);
	});
});

describe("the uniform deletion guard (§5.6)", () => {
	it("allows deleting an unused value outright", () => {
		const plan = planTaxonomyDeletion(priorities(), "low", 0);
		expect(plan.blocked).toBe(false);
		const { taxonomy, replacementId } = applyTaxonomyDeletion(
			priorities(),
			plan,
			null,
		);
		expect(taxonomy.values.map((v) => v.id)).toEqual(["high"]);
		expect(replacementId).toBeNull();
	});

	it("blocks deleting a value that is in use until a replacement is chosen", () => {
		const plan = planTaxonomyDeletion(priorities(), "high", 4);
		expect(plan.blocked).toBe(true);
		expect(plan.replacementCandidates.map((v) => v.id)).toEqual(["low"]);
		expect(() => applyTaxonomyDeletion(priorities(), plan, null)).toThrow(
			/Choose a replacement first/,
		);
	});

	it("applies identically to all four taxonomies", () => {
		for (const taxonomy of [statuses(), priorities(), labels()]) {
			const id = taxonomy.values[0].id;
			const plan = planTaxonomyDeletion(taxonomy, id, 1);
			expect(plan.blocked).toBe(true);
			expect(() => applyTaxonomyDeletion(taxonomy, plan, null)).toThrow();
		}
	});

	it("rejects a value replacing itself, or a replacement that doesn't exist", () => {
		const plan = planTaxonomyDeletion(priorities(), "high", 1);
		expect(() => applyTaxonomyDeletion(priorities(), plan, "high")).toThrow(
			/its own replacement/,
		);
		expect(() => applyTaxonomyDeletion(priorities(), plan, "ghost")).toThrow(
			/No priority with id/,
		);
	});

	it("flags the impossible case: the last value, still in use", () => {
		const single = createTaxonomy<PriorityValue>("priority", [
			{ id: "only", name: "Only", color: "#f00", order: 1 },
		]);
		const plan = planTaxonomyDeletion(single, "only", 3);
		expect(plan.lastValueInUse).toBe(true);
		expect(plan.replacementCandidates).toEqual([]);
	});

	it("renumbers order after deleting from an ordered taxonomy", () => {
		const plan = planTaxonomyDeletion(statuses(), "todo", 0);
		const { taxonomy } = applyTaxonomyDeletion(statuses(), plan, null);
		expect(taxonomy.values.map((v) => v.order)).toEqual([1, 2, 3, 4]);
	});
});

describe("reassignment", () => {
	it("rewrites a single-select field only when it matches", () => {
		expect(reassignValue("high", "high", "low")).toBe("low");
		expect(reassignValue("medium", "high", "low")).toBe("medium");
		expect(reassignValue(null, "high", "low")).toBeNull();
	});

	it("rewrites and de-duplicates a multi-select field", () => {
		expect(reassignValues(["perf", "design"], "perf", "design")).toEqual([
			"design",
		]);
		expect(reassignValues(["a", "b"], "c", "d")).toEqual(["a", "b"]);
	});

	it("returns the same array reference when nothing changed", () => {
		const labels = ["a", "b"];
		expect(reassignValues(labels, "c", "d")).toBe(labels);
	});
});

describe("usage counting", () => {
	const snapshot = sampleSnapshot();

	it("counts task usage across every taxonomy", () => {
		const bugs = findTaxonomyUsage("taskType", "bug", { tasks: snapshot.tasks });
		expect(bugs.count).toBe(1);

		const perf = findTaxonomyUsage("label", "performance", {
			tasks: snapshot.tasks,
		});
		expect(perf.count).toBe(1);
	});

	it("counts projects and initiatives for status, since they share it (§5.1)", () => {
		const usage = findTaxonomyUsage("status", "in-progress", {
			tasks: snapshot.tasks,
			projects: snapshot.projects,
			initiatives: snapshot.initiatives,
		});
		expect(usage.projectPaths).toHaveLength(1);
		expect(usage.initiativePaths).toHaveLength(1);
		expect(usage.count).toBe(
			usage.taskPaths.length + usage.projectPaths.length + usage.initiativePaths.length,
		);
	});

	it("does not count projects for non-status taxonomies", () => {
		const usage = findTaxonomyUsage("priority", "high", {
			tasks: snapshot.tasks,
			projects: snapshot.projects,
		});
		expect(usage.projectPaths).toEqual([]);
	});

	it("describes usage in readable prose", () => {
		expect(
			describeUsage({
				count: 1,
				taskPaths: ["a"],
				projectPaths: [],
				initiativePaths: [],
			}),
		).toBe("1 task");
		expect(
			describeUsage({
				count: 5,
				taskPaths: ["a", "b", "c"],
				projectPaths: ["p"],
				initiativePaths: ["i"],
			}),
		).toBe("3 tasks, 1 project and 1 initiative");
	});
});

describe("workspace wiring", () => {
	it("builds all four taxonomies from a workspace config", () => {
		const snapshot = sampleSnapshot();
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		expect(Object.keys(taxonomies)).toEqual([
			"status",
			"priority",
			"taskType",
			"label",
		]);
		expect(taxonomies.label.values).toHaveLength(3);
	});

	it("writes a modified taxonomy back to the right config field", () => {
		const snapshot = sampleSnapshot();
		const next = withTaxonomy(
			snapshot.workspace,
			addValue(createTaxonomy("label", snapshot.workspace.labels), {
				name: "Security",
				color: "#f00",
			}),
		);
		expect(next.labels.map((l) => l.id)).toContain("security");
		expect(next.statuses).toEqual(snapshot.workspace.statuses);
	});
});
