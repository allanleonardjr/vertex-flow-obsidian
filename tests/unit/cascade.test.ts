import { describe, expect, it } from "vitest";
import {
	applyDeletion,
	danglingProjectEdits,
	danglingRelationEdits,
	describePlanChildren,
	planDeletion,
	planProjectDeletion,
	planTaskDeletion,
	scopeOf,
	type HierarchyScope,
} from "../../src/core/hierarchy";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { emptyRelations, type Project, type Task } from "../../src/core/types";

function task(overrides: Partial<Task> & { path: string }): Task {
	return {
		type: "task",
		id: overrides.path.split("/").pop() as string,
		title: overrides.path,
		taskType: null,
		status: "queue",
		priority: null,
		rank: "0|i00000:",
		project: null,
		parent: null,
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
		...overrides,
	};
}

function project(path: string): Project {
	return {
		type: "project",
		title: path,
		status: "queue",
		priority: null,
		labels: [],
		startDate: null,
		dueDate: null,
		owner: null,
		archived: false,
		archivedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		path,
	};
}

describe("planning", () => {
	it("offers no unparent option when there are no children", () => {
		const scope: HierarchyScope = { tasks: [task({ path: "T/1" })], projects: [] };
		const plan = planTaskDeletion(scope, scope.tasks[0]);
		expect(plan.hasChildren).toBe(false);
		expect(plan.options).toEqual(["cancel", "cascade"]);
	});

	it("offers cancel / unparent / cascade when there are children (§7.8)", () => {
		const scope: HierarchyScope = {
			tasks: [task({ path: "T/1" }), task({ path: "T/2", parent: "T/1" })],
			projects: [],
		};
		const plan = planTaskDeletion(scope, scope.tasks[0]);
		expect(plan.options).toEqual(["cancel", "unparent", "cascade"]);
		expect(plan.childTasks).toHaveLength(1);
	});

	it("lists direct children only, never grandchildren", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1" }),
				task({ path: "T/2", parent: "T/1" }),
				task({ path: "T/3", parent: "T/2" }),
			],
			projects: [],
		};
		const plan = planTaskDeletion(scope, scope.tasks[0]);
		expect(plan.childTasks.map((t) => t.path)).toEqual(["T/2"]);
	});

	it("counts a project's tasks", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1", project: "P/1" }),
				task({ path: "T/2", project: "P/1" }),
				task({ path: "T/3", project: "P/2" }),
			],
			projects: [project("P/1"), project("P/2")],
		};
		const plan = planProjectDeletion(scope, project("P/1"));
		expect(plan.childTasks.map((t) => t.path)).toEqual(["T/1", "T/2"]);
	});

	it("a project's childTasks are its top-level tasks only", () => {
		// T/2 carries `project: P/1` but is a sub-task of T/1 — it's a
		// hierarchical child of T/1, not of the project, so the project's
		// cascade/unparent choice must not list it for its own sake.
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1", project: "P/1" }),
				task({ path: "T/2", parent: "T/1", project: "P/1" }),
				task({ path: "T/3", parent: "T/2", project: "P/1" }),
			],
			projects: [project("P/1")],
		};
		const plan = planProjectDeletion(scope, project("P/1"));
		expect(plan.childTasks.map((t) => t.path)).toEqual(["T/1"]);
	});

	it("dispatches on entity type", () => {
		const scope: HierarchyScope = { tasks: [], projects: [] };
		expect(planDeletion(scope, task({ path: "T/1" })).kind).toBe("task");
		expect(planDeletion(scope, project("P/1")).kind).toBe("project");
	});
});

describe("cancel", () => {
	it("does nothing at all", () => {
		const scope: HierarchyScope = {
			tasks: [task({ path: "T/1" }), task({ path: "T/2", parent: "T/1" })],
			projects: [],
		};
		const plan = planTaskDeletion(scope, scope.tasks[0]);
		expect(applyDeletion(scope, plan, "cancel")).toEqual({
			deletePaths: [],
			edits: [],
			followUps: [],
		});
	});
});

describe("unparent", () => {
	it("clears `parent` on sub-tasks and deletes only the target", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1" }),
				task({ path: "T/2", parent: "T/1" }),
				task({ path: "T/3", parent: "T/1" }),
			],
			projects: [],
		};
		const outcome = applyDeletion(scope, planTaskDeletion(scope, scope.tasks[0]), "unparent");
		expect(outcome.deletePaths).toEqual(["T/1"]);
		expect(outcome.edits).toEqual([
			{ path: "T/2", field: "parent", value: null },
			{ path: "T/3", field: "parent", value: null },
		]);
		expect(outcome.followUps).toEqual([]);
	});

	it("clears `project` on a deleted project's tasks", () => {
		const scope: HierarchyScope = {
			tasks: [task({ path: "T/1", project: "P/1" })],
			projects: [project("P/1")],
		};
		const outcome = applyDeletion(
			scope,
			planProjectDeletion(scope, scope.projects[0]),
			"unparent",
		);
		expect(outcome.edits).toEqual([{ path: "T/1", field: "project", value: null }]);
	});

	it("does not promote children anywhere", () => {
		// Deleting the project must not silently re-point its tasks — that would
		// be inventing a hierarchy decision.
		const scope: HierarchyScope = {
			tasks: [task({ path: "T/1", project: "P/1" })],
			projects: [project("P/1")],
		};
		const outcome = applyDeletion(
			scope,
			planProjectDeletion(scope, scope.projects[0]),
			"unparent",
		);
		expect(outcome.edits).toEqual([{ path: "T/1", field: "project", value: null }]);
		expect(outcome.edits.some((e) => e.value !== null)).toBe(false);
	});
});

describe("cascade — one level at a time (§7.8)", () => {
	it("deletes childless children immediately", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1" }),
				task({ path: "T/2", parent: "T/1" }),
				task({ path: "T/3", parent: "T/1" }),
			],
			projects: [],
		};
		const outcome = applyDeletion(scope, planTaskDeletion(scope, scope.tasks[0]), "cascade");
		expect(outcome.deletePaths.sort()).toEqual(["T/1", "T/2", "T/3"]);
		expect(outcome.followUps).toEqual([]);
	});

	it("never reaches past one level: a child with children becomes a follow-up", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1" }),
				task({ path: "T/2", parent: "T/1" }),
				task({ path: "T/3", parent: "T/2" }),
			],
			projects: [],
		};
		const outcome = applyDeletion(scope, planTaskDeletion(scope, scope.tasks[0]), "cascade");

		// T/2 is NOT deleted here — it comes back as its own question.
		expect(outcome.deletePaths).toEqual(["T/1"]);
		expect(outcome.followUps).toHaveLength(1);
		expect(outcome.followUps[0].path).toBe("T/2");
		expect(outcome.followUps[0].childTasks.map((t) => t.path)).toEqual(["T/3"]);
	});

	it("asks again for each level of a deep tree", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1" }),
				task({ path: "T/2", parent: "T/1" }),
				task({ path: "T/3", parent: "T/2" }),
				task({ path: "T/4", parent: "T/3" }),
			],
			projects: [],
		};

		// Walk the chain, answering "cascade" at every prompt.
		let plan = planTaskDeletion(scope, scope.tasks[0]);
		const deleted: string[] = [];
		let prompts = 0;

		while (plan) {
			prompts++;
			const outcome = applyDeletion(scope, plan, "cascade");
			deleted.push(...outcome.deletePaths);
			plan = outcome.followUps[0];
		}

		expect(prompts).toBe(3); // T/1, then T/2, then T/3.
		expect(deleted.sort()).toEqual(["T/1", "T/2", "T/3", "T/4"]);
	});

	it("turns a project's task-with-sub-tasks into its own question", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1", project: "P/1" }),
				task({ path: "T/2", parent: "T/1" }),
				task({ path: "T/3", project: "P/1" }),
			],
			projects: [project("P/1")],
		};
		const outcome = applyDeletion(
			scope,
			planProjectDeletion(scope, scope.projects[0]),
			"cascade",
		);
		// The childless task goes now; the one holding a sub-task asks first.
		expect(outcome.deletePaths.sort()).toEqual(["P/1", "T/3"]);
		expect(outcome.followUps.map((p) => p.path)).toEqual(["T/1"]);
	});

	it("makes no unparenting edits when cascading", () => {
		const scope: HierarchyScope = {
			tasks: [task({ path: "T/1" }), task({ path: "T/2", parent: "T/1" })],
			projects: [],
		};
		const outcome = applyDeletion(scope, planTaskDeletion(scope, scope.tasks[0]), "cascade");
		expect(outcome.edits).toEqual([]);
	});
});

describe("dangling relations", () => {
	const snapshot = sampleSnapshot();
	const scope = scopeOf(snapshot);

	it("strips references to deleted tasks without prompting", () => {
		// SMP-0105 blocks SMP-0104. Deleting 0105 must clean 0104's blockedBy.
		const edits = danglingRelationEdits(scope, ["Sample/Tasks/SMP-0105"]);
		expect(edits).toHaveLength(1);
		expect(edits[0].path).toBe("Sample/Tasks/SMP-0104");
		expect(edits[0].relations.blockedBy).toEqual([]);
	});

	it("returns nothing when no relation points at the deleted notes", () => {
		expect(danglingRelationEdits(scope, ["Sample/Tasks/SMP-0107"])).toEqual([]);
	});

	it("clears duplicateOf when its target is deleted", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({
					path: "T/1",
					relations: { ...emptyRelations(), duplicateOf: "T/2" },
				}),
			],
			projects: [],
		};
		const edits = danglingRelationEdits(scope, ["T/2"]);
		expect(edits[0].relations.duplicateOf).toBeNull();
	});

	it("ignores relations on notes that are themselves being deleted", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1", relations: { ...emptyRelations(), blocks: ["T/2"] } }),
				task({ path: "T/2" }),
			],
			projects: [],
		};
		expect(danglingRelationEdits(scope, ["T/1", "T/2"])).toEqual([]);
	});
});

describe("dangling project links", () => {
	it("nulls `project` on a deep sub-task the cascade never touched", () => {
		// P/1 deleted; T/1 (top-level) is handled by the cascade, but T/3 — a
		// grandchild that carries `project: P/1` as metadata — is not.
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1", project: "P/1" }),
				task({ path: "T/2", parent: "T/1", project: "P/1" }),
				task({ path: "T/3", parent: "T/2", project: "P/1" }),
			],
			projects: [project("P/1")],
		};
		expect(danglingProjectEdits(scope, ["P/1", "T/1"])).toEqual([
			{ path: "T/2", field: "project", value: null },
			{ path: "T/3", field: "project", value: null },
		]);
	});

	it("leaves a sub-task pointing at a different project alone", () => {
		const scope: HierarchyScope = {
			tasks: [
				task({ path: "T/1", project: "P/1" }),
				task({ path: "T/2", parent: "T/1", project: "P/2" }),
			],
			projects: [project("P/1"), project("P/2")],
		};
		expect(danglingProjectEdits(scope, ["P/1", "T/1"])).toEqual([]);
	});

	it("skips tasks that are themselves being deleted", () => {
		const scope: HierarchyScope = {
			tasks: [task({ path: "T/1", project: "P/1" })],
			projects: [project("P/1")],
		};
		expect(danglingProjectEdits(scope, ["P/1", "T/1"])).toEqual([]);
	});
});

describe("describePlanChildren", () => {
	it("uses the right noun for each level", () => {
		const scope: HierarchyScope = {
			tasks: [task({ path: "T/1" }), task({ path: "T/2", parent: "T/1" })],
			projects: [],
		};
		expect(describePlanChildren(planTaskDeletion(scope, scope.tasks[0]))).toBe(
			"1 sub-task",
		);

		const withTasks: HierarchyScope = {
			tasks: [
				task({ path: "T/1", project: "P/1" }),
				task({ path: "T/2", project: "P/1" }),
			],
			projects: [project("P/1")],
		};
		expect(describePlanChildren(planProjectDeletion(withTasks, project("P/1")))).toBe(
			"2 tasks",
		);
	});

	it("says nothing for a childless plan", () => {
		const scope: HierarchyScope = { tasks: [task({ path: "T/1" })], projects: [] };
		expect(describePlanChildren(planTaskDeletion(scope, scope.tasks[0]))).toBe(
			"nothing",
		);
	});
});
