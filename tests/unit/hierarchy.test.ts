import { describe, expect, it } from "vitest";
import {
	ancestorTasks,
	childTasks,
	computeProgress,
	descendantTasks,
	formatProgress,
	newTaskProject,
	primaryParent,
	projectProgress,
	projectTasks,
	scopeOf,
	subtaskProgress,
	topLevelProjectTasks,
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

	it("topLevelProjectTasks drops sub-tasks that carry the project link", () => {
		const core = P("Projects/Core App Experience");
		// SMP-0102 and SMP-0103 are sub-tasks of SMP-0101 but still carry
		// `project: Core App Experience` — the denormalized link.
		expect(projectTasks(scope, core).map((t) => t.id).sort()).toEqual([
			"SMP-0101",
			"SMP-0102",
			"SMP-0103",
			"SMP-0104",
			"SMP-0105",
		]);
		expect(topLevelProjectTasks(scope, core).map((t) => t.id).sort()).toEqual([
			"SMP-0101",
			"SMP-0104",
			"SMP-0105",
		]);
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

describe("newTaskProject (seed once, never sync)", () => {
	const parent = task({ path: T("1"), project: P("Projects/Core") });

	it("inherits the parent's project when none is given", () => {
		expect(newTaskProject(undefined, parent)).toBe(P("Projects/Core"));
	});

	it("uses an explicit project over the inherited one", () => {
		expect(newTaskProject(P("Projects/Other"), parent)).toBe(P("Projects/Other"));
	});

	it("honours an explicit null even when the parent has a project", () => {
		expect(newTaskProject(null, parent)).toBeNull();
	});

	it("is null for a top-level task with no project", () => {
		expect(newTaskProject(undefined, null)).toBeNull();
		expect(newTaskProject(undefined, task({ path: T("9") }))).toBeNull();
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
	it("computes project progress from top-level tasks only", () => {
		// Sub-tasks carry their parent's `project` link, but each is already
		// counted in its own parent's §7.2 rollup — counting them again at the
		// project level would double them. So the project's progress is over its
		// three top-level tasks (SMP-0101/0104/0105), not all five.
		const progress = projectProgress(
			scope,
			P("Projects/Core App Experience"),
			statuses,
		);
		expect(progress.total).toBe(3);
	});

	it("isn't inflated by a top-level task's own sub-tasks", () => {
		// One top-level task, 60%-ish done via its own sub-tasks. The project
		// sees exactly one task, not one + its children.
		const statusesLocal = statuses;
		const local: HierarchyScope = {
			projects: [],
			tasks: [
				task({ path: T("1"), project: P("Projects/X"), status: "in-progress" }),
				task({ path: T("2"), parent: T("1"), project: P("Projects/X"), status: "done" }),
				task({ path: T("3"), parent: T("1"), project: P("Projects/X"), status: "done" }),
				task({ path: T("4"), parent: T("1"), project: P("Projects/X"), status: "done" }),
				task({ path: T("5"), parent: T("1"), project: P("Projects/X"), status: "todo" }),
				task({ path: T("6"), parent: T("1"), project: P("Projects/X"), status: "todo" }),
			],
		};
		const progress = projectProgress(local, P("Projects/X"), statusesLocal);
		expect(progress.total).toBe(1);
		expect(progress.completed).toBe(0);
	});

	it("leaves the project's own status untouched by its progress", () => {
		// The sample's launch project is deliberately still in the backlog while
		// its tasks are moving — status and progress never auto-sync.
		const project = snapshot.projects.find((p) => p.title.startsWith("App Store"));
		expect(project?.status).toBe("backlog");
		expect(projectProgress(scope, project!.path, statuses).total).toBe(3);
	});
});
