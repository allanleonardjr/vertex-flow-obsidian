import { describe, expect, it } from "vitest";
import {
	buildFactsSection,
	buildPeopleRoster,
	buildTaxonomyLegend,
	flattenTasks,
	isOverdueTask,
	summarizeTasks,
} from "../../src/core/ai/snapshot";
import { createTaxonomy, DEFAULT_STATUSES, workspaceTaxonomies } from "../../src/core/taxonomy";
import type { WorkspaceSnapshot } from "../../src/core/types";
import { project, task } from "./fixtures";
import { sampleSnapshot } from "../../src/core/templates/instantiate";

function withEntities(tasks: WorkspaceSnapshot["tasks"], projects: WorkspaceSnapshot["projects"]) {
	const base = sampleSnapshot();
	return { ...base, tasks, projects };
}

describe("isOverdueTask", () => {
	const statuses = createTaxonomy("status", DEFAULT_STATUSES);

	it("is overdue only when due before today and not completed/canceled", () => {
		const overdue = task({ dueDate: "2020-01-01", status: "todo" });
		const done = task({ dueDate: "2020-01-01", status: "done" });
		const future = task({ dueDate: "2099-01-01", status: "todo" });

		expect(isOverdueTask(overdue, statuses, "2026-01-01")).toBe(true);
		expect(isOverdueTask(done, statuses, "2026-01-01")).toBe(false);
		expect(isOverdueTask(future, statuses, "2026-01-01")).toBe(false);
	});

	it("is not overdue with no dueDate set", () => {
		expect(isOverdueTask(task({ dueDate: null }), statuses, "2026-01-01")).toBe(false);
	});
});

describe("summarizeTasks", () => {
	it("resolves task project/parent titles", () => {
		const p = project({ path: "W/Projects/P", title: "Launch" });
		const parent = task({ id: "TSK-1", path: "W/Tasks/TSK-1", title: "Parent" });
		const child = task({
			id: "TSK-2",
			path: "W/Tasks/TSK-2",
			title: "Child",
			parent: "W/Tasks/TSK-1",
			project: "W/Projects/P",
		});

		const snapshot = withEntities([parent, child], [p]);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const [, childSummary] = summarizeTasks([parent, child], snapshot, taxonomies);

		expect(childSummary!.project).toBe("Launch");
		expect(childSummary!.parent).toBe("Parent");
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
		const [summary] = summarizeTasks([t], snapshot, taxonomies);

		expect(summary!.taskType).toBe("Bug");
		expect(summary!.assignee).toBe("Alice");
		expect(summary!.estimate).toBe(5);
		expect(summary!.startDate).toBe("2026-01-01");
	});

	it("falls back to null for an assignee/taskType id that isn't in the workspace", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", taskType: "ghost-type", assignee: "ghost-person" });

		const snapshot = withEntities([t], []);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const [summary] = summarizeTasks([t], snapshot, taxonomies);

		expect(summary!.taskType).toBeNull();
		expect(summary!.assignee).toBeNull();
	});
});

describe("flattenTasks", () => {
	it("renders a header and one pipe-delimited row per task", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", title: "Fix bug" });
		const snapshot = withEntities([t], []);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const text = flattenTasks(summarizeTasks([t], snapshot, taxonomies));

		const lines = text.split("\n");
		expect(lines[0]).toContain("id | title | status");
		expect(lines[1]).toContain("TSK-1");
		expect(lines[1]).toContain("Fix bug");
	});

	it("says '(none)' for an empty list instead of a bare header", () => {
		expect(flattenTasks([])).toContain("(none)");
	});

	it("escapes a pipe character inside a field so it can't be mistaken for a column boundary", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", title: "A | B" });
		const snapshot = withEntities([t], []);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const text = flattenTasks(summarizeTasks([t], snapshot, taxonomies));

		expect(text).toContain("A / B");
		expect(text.split("\n")[1]!.split(" | ")).toHaveLength(12);
	});
});

describe("buildFactsSection", () => {
	it("reports real, untruncated counts regardless of task list size", () => {
		const tasks = Array.from({ length: 90 }, (_, i) =>
			task({ id: `TSK-${i}`, path: `W/Tasks/TSK-${i}` }),
		);
		const snapshot = withEntities(tasks, []);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const facts = buildFactsSection(snapshot, taxonomies, "2026-01-01");

		expect(facts).toContain("Tasks: 90 (0 archived)");
	});

	it("excludes archived tasks/projects from the live counts but reports the archived count", () => {
		const live = task({ id: "TSK-1", path: "W/Tasks/TSK-1" });
		const archived = task({ id: "TSK-2", path: "W/Tasks/TSK-2", archived: true });
		const archivedProject = project({ path: "W/Projects/P", archived: true });

		const snapshot = withEntities([live, archived], [archivedProject]);
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const facts = buildFactsSection(snapshot, taxonomies, "2026-01-01");

		expect(facts).toContain("Tasks: 1 (1 archived)");
		expect(facts).toContain("Projects: 0");
	});

	it("includes today's date, the taxonomy legend, and the people roster", () => {
		const snapshot = sampleSnapshot();
		const taxonomies = workspaceTaxonomies(snapshot.workspace);
		const facts = buildFactsSection(snapshot, taxonomies, "2026-03-14");

		expect(facts).toContain("Today's date: 2026-03-14");
		expect(facts).toContain("Statuses (in order):");
		expect(facts).toContain("People:");
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
