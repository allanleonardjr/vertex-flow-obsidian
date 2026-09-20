import { describe, expect, it } from "vitest";
import {
	executeQueryAction,
	looksLikeAttemptedAction,
	looksLikeJsonAttempt,
	looksLikeQueryAction,
	parseQueryAction,
} from "../../src/core/ai/query-action";
import { estimateTokens } from "../../src/core/ai/snapshot";
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

describe("looksLikeJsonAttempt", () => {
	it("is true for a structurally valid action (a superset of looksLikeQueryAction)", () => {
		expect(looksLikeJsonAttempt('{"action":"searchTasks","filters":{}}')).toBe(true);
	});

	it("is true for JSON naming neither action — the off-schema shape looksLikeQueryAction misses", () => {
		expect(looksLikeJsonAttempt('{"labels": ["Community/Discord"]}')).toBe(true);
	});

	it("is true for an arbitrary object with unrelated keys", () => {
		expect(looksLikeJsonAttempt('{"hello":"world"}')).toBe(true);
	});

	it("tolerates surrounding prose or a markdown fence around the JSON", () => {
		expect(looksLikeJsonAttempt('Sure thing:\n```json\n{"labels": ["x"]}\n```')).toBe(true);
	});

	it("is false for plain conversational text with no JSON in it", () => {
		expect(looksLikeJsonAttempt("Here's what I found.")).toBe(false);
	});

	it("is false for invalid/unparseable JSON", () => {
		expect(looksLikeJsonAttempt("{not valid json")).toBe(false);
	});

	it("is false for a bare JSON array — no {...} substring for extractJsonCandidate to find", () => {
		expect(looksLikeJsonAttempt('["a", "b"]')).toBe(false);
	});
});

describe("looksLikeAttemptedAction", () => {
	it("is true for a structurally valid action (a superset of the other two checks)", () => {
		expect(looksLikeAttemptedAction('{"action":"searchTasks","filters":{}}')).toBe(true);
	});

	it("is true for two concatenated action objects that fail JSON.parse entirely — the reported bug", () => {
		const garbled =
			'{"action": "countTasks", "filters": {}}>{"action": "searchTasks", "filters": {"status": ["Todo"]}}';
		// Sanity-check the premise: this really doesn't parse as JSON.
		expect(() => {
			JSON.parse(garbled);
		}).toThrow();
		expect(looksLikeJsonAttempt(garbled)).toBe(false);
		expect(looksLikeAttemptedAction(garbled)).toBe(true);
	});

	it("is true for any response starting with '{', valid JSON or not", () => {
		expect(looksLikeAttemptedAction("{this isn't even JSON")).toBe(true);
	});

	it('is true for a response containing the literal substring "action" anywhere, even mid-prose', () => {
		expect(looksLikeAttemptedAction('Sure, here: "action": "countTasks" ...')).toBe(true);
	});

	it("is false for ordinary prose that neither starts with '{' nor mentions \"action\"", () => {
		expect(looksLikeAttemptedAction("There are 3 statuses in this workspace.")).toBe(false);
		expect(looksLikeAttemptedAction("Sure! Let me help with that.")).toBe(false);
	});

	it("is false for empty or whitespace-only text", () => {
		expect(looksLikeAttemptedAction("")).toBe(false);
		expect(looksLikeAttemptedAction("   \n  ")).toBe(false);
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

		expect(result.text).toBe("1 task(s) matched.");
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

		expect(result.text).toContain("TSK-1");
		expect(result.text).not.toContain("TSK-2");
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

		expect(result.text).toContain("TSK-1");
		expect(result.text).not.toContain("TSK-2");
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

		expect(result.text).toContain("TSK-1");
		expect(result.text).not.toContain("TSK-2");
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

		expect(result.text).toContain("showing 100 of 150 matching tasks");
		expect(result.tasks).toHaveLength(100);
		expect(result.totalMatches).toBe(150);
	});

	it("returns the real matched Task objects alongside the text for searchTasks", () => {
		const match = task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo" });
		const other = task({ id: "TSK-2", path: "W/Tasks/TSK-2", status: "done" });
		const snapshot = withEntities([match, other], []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"] } },
			snapshot,
			context,
		);

		expect(result.tasks).toEqual([match]);
	});

	it("countTasks never returns a tasks array — nothing to list", () => {
		const tasks = [task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo" })];
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "countTasks", filters: { status: ["todo"] } },
			snapshot,
			context,
		);

		expect(result.tasks).toBeUndefined();
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

		expect(result.text).toContain("TSK-1");
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

		expect(result.text).toContain("TSK-1");
		expect(result.text).not.toContain("TSK-2");
		expect(result.text).not.toContain("TSK-3");
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

		expect(result.text).toContain("TSK-1");
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

		expect(result.text).toBe("1 task(s) matched.");
	});

	it("halves the row count until the formatted text fits a tight availableTokens budget", () => {
		const tasks = Array.from({ length: 40 }, (_, i) =>
			task({ id: `TSK-${i}`, path: `W/Tasks/TSK-${i}`, status: "todo" }),
		);
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		// Big enough for a handful of rows, nowhere near enough for all 40.
		const unlimited = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"] } },
			snapshot,
			context,
		);
		const fullCost = estimateTokens(unlimited.text);
		const tightBudget = Math.round(fullCost / 8);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"] } },
			snapshot,
			context,
			undefined,
			tightBudget,
		);

		expect(result.tasks!.length).toBeGreaterThan(0);
		expect(result.tasks!.length).toBeLessThan(40);
		expect(estimateTokens(result.text)).toBeLessThanOrEqual(tightBudget);
		expect(result.text).toContain("add a filter to narrow this down");
		expect(result.totalMatches).toBe(40);
	});

	it("always shows at least one row even when the budget can't fit it", () => {
		const tasks = [
			task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo" }),
			task({ id: "TSK-2", path: "W/Tasks/TSK-2", status: "todo" }),
		];
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"] } },
			snapshot,
			context,
			undefined,
			1,
		);

		expect(result.tasks).toHaveLength(1);
	});

	it("doesn't truncate a small result that already fits comfortably", () => {
		const tasks = [
			task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo" }),
			task({ id: "TSK-2", path: "W/Tasks/TSK-2", status: "todo" }),
		];
		const snapshot = withEntities(tasks, []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"] } },
			snapshot,
			context,
			undefined,
			10_000,
		);

		expect(result.tasks).toHaveLength(2);
		expect(result.text).not.toContain("narrow this down");
	});

	it("returns the resolved filters and overdue flag alongside the result, for re-running the query later", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo", dueDate: "2020-01-01" });
		const snapshot = withEntities([t], []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "searchTasks", filters: { status: ["Todo"], overdue: true } },
			snapshot,
			context,
			"2026-01-01",
		);

		expect(result.query).toEqual({ filters: { status: ["todo"] }, overdue: true });
	});

	it("countTasks never returns query metadata — nothing to paginate", () => {
		const t = task({ id: "TSK-1", path: "W/Tasks/TSK-1", status: "todo" });
		const snapshot = withEntities([t], []);
		const context = snapshotContext(snapshot);

		const result = executeQueryAction(
			{ action: "countTasks", filters: { status: ["todo"] } },
			snapshot,
			context,
		);

		expect(result.query).toBeUndefined();
		expect(result.totalMatches).toBeUndefined();
	});
});
