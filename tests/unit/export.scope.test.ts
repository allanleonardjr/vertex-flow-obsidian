import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { snapshotContext } from "../../src/core/views";
import { makeView } from "../../src/core/templates/helpers";
import { resolveScopeTasks } from "../../src/core/export/scope";
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
	it("carries the vertex-flow-export- prefix and slugs workspace + scope", () => {
		expect(
			exportFilename("Studio North", "Core App Experience", "csv", today),
		).toBe(
			"vertex-flow-export-studio-north-core-app-experience-2026-08-26.csv",
		);
	});

	it("maps each format to its extension and normalises stray casing", () => {
		expect(exportFilename("A/B!C", "TODO", "json", today)).toBe(
			"vertex-flow-export-a-b-c-todo-2026-08-26.json",
		);
		expect(exportFilename("Studio North", "Whole workspace", "ics", today)).toBe(
			"vertex-flow-export-studio-north-whole-workspace-2026-08-26.ics",
		);
	});
});
