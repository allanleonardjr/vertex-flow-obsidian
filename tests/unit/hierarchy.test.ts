import { describe, expect, it } from "vitest";
import {
	ancestorTasks,
	childTasks,
	computeProgress,
	descendantTasks,
	formatProgress,
	primaryParent,
	projectProgress,
	projectTasks,
	scopeOf,
	subtaskProgress,
	type HierarchyScope,
} from "../../src/core/hierarchy";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { createTaxonomy, DEFAULT_STATUSES } from "../../src/core/taxonomy";
import { emptyRelations, type Task } from "../../src/core/types";

const snapshot = sampleSnapshot();
const scope = scopeOf(snapshot);
const statuses = createTaxonomy("status", DEFAULT_STATUSES);

const P = (name: string) => `Sample/${name}`;
const T = (id: string) => `Sample/Tasks/SMP-${id}`;

function task(overrides: Partial<Task> & { path: string }): Task {
	return {
		type: "task",
		id: overrides.path.split("/").pop() as string,
		title: "t",
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

describe("direct children", () => {
	it("finds sub-tasks by their parent link, with no stored children list", () => {
		expect(childTasks(scope, T("0101")).map((t) => t.id).sort()).toEqual([
			"SMP-0102",
			"SMP-0103",
		]);
	});

	it("finds a project's tasks", () => {
		expect(projectTasks(scope, P("Projects/App Store Launch"))).toHaveLength(3);
	});

	it("matches short-form wikilinks against full paths", () => {
		const local: HierarchyScope = {
			tasks: [task({ path: "W/Tasks/A-1", parent: "A-0" })],
			projects: [],
		};
		expect(childTasks(local, "W/Tasks/A-0")).toHaveLength(1);
	});
});

describe("descendants and ancestors", () => {
	it("walks the whole sub-task tree", () => {
		const local: HierarchyScope = {
			tasks: [
				task({ path: T("1") }),
				task({ path: T("2"), parent: T("1") }),
				task({ path: T("3"), parent: T("2") }),
				task({ path: T("4"), parent: T("3") }),
				task({ path: T("9") }),
			],
			projects: [],
		};
		expect(descendantTasks(local, T("1")).map((t) => t.path)).toEqual([
			T("2"),
			T("3"),
			T("4"),
		]);
	});

	it("does not hang on a parent cycle in a corrupted vault", () => {
		const local: HierarchyScope = {
			tasks: [
				task({ path: T("1"), parent: T("2") }),
				task({ path: T("2"), parent: T("1") }),
			],
			projects: [],
		};
		expect(descendantTasks(local, T("1")).map((t) => t.path)).toEqual([T("2")]);
		expect(ancestorTasks(local, local.tasks[0]).map((t) => t.path)).toEqual([
			T("2"),
		]);
	});

	it("walks up to the root ancestor, nearest first", () => {
		const local: HierarchyScope = {
			tasks: [
				task({ path: T("1") }),
				task({ path: T("2"), parent: T("1") }),
				task({ path: T("3"), parent: T("2") }),
			],
			projects: [],
		};
		expect(ancestorTasks(local, local.tasks[2]).map((t) => t.path)).toEqual([
			T("2"),
			T("1"),
		]);
	});
});

describe("primary parent (exactly one)", () => {
	it("prefers parent, then project", () => {
		expect(
			primaryParent(task({ path: "x", parent: "p", project: "pr" })),
		).toEqual({ kind: "task", path: "p" });
		expect(primaryParent(task({ path: "x", project: "pr" }))).toEqual({
			kind: "project",
			path: "pr",
		});
		expect(primaryParent(task({ path: "x" }))).toEqual({ kind: "none" });
	});
});

describe("progress rollup", () => {
	it("is zero for no tasks", () => {
		expect(computeProgress([], statuses)).toEqual({
			total: 0,
			completed: 0,
			started: 0,
			canceled: 0,
			percent: 0,
		});
	});

	it("excludes canceled work from the denominator", () => {
		const tasks = [
			task({ path: "a", status: "done" }),
			task({ path: "b", status: "done" }),
			task({ path: "c", status: "canceled" }),
		];
		const progress = computeProgress(tasks, statuses);
		expect(progress).toMatchObject({ total: 3, completed: 2, canceled: 1 });
		// 2 of 2 real tasks are done — not 2 of 3.
		expect(progress.percent).toBe(100);
		expect(formatProgress(progress)).toBe("2/2");
	});

	it("reports 0% when everything is canceled", () => {
		const progress = computeProgress(
			[task({ path: "a", status: "canceled" })],
			statuses,
		);
		expect(progress.percent).toBe(0);
	});

	it("counts started separately from completed", () => {
		const progress = computeProgress(
			[
				task({ path: "a", status: "in-progress" }),
				task({ path: "b", status: "done" }),
				task({ path: "c", status: "queue" }),
				task({ path: "d", status: "todo" }),
			],
			statuses,
		);
		expect(progress).toMatchObject({ completed: 1, started: 1, canceled: 0 });
		expect(progress.percent).toBe(25);
	});

	it("ignores an unknown status rather than crashing", () => {
		const progress = computeProgress(
			[task({ path: "a", status: "invented-by-hand" })],
			statuses,
		);
		expect(progress).toMatchObject({ total: 1, completed: 0, percent: 0 });
	});
});

describe("sub-task rollup (§7.2)", () => {
	it("counts direct children only, never grandchildren", () => {
		const local: HierarchyScope = {
			tasks: [
				task({ path: T("1") }),
				task({ path: T("2"), parent: T("1"), status: "done" }),
				task({ path: T("3"), parent: T("2"), status: "queue" }),
			],
			projects: [],
		};
		const progress = subtaskProgress(local, local.tasks[0], statuses);
		expect(progress.total).toBe(1);
		expect(progress.percent).toBe(100);
	});

	it("never flips the parent's own status when children finish", () => {
		const parent = task({ path: T("1"), status: "in-progress" });
		const local: HierarchyScope = {
			tasks: [parent, task({ path: T("2"), parent: T("1"), status: "done" })],
			projects: [],
		};
		expect(subtaskProgress(local, parent, statuses).percent).toBe(100);
		// The whole point of §7.2: 100% complete, status untouched.
		expect(parent.status).toBe("in-progress");
	});
});

describe("project progress (§7.1)", () => {
	it("computes project progress from every task in the project", () => {
		// Sub-tasks carry their parent's `project` link too, so they count here.
		// A project's progress is all the work in it, not just its top-level rows
		// — the parent-only rollup is what §7.2's progress bar is for.
		const progress = projectProgress(
			scope,
			P("Projects/Core App Experience"),
			statuses,
		);
		expect(progress.total).toBe(5);
		expect(progress.completed).toBe(1);
	});

	it("leaves the project's own status untouched by its progress", () => {
		// The sample's launch project is deliberately still in the backlog while
		// its tasks are moving — status and progress never auto-sync.
		const project = snapshot.projects.find((p) => p.title.startsWith("App Store"));
		expect(project?.status).toBe("backlog");
		expect(projectProgress(scope, project!.path, statuses).total).toBe(3);
	});
});
