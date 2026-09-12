import { describe, expect, it } from "vitest";
import {
	executeQueryAction,
	looksLikeQueryAction,
	parseQueryAction,
} from "../../src/core/ai/query-action";
import { snapshotContext } from "../../src/core/views/context";
import type { WorkspaceSnapshot } from "../../src/core/types";
import { project, task } from "./fixtures";
import { sampleSnapshot } from "../../src/core/templates/instantiate";

function withEntities(tasks: WorkspaceSnapshot["tasks"], projects: WorkspaceSnapshot["projects"]) {
	const base = sampleSnapshot();
	return { ...base, tasks, projects };
}

describe("parseQueryAction", () => {
	it("parses a well-formed searchTasks action", () => {
		const result = parseQueryAction('{"action":"searchTasks","filters":{"status":["Todo"]}}');
		expect(result).toEqual({ action: "searchTasks", filters: { status: ["Todo"] } });
	});

	it("parses a well-formed countTasks action with boolean/string filters", () => {
		const result = parseQueryAction(
			'{"action":"countTasks","filters":{"openOnly":true,"archived":"included","text":"bug"}}',
		);
		expect(result).toEqual({
			action: "countTasks",
			filters: { openOnly: true, archived: "included", text: "bug" },
		});
	});

	it("tolerates surrounding prose or a markdown fence around the JSON", () => {
		const result = parseQueryAction(
			'Sure, let me check that.\n```json\n{"action":"searchTasks","filters":{}}\n```',
		);
		expect(result).toEqual({ action: "searchTasks", filters: {} });
	});

	it("returns null for plain conversational text", () => {
		expect(parseQueryAction("Sure! There are 3 statuses in this workspace.")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(parseQueryAction("{not valid json")).toBeNull();
	});

	it("returns null when action isn't one of the two recognized literals", () => {
		expect(parseQueryAction('{"action":"deleteEverything","filters":{}}')).toBeNull();
	});

	it("returns null when filters contains an unrecognized key", () => {
		expect(
			parseQueryAction('{"action":"searchTasks","filters":{"nonexistentField":["x"]}}'),
		).toBeNull();
	});

	it("returns null when an array filter key holds a non-array value", () => {
		expect(parseQueryAction('{"action":"searchTasks","filters":{"status":"Todo"}}')).toBeNull();
	});

	it("returns null when an array filter holds a non-string element", () => {
		expect(parseQueryAction('{"action":"searchTasks","filters":{"status":[1,2]}}')).toBeNull();
	});

	it("returns null when a boolean filter key holds a non-boolean value", () => {
		expect(parseQueryAction('{"action":"searchTasks","filters":{"openOnly":"yes"}}')).toBeNull();
	});

	it("returns null when archived isn't one of its two literal values", () => {
		expect(parseQueryAction('{"action":"searchTasks","filters":{"archived":"yes"}}')).toBeNull();
	});

	it("parses the overdue flag as a recognized boolean key", () => {
		const result = parseQueryAction('{"action":"searchTasks","filters":{"overdue":true}}');
		expect(result).toEqual({ action: "searchTasks", filters: { overdue: true } });
	});

	it("returns null when overdue holds a non-boolean value", () => {
		expect(parseQueryAction('{"action":"searchTasks","filters":{"overdue":"yes"}}')).toBeNull();
	});
});

describe("looksLikeQueryAction", () => {
	it("is true for a structurally valid action", () => {
		expect(looksLikeQueryAction('{"action":"searchTasks","filters":{}}')).toBe(true);
	});

	it("is true for an attempted action with invalid filter keys (still an attempt)", () => {
		expect(looksLikeQueryAction('{"action":"searchTasks","filters":{"bogus":1}}')).toBe(true);
	});

	it("is false for plain conversational text", () => {
		expect(looksLikeQueryAction("Here's what I found.")).toBe(false);
	});

	it("is false for JSON that isn't an action object", () => {
		expect(looksLikeQueryAction('{"hello":"world"}')).toBe(false);
	});
});

describe("executeQueryAction", () => {
	it("countTasks returns a plain count, never full rows", () => {
		const tasks = [
			task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo" }),
			task({ id: "TSK-2", path: "W/Tasks/TSK-2", status: "done" }),
		];
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "countTasks", filters: { status: ["todo"] } },
			snapshot,
			context,
		);

		expect(result).toBe("1 task(s) matched.");
	});

	it("searchTasks resolves a display-name status filter to its id and returns matching rows", () => {
		const tasks = [
			task({ id: "TSK-1", path: "W/Tasks/TSK-1", title: "A", status: "todo" }),
			task({ id: "TSK-2", path: "W/Tasks/TSK-2", title: "B", status: "done" }),
		];
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		// "Todo" is the DEFAULT_STATUSES display name for the "todo" id.
		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"] } },
			snapshot,
			context,
		);

		expect(result).toContain("TSK-1");
		expect(result).not.toContain("TSK-2");
	});

	it("resolves a project title to its path so the project filter actually matches", () => {
		const p = project({ path: "W/Projects/Launch", title: "Launch" });
		const inProject = task({ id: "TSK-1", path: "W/Tasks/TSK-1", project: "W/Projects/Launch" });
		const elsewhere = task({ id: "TSK-2", path: "W/Tasks/TSK-2" });
		const snapshot = withEntities([inProject, elsewhere], [p]);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { project: ["Launch"] } },
			snapshot,
			context,
		);

		expect(result).toContain("TSK-1");
		expect(result).not.toContain("TSK-2");
	});

	it("resolves an assignee display name to the person's id", () => {
		const snapshot = withEntities(
			[
				task({ id: "TSK-1", path: "W/Tasks/TSK-1", assignee: "alice" }),
				task({ id: "TSK-2", path: "W/Tasks/TSK-2", assignee: "bob" }),
			],
			[],
		);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { assignee: ["Alice"] } },
			snapshot,
			context,
		);

		expect(result).toContain("TSK-1");
		expect(result).not.toContain("TSK-2");
	});

	it("drops a filter value that resolves to nothing rather than crashing", () => {
		const tasks = [task({ id: "TSK-1", path: "W/Tasks/TSK-1" })];
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		expect(() =>
			executeQueryAction(
				{ action: "searchTasks", filters: { status: ["Not A Real Status"] } },
				snapshot,
				context,
			),
		).not.toThrow();
	});

	it("caps searchTasks results and notes how many more matched", () => {
		const tasks = Array.from({ length: 150 }, (_, i) =>
			task({ id: `TSK-${i}`, path: `W/Tasks/TSK-${i}`, status: "todo" }),
		);
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"] } },
			snapshot,
			context,
		);

		expect(result).toContain("showing the first 100 of 150 matches");
	});

	it("reflects a renamed status immediately in query results", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo" });
		const snapshot = withEntities([t], []);
		const renamedWorkspace = {
			...snapshot.workspace,
			statuses: snapshot.workspace.statuses.map((s) =>
				s.id === "todo" ? { ...s, name: "Doing" } : s,
			),
		};
		const renamedSnapshot = { ...snapshot, workspace: renamedWorkspace };
		const context = snapshotContext(renamedSnapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Doing"] } },
			renamedSnapshot,
			context,
		);

		expect(result).toContain("TSK-1");
	});

	it("overdue: true filters to tasks past due and still open, AND'd with other filters", () => {
		const overdueOpen = task({
			id: "TSK-1",
			path: "W/Tasks/TSK-1",
			status: "todo",
			dueDate: "2020-01-01",
		});
		const overdueDone = task({
			id: "TSK-2",
			path: "W/Tasks/TSK-2",
			status: "done",
			dueDate: "2020-01-01",
		});
		const notYetDue = task({
			id: "TSK-3",
			path: "W/Tasks/TSK-3",
			status: "todo",
			dueDate: "2099-01-01",
		});
		const snapshot = withEntities([overdueOpen, overdueDone, notYetDue], []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { overdue: true } },
			snapshot,
			context,
			"2026-01-01",
		);

		expect(result).toContain("TSK-1");
		expect(result).not.toContain("TSK-2");
		expect(result).not.toContain("TSK-3");
	});

	it("ignores overdue: false — no additional filtering beyond the ViewFilters pass-through", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo", dueDate: "2099-01-01" });
		const snapshot = withEntities([t], []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { overdue: false } },
			snapshot,
			context,
			"2026-01-01",
		);

		expect(result).toContain("TSK-1");
	});

	it("countTasks combined with overdue counts only the overdue subset", () => {
		const overdue = task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo", dueDate: "2020-01-01" });
		const notOverdue = task({ id: "TSK-2", path: "W/Tasks/TSK-2", status: "todo", dueDate: "2099-01-01" });
		const snapshot = withEntities([overdue, notOverdue], []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "countTasks", filters: { overdue: true } },
			snapshot,
			context,
			"2026-01-01",
		);

		expect(result).toBe("1 task(s) matched.");
	});
});
