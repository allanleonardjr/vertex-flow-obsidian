import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { snapshotContext } from "../../src/core/views";
import { makeView } from "../../src/core/templates/helpers";
import { resolveScopeTasks, scopeIdentity } from "../../src/core/export/scope";
import { exportFilename } from "../../src/core/export";

const snapshot = sampleSnapshot();
const context = snapshotContext(snapshot);
const today = "2026-08-26";

const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id);

describe("resolveScopeTasks", () => {
	it("view scope returns exactly the filter-matching tasks in rank order", () => {
		const view = makeView("bugs", "Bugs", { filters: { taskType: ["bug"] } });
		const { tasks, scopeLabel } = resolveScopeTasks(snapshot, { kind: "view", view }, context, today, {
			includeArchived: false,
		});
		expect(scopeLabel).toBe("Bugs");
		expect(ids(tasks)).toEqual(["SMP-0104", "SMP-0118", "SMP-0119"]);
	});

	it("project scope returns every task in that project, rank-sorted", () => {
		const project = snapshot.projects.find((p) => p.title === "Core App Experience")!;
		const { tasks, scopeLabel } = resolveScopeTasks(
			snapshot,
			{ kind: "project", project },
			context,
			today,
			{ includeArchived: false },
		);
		expect(scopeLabel).toBe("Core App Experience");
		expect(ids(tasks)).toEqual([
			"SMP-0101",
			"SMP-0102",
			"SMP-0103",
			"SMP-0104",
			"SMP-0105",
		]);
	});

	it("workspace scope excludes archived by default and trash always", () => {
		const { tasks, scopeLabel } = resolveScopeTasks(
			snapshot,
			{ kind: "workspace" },
			context,
			today,
			{ includeArchived: false },
		);
		expect(scopeLabel).toBe("Whole workspace");
		expect(tasks.length).toBe(22);
		expect(tasks.every((t) => !t.archived)).toBe(true);
	});

	it("includeArchived mixes archived tasks back in", () => {
		const { tasks } = resolveScopeTasks(
			snapshot,
			{ kind: "workspace" },
			context,
			today,
			{ includeArchived: true },
		);
		expect(tasks.length).toBe(25);
		expect(tasks.some((t) => t.archived)).toBe(true);
	});
});

describe("exportFilename", () => {
	const now = new Date(2026, 7, 26, 14, 32, 5);

	it("carries the vertex-flow-export- prefix, date/time up front, then workspace + kind + name", () => {
		expect(
			exportFilename(
				"Studio North",
				{ kind: "project", name: "Core App Experience" },
				"csv",
				now,
			),
		).toBe(
			"vertex-flow-export-2026-08-26-143205-studio-north-project-core-app-experience.csv",
		);
	});

	it("maps each format to its extension and normalises stray casing", () => {
		expect(
			exportFilename("A/B!C", { kind: "view", name: "TODO" }, "json", now),
		).toBe("vertex-flow-export-2026-08-26-143205-a-b-c-view-todo.json");
	});

	it("omits the name segment for an identity with no name", () => {
		expect(
			exportFilename(
				"Studio North",
				{ kind: "workspace", name: null },
				"ics",
				now,
			),
		).toBe("vertex-flow-export-2026-08-26-143205-studio-north-workspace.ics");
	});

	it("accepts a template identity too", () => {
		expect(
			exportFilename(
				"Studio North",
				{ kind: "template", name: "My Team Template" },
				"md",
				now,
			),
		).toBe(
			"vertex-flow-export-2026-08-26-143205-studio-north-template-my-team-template.md",
		);
	});
});

describe("scopeIdentity", () => {
	it("treats an ordinary saved view as kind view", () => {
		const view = makeView("bugs", "Bugs", {});
		expect(scopeIdentity({ kind: "view", view })).toEqual({
			kind: "view",
			name: "Bugs",
		});
	});

	it("recognizes a label-scoped view by its id prefix", () => {
		const view = makeView("label:eng", "Engineering", {});
		expect(scopeIdentity({ kind: "view", view })).toEqual({
			kind: "label",
			name: "Engineering",
		});
	});

	it("recognizes a person-scoped view by its id prefix", () => {
		const view = makeView("person:alice", "Alice", {});
		expect(scopeIdentity({ kind: "view", view })).toEqual({
			kind: "person",
			name: "Alice",
		});
	});

	it("omits a name for workspace scope", () => {
		expect(scopeIdentity({ kind: "workspace" })).toEqual({
			kind: "workspace",
			name: null,
		});
	});
});
