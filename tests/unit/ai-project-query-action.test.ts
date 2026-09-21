import { describe, expect, it } from "vitest";
import {
	executeProjectQueryAction,
	looksLikeAttemptedAction,
	looksLikeQueryAction,
	parseProjectQueryAction,
} from "../../src/core/ai/query-action";
import { estimateTokens } from "../../src/core/ai/snapshot";
import { applyProjectFilters, matchesProjectFilters, snapshotContext } from "../../src/core/views";
import { NONE } from "../../src/core/types";
import type { WorkspaceSnapshot } from "../../src/core/types";
import { project } from "./fixtures";
import { sampleSnapshot } from "../../src/core/templates/instantiate";

function withProjects(projects: WorkspaceSnapshot["projects"]) {
	const base = sampleSnapshot();
	return { ...base, projects };
}

describe("applyProjectFilters / matchesProjectFilters", () => {
	it("hides archived projects by default, mixes them in, or shows only them (§7.7)", () => {
		const active = project({ path: "W/Projects/A", archived: false });
		const archived = project({ path: "W/Projects/B", archived: true, archivedAt: "2026-01-02" });
		const snapshot = withProjects([active, archived]);
		const context = snapshotContext(snapshot);

		expect(applyProjectFilters(snapshot.projects, {}, context)).toEqual([active]);
		expect(applyProjectFilters(snapshot.projects, { archived: "included" }, context)).toHaveLength(2);
		expect(applyProjectFilters(snapshot.projects, { archived: "only" }, context)).toEqual([archived]);
	});

	it("OR-matches status and AND's with priority", () => {
		const a = project({ path: "W/Projects/A", status: "in-progress", priority: "high" });
		const b = project({ path: "W/Projects/B", status: "in-progress", priority: "low" });
		const c = project({ path: "W/Projects/C", status: "done", priority: "high" });
		const snapshot = withProjects([a, b, c]);
		const context = snapshotContext(snapshot);

		const result = applyProjectFilters(
			snapshot.projects,
			{ status: ["in-progress"], priority: ["high"] },
			context,
		);
		expect(result).toEqual([a]);
	});

	it("matches labels, including the NONE sentinel for unlabeled projects", () => {
		const labeled = project({ path: "W/Projects/A", labels: ["performance"] });
		const unlabeled = project({ path: "W/Projects/B", labels: [] });
		const snapshot = withProjects([labeled, unlabeled]);
		const context = snapshotContext(snapshot);

		expect(applyProjectFilters(snapshot.projects, { labels: ["performance"] }, context)).toEqual([
			labeled,
		]);
		expect(applyProjectFilters(snapshot.projects, { labels: [NONE] }, context)).toEqual([unlabeled]);
	});

	it("matches owner by id, including the NONE sentinel for unowned projects", () => {
		const owned = project({ path: "W/Projects/A", owner: "alice" });
		const unowned = project({ path: "W/Projects/B", owner: null });
		const snapshot = withProjects([owned, unowned]);
		const context = snapshotContext(snapshot);

		expect(applyProjectFilters(snapshot.projects, { owner: ["alice"] }, context)).toEqual([owned]);
		expect(applyProjectFilters(snapshot.projects, { owner: [NONE] }, context)).toEqual([unowned]);
	});

	it("text matches the title, case-insensitively", () => {
		const p = project({ path: "W/Projects/A", title: "Core App Experience" });
		const other = project({ path: "W/Projects/B", title: "Marketing" });
		const snapshot = withProjects([p, other]);
		const context = snapshotContext(snapshot);

		expect(applyProjectFilters(snapshot.projects, { text: "core app" }, context)).toEqual([p]);
	});

	it("an empty filter set matches everything (minus the default archived hide)", () => {
		const a = project({ path: "W/Projects/A" });
		const b = project({ path: "W/Projects/B" });
		const snapshot = withProjects([a, b]);
		const context = snapshotContext(snapshot);

		expect(applyProjectFilters(snapshot.projects, {}, context)).toEqual([a, b]);
	});

	it("matchesProjectFilters and applyProjectFilters agree on a single project", () => {
		const p = project({ path: "W/Projects/A", status: "in-progress" });
		const snapshot = withProjects([p]);
		const context = snapshotContext(snapshot);

		expect(matchesProjectFilters(p, { status: ["in-progress"] }, context)).toBe(
			applyProjectFilters([p], { status: ["in-progress"] }, context).length === 1,
		);
	});
});

describe("parseProjectQueryAction", () => {
	it("parses a well-formed searchProjects action", () => {
		const result = parseProjectQueryAction(
			'{"action":"searchProjects","filters":{"status":["Active"]}}',
		);
		expect(result).toEqual({ action: "searchProjects", filters: { status: ["Active"] } });
	});

	it("parses a well-formed countProjects action with string filters", () => {
		const result = parseProjectQueryAction(
			'{"action":"countProjects","filters":{"archived":"only","text":"launch"}}',
		);
		expect(result).toEqual({
			action: "countProjects",
			filters: { archived: "only", text: "launch" },
		});
	});

	it("tolerates surrounding prose or a markdown fence around the JSON", () => {
		const result = parseProjectQueryAction(
			'Sure, let me check that.\n```json\n{"action":"searchProjects","filters":{}}\n```',
		);
		expect(result).toEqual({ action: "searchProjects", filters: {} });
	});

	it("returns null for plain conversational text", () => {
		expect(parseProjectQueryAction("Sure! There are 3 projects in this workspace.")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		expect(parseProjectQueryAction("{not valid json")).toBeNull();
	});

	it("returns null when action isn't one of the two recognized literals", () => {
		expect(parseProjectQueryAction('{"action":"searchTasks","filters":{}}')).toBeNull();
		expect(parseProjectQueryAction('{"action":"deleteEverything","filters":{}}')).toBeNull();
	});

	it("returns null when filters contains an unrecognized key", () => {
		expect(
			parseProjectQueryAction('{"action":"searchProjects","filters":{"assignee":["x"]}}'),
		).toBeNull();
	});

	it("returns null when an array filter key holds a non-array value", () => {
		expect(
			parseProjectQueryAction('{"action":"searchProjects","filters":{"status":"Active"}}'),
		).toBeNull();
	});

	it("returns null when an array filter holds a non-string element", () => {
		expect(
			parseProjectQueryAction('{"action":"searchProjects","filters":{"status":[1,2]}}'),
		).toBeNull();
	});

	it("returns null when archived isn't one of its two literal values", () => {
		expect(
			parseProjectQueryAction('{"action":"searchProjects","filters":{"archived":"yes"}}'),
		).toBeNull();
	});

	it("returns null when text holds a non-string value", () => {
		expect(
			parseProjectQueryAction('{"action":"searchProjects","filters":{"text":5}}'),
		).toBeNull();
	});
});

describe("looksLikeQueryAction recognizes all four action names", () => {
	it("is true for searchProjects and countProjects, not just the task actions", () => {
		expect(looksLikeQueryAction('{"action":"searchProjects","filters":{}}')).toBe(true);
		expect(looksLikeQueryAction('{"action":"countProjects","filters":{}}')).toBe(true);
		expect(looksLikeQueryAction('{"action":"searchTasks","filters":{}}')).toBe(true);
		expect(looksLikeQueryAction('{"action":"countTasks","filters":{}}')).toBe(true);
	});

	it("is true for an attempted searchProjects action with invalid filter keys (still an attempt)", () => {
		expect(looksLikeQueryAction('{"action":"searchProjects","filters":{"bogus":1}}')).toBe(true);
	});

	it("is false for an unrelated action name", () => {
		expect(looksLikeQueryAction('{"action":"deleteEverything","filters":{}}')).toBe(false);
	});
});

describe("looksLikeAttemptedAction still catches malformed/garbled project actions", () => {
	it("routes a garbled searchProjects attempt through the same corrective-retry check", () => {
		const garbled = '{"action": "searchProjects", "filters": {}>{"action": "countProjects"}';
		expect(() => {
			JSON.parse(garbled);
		}).toThrow();
		expect(looksLikeAttemptedAction(garbled)).toBe(true);
	});
});

describe("executeProjectQueryAction", () => {
	it("countProjects returns a plain count, never full rows", () => {
		const a = project({ path: "W/Projects/A", status: "in-progress" });
		const b = project({ path: "W/Projects/B", status: "done" });
		const snapshot = withProjects([a, b]);
		const context = snapshotContext(snapshot);

		const result = executeProjectQueryAction(
			{ action: "countProjects", filters: { status: ["in-progress"] } },
			snapshot,
			context,
		);

		expect(result.text).toBe("1 project(s) matched.");
		expect(result.projects).toBeUndefined();
		expect(result.query).toBeUndefined();
		expect(result.totalMatches).toBeUndefined();
	});

	it("searchProjects resolves a display-name status filter to its id and returns matching rows", () => {
		const a = project({ path: "W/Projects/A", title: "Alpha", status: "in-progress" });
		const b = project({ path: "W/Projects/B", title: "Beta", status: "done" });
		const snapshot = withProjects([a, b]);
		const context = snapshotContext(snapshot);

		// "In Progress" is the DEFAULT_STATUSES display name for the "in-progress" id.
		const result = executeProjectQueryAction(
			{ action: "searchProjects", filters: { status: ["In Progress"] } },
			snapshot,
			context,
		);

		expect(result.text).toContain("Alpha");
		expect(result.text).not.toContain("Beta");
		expect(result.projects).toEqual([a]);
	});

	it("resolves an owner display name to the person's id", () => {
		const a = project({ path: "W/Projects/A", title: "Alpha", owner: "alice" });
		const b = project({ path: "W/Projects/B", title: "Beta", owner: "bob" });
		const snapshot = withProjects([a, b]);
		const context = snapshotContext(snapshot);

		const result = executeProjectQueryAction(
			{ action: "searchProjects", filters: { owner: ["Alice"] } },
			snapshot,
			context,
		);

		expect(result.text).toContain("Alpha");
		expect(result.text).not.toContain("Beta");
	});

	it("resolves a label display name to its id", () => {
		const a = project({ path: "W/Projects/A", title: "Alpha", labels: ["performance"] });
		const b = project({ path: "W/Projects/B", title: "Beta", labels: [] });
		const snapshot = withProjects([a, b]);
		const context = snapshotContext(snapshot);

		const result = executeProjectQueryAction(
			{ action: "searchProjects", filters: { labels: ["Performance"] } },
			snapshot,
			context,
		);

		expect(result.text).toContain("Alpha");
		expect(result.text).not.toContain("Beta");
	});

	it("drops a filter value that resolves to nothing rather than crashing", () => {
		const a = project({ path: "W/Projects/A" });
		const snapshot = withProjects([a]);
		const context = snapshotContext(snapshot);

		expect(() =>
			executeProjectQueryAction(
				{ action: "searchProjects", filters: { status: ["Not A Real Status"] } },
				snapshot,
				context,
			),
		).not.toThrow();
	});

	it("caps searchProjects results and notes how many more matched", () => {
		const projects = Array.from({ length: 150 }, (_, i) =>
			project({ path: `W/Projects/P${i}`, title: `P${i}`, status: "in-progress" }),
		);
		const snapshot = withProjects(projects);
		const context = snapshotContext(snapshot);

		const result = executeProjectQueryAction(
			{ action: "searchProjects", filters: { status: ["In Progress"] } },
			snapshot,
			context,
		);

		expect(result.text).toContain("showing 100 of 150 matching projects");
		expect(result.projects).toHaveLength(100);
		expect(result.totalMatches).toBe(150);
	});

	it("halves the row count until the formatted text fits a tight availableTokens budget", () => {
		const projects = Array.from({ length: 40 }, (_, i) =>
			project({ path: `W/Projects/P${i}`, title: `P${i}`, status: "in-progress" }),
		);
		const snapshot = withProjects(projects);
		const context = snapshotContext(snapshot);

		const unlimited = executeProjectQueryAction(
			{ action: "searchProjects", filters: { status: ["In Progress"] } },
			snapshot,
			context,
		);
		const fullCost = estimateTokens(unlimited.text);
		const tightBudget = Math.round(fullCost / 8);

		const result = executeProjectQueryAction(
			{ action: "searchProjects", filters: { status: ["In Progress"] } },
			snapshot,
			context,
			tightBudget,
		);

		expect(result.projects!.length).toBeGreaterThan(0);
		expect(result.projects!.length).toBeLessThan(40);
		expect(estimateTokens(result.text)).toBeLessThanOrEqual(tightBudget);
		expect(result.text).toContain("add a filter to narrow this down");
		expect(result.totalMatches).toBe(40);
	});

	it("returns the resolved filters alongside the result, for re-running the query later", () => {
		const a = project({ path: "W/Projects/A", status: "in-progress" });
		const snapshot = withProjects([a]);
		const context = snapshotContext(snapshot);

		const result = executeProjectQueryAction(
			{ action: "searchProjects", filters: { status: ["In Progress"] } },
			snapshot,
			context,
		);

		expect(result.query).toEqual({ filters: { status: ["in-progress"] } });
	});

	it("returns an empty (not thrown) result when nothing matches", () => {
		const a = project({ path: "W/Projects/A", status: "in-progress" });
		const snapshot = withProjects([a]);
		const context = snapshotContext(snapshot);

		const result = executeProjectQueryAction(
			{ action: "searchProjects", filters: { status: ["done"] } },
			snapshot,
			context,
		);

		expect(result.projects).toEqual([]);
		expect(result.totalMatches).toBe(0);
	});
});
