import { describe, expect, it } from "vitest";
import {
	buildAiWorkspaceSnapshot,
	buildPeopleRoster,
	buildTaxonomyLegend,
	isOverdueTask,
} from "../../src/core/ai/snapshot";
import { createTaxonomy, DEFAULT_STATUSES, workspaceTaxonomies } from "../../src/core/taxonomy";
import type { WorkspaceSnapshot } from "../../src/core/types";
import { project, task } from "./fixtures";
import { sampleSnapshot } from "../../src/core/templates/instantiate";

const statuses = createTaxonomy("status", DEFAULT_STATUSES);

function withEntities(tasks: WorkspaceSnapshot["tasks"], projects: WorkspaceSnapshot["projects"]) {
	const base = sampleSnapshot();
	return { ...base, tasks, projects };
}

describe("isOverdueTask", () => {
	it("is overdue only when due before today and not completed/canceled", () => {
		const overdue = task({ dueDate: "2020-01-01", status: "todo" });
		const done = task({ dueDate: "2020-01-01", status: "done" });
		const future = task({ dueDate: "2099-01-01", status: "todo" });

		expect(isOverdueTask(overdue, statuses, "2026-01-01")).toBe(true);
		expect(isOverdueTask(done, statuses, "2026-01-01")).toBe(false);
		expect(isOverdueTask(future, statuses, "2026-01-01")).toBe(false);
	});
});

describe("buildAiWorkspaceSnapshot", () => {
	it("resolves task project/parent titles and rolls up project status counts + overdue", () => {
		const p = project({ path: "W/Projects/P", title: "Launch" });
		const parent = task({ id: "TSK-1", path: "W/Tasks/TSK-1", title: "Parent" });
		const child = task({
			id: "TSK-2",
			path: "W/Tasks/TSK-2",
			title: "Child",
			parent: "W/Tasks/TSK-1",
			project: "W/Projects/P",
			status: "todo",
			dueDate: "2020-01-01",
		});
		const other = task({
			id: "TSK-3",
			path: "W/Tasks/TSK-3",
			title: "Other",
			project: "W/Projects/P",
			status: "done",
		});

		const snapshot = withEntities([parent, child, other], [p]);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const result = buildAiWorkspaceSnapshot(snapshot, taxonomies, { today: "2026-01-01" });

		const childSummary = result.tasks.find((t) => t.id === "TSK-2")!;
		expect(childSummary.project).toBe("Launch");
		expect(childSummary.parent).toBe("Parent");

		const projectSummary = result.projects.find((p2) => p2.title === "Launch")!;
		expect(projectSummary.overdueCount).toBe(1);
		expect(Object.values(projectSummary.statusCounts).reduce((a, b) => a + b, 0)).toBe(2);
		expect(result.truncated).toBe(false);
	});

	it("truncates least-recently-updated tasks first and reports the omitted count", () => {
		const old = task({ id: "TSK-1", path: "W/Tasks/TSK-1", updatedAt: "2020-01-01T00:00:00Z" });
		const recent = task({ id: "TSK-2", path: "W/Tasks/TSK-2", updatedAt: "2026-01-01T00:00:00Z" });

		const snapshot = withEntities([old, recent], []);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const result = buildAiWorkspaceSnapshot(snapshot, taxonomies, { maxTasks: 1 });

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0]?.id).toBe("TSK-2");
		expect(result.truncated).toBe(true);
		expect(result.omittedTaskCount).toBe(1);
	});

	it("excludes archived tasks and projects", () => {
		const archivedTask = task({ id: "TSK-1", path: "W/Tasks/TSK-1", archived: true });
		const archivedProject = project({ path: "W/Projects/P", archived: true });

		const snapshot = withEntities([archivedTask], [archivedProject]);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const result = buildAiWorkspaceSnapshot(snapshot, taxonomies);

		expect(result.tasks).toHaveLength(0);
		expect(result.projects).toHaveLength(0);
	});

	it("resolves taskType and assignee to their configured/display names, and carries estimate/startDate", () => {
		const t = task({
			id: "TSK-1",
			path: "W/Tasks/TSK-1",
			taskType: "bug",
			assignee: "alice",
			estimate: 5,
			startDate: "2026-01-01",
		});

		const snapshot = withEntities([t], []);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const result = buildAiWorkspaceSnapshot(snapshot, taxonomies);

		const summary = result.tasks[0]!;
		expect(summary.taskType).toBe("Bug");
		expect(summary.assignee).toBe("Alice");
		expect(summary.estimate).toBe(5);
		expect(summary.startDate).toBe("2026-01-01");
	});

	it("falls back to null for an assignee/taskType id that isn't in the workspace", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", taskType: "ghost-type", assignee: "ghost-person" });

		const snapshot = withEntities([t], []);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const result = buildAiWorkspaceSnapshot(snapshot, taxonomies);

		expect(result.tasks[0]?.taskType).toBeNull();
		expect(result.tasks[0]?.assignee).toBeNull();
	});

	it("resolves project owner to a display name and carries its dates", () => {
		const p = project({
			path: "W/Projects/P",
			title: "Launch",
			owner: "bob",
			startDate: "2026-01-10",
			dueDate: "2026-06-30",
		});

		const snapshot = withEntities([], [p]);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const result = buildAiWorkspaceSnapshot(snapshot, taxonomies);

		const summary = result.projects[0]!;
		expect(summary.owner).toBe("Bob");
		expect(summary.startDate).toBe("2026-01-10");
		expect(summary.dueDate).toBe("2026-06-30");
	});
});

describe("buildTaxonomyLegend", () => {
	it("renders every taxonomy in configured order, with status category tags", () => {
		const taxonomies = workspaceTaxonomies(sampleSnapshot().workspace);
		const legend = buildTaxonomyLegend(taxonomies);

		expect(legend).toContain("Statuses (in order):");
		expect(legend).toMatch(/\[backlog\]|\[unstarted\]|\[started\]|\[completed\]|\[canceled\]/);
		expect(legend).toContain("Priorities (in order):");
		expect(legend).toContain("Task Types:");
		expect(legend).toContain("Bug");
		expect(legend).toContain("Labels:");
	});

	it("reflects a renamed status immediately, with no stored state to go stale", () => {
		const snapshot = sampleSnapshot();
		const renamed = {
			...snapshot.workspace,
			statuses: snapshot.workspace.statuses.map((s) =>
				s.id === snapshot.workspace.statuses[0]!.id ? { ...s, name: "Renamed Status" } : s,
			),
		};
		const legend = buildTaxonomyLegend(workspaceTaxonomies(renamed));
		expect(legend).toContain("Renamed Status");
	});

	it("says 'none defined' for an empty taxonomy instead of an empty list", () => {
		const snapshot = sampleSnapshot();
		const noLabels = { ...snapshot.workspace, labels: [] };
		const legend = buildTaxonomyLegend(workspaceTaxonomies(noLabels));
		expect(legend).toContain("Labels: none defined");
	});
});

describe("buildPeopleRoster", () => {
	it("lists every person's display name", () => {
		const roster = buildPeopleRoster(sampleSnapshot().workspace.people);
		expect(roster).toContain("Alice");
		expect(roster).toContain("Bob");
	});

	it("has a graceful message when nobody is registered", () => {
		expect(buildPeopleRoster([])).toBe("People: none registered");
	});
});
