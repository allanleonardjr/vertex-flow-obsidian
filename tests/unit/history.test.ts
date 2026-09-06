/**
 * Activity history — the pure, Obsidian-free core. Format (`src/core/history/`),
 * field diffs (`diff.ts`), the workspace-config default, and the template
 * override. The `HistoryLog`/`NoteIO` glue (where files live, seq seeding,
 * chained appends) is outside the testable envelope — same line testing.md
 * draws for `Mutations` — so the append-only *format* and the *deltas* it
 * records are what get pinned here.
 */

import { describe, expect, it } from "vitest";
import {
	HISTORY_FOLDER,
	historyFolder,
	historyPathFor,
	monthKey,
	parseHistoryLog,
	serializeEntryLine,
	valuesDiffer,
} from "../../src/core/history";
import {
	diffProjectFields,
	diffTaskFields,
	workspaceConfigChanges,
} from "../../src/core/history/diff";
import { parseTemplateMarkdown } from "../../src/core/templates/markdown/parse";
import { instantiateTemplate, templateById } from "../../src/core/templates";
import { SYSTEM_VIEW_ALL_TASKS_ID } from "../../src/core/views";
import { createWorkspaceConfig } from "../../src/core/serialization/workspace";
import type {
	HistoryEntry,
	Project,
	Task,
	WorkspaceConfig,
} from "../../src/core/types";
import { project, task } from "./fixtures";

/** A person-shaped actor, the standard one the Mutations layer derives. */
const ALLAN = { kind: "person", id: "allan", name: "Allan" } as const;

function entry(partial: Partial<HistoryEntry>): HistoryEntry {
	return {
		seq: 1,
		ts: "2026-09-05T14:32:00Z",
		actor: ALLAN,
		action: "task.update",
		workspace: "Product Team",
		targets: [
			{ kind: "task", id: "TSK-0104", path: "Product Team/Tasks/TSK-0104" },
		],
		...partial,
	};
}

describe("log location", () => {
	it("rotates one file per month", () => {
		expect(monthKey("2026-09-05T14:32:00Z")).toBe("2026-09");
		expect(monthKey("2026-01-31T23:59:00Z")).toBe("2026-01");
	});

	it("lives under the workspace's own History/ folder", () => {
		expect(historyPathFor("Product Team", "2026-09-05T14:32:00Z")).toBe(
			"Product Team/History/2026-09.md",
		);
		expect(historyFolder("Product Team")).toBe("Product Team/History");
		expect(historyPathFor("Product Team", "2026-09-05T14:32:00Z")).toContain(
			`/${HISTORY_FOLDER}/`,
		);
	});
});

describe("serializeEntryLine / parseHistoryLog", () => {
	it("writes one entry as a single flow-YAML line", () => {
		const line = serializeEntryLine(entry({}));
		expect(line.endsWith("\n")).toBe(true);
		expect(line.trim().startsWith("- {")).toBe(true);
		// A single line that parses back to the entry array — the round trip.
		expect(parseHistoryLog(line)).toEqual([entry({})]);
	});

	it("round-trips an entry with changes and a system actor", () => {
		const changy: HistoryEntry = entry({
			seq: 7,
			actor: { kind: "system", name: "auto-archive" },
			action: "task.update",
			targets: [
				{ kind: "task", id: "TSK-0104", path: "Product Team/Tasks/TSK-0104" },
			],
			changes: [
				{ field: "status", from: "backlog", to: "started" },
				{ field: "labels", from: ["bug"], to: ["bug", "performance"] },
			],
		});
		expect(parseHistoryLog(serializeEntryLine(changy))).toEqual([changy]);
	});

	it("quotes values the parser would otherwise choke on", () => {
		// A colon inside a name would break naive line formats; flow YAML handles
		// it, and parseHistoryLog must read it back exactly.
		const namey: HistoryEntry = entry({
			actor: { kind: "person", id: "dev", name: "Dev: Ops" },
		});
		expect(parseHistoryLog(serializeEntryLine(namey))).toEqual([namey]);
	});

	it("forgives empty input", () => {
		expect(parseHistoryLog("")).toEqual([]);
		expect(parseHistoryLog("   \n  ")).toEqual([]);
	});

	it("forgives a file that isn't a list", () => {
		expect(parseHistoryLog("name: Actually a map")).toEqual([]);
	});

	it("drops just the mangled line, keeping the good ones", () => {
		const good = serializeEntryLine(entry({ seq: 1 }));
		const text = `${good}  - this line is not a valid entry: [\n${good}`;
		expect(parseHistoryLog(text)).toHaveLength(2);
	});
});

describe("valuesDiffer", () => {
	it("treats identical values as equal", () => {
		expect(valuesDiffer("a", "a")).toBe(false);
		expect(valuesDiffer(3, 3)).toBe(false);
		expect(valuesDiffer(false, false)).toBe(false);
		expect(valuesDiffer(["a", "b"], ["a", "b"])).toBe(false);
	});

	it("treats NaN as equal to NaN (never an observed change)", () => {
		expect(valuesDiffer(Number.NaN, Number.NaN)).toBe(false);
	});

	it("compares arrays by content, and order matters", () => {
		expect(valuesDiffer(["a", "b"], ["a", "c"])).toBe(true);
		expect(valuesDiffer(["a", "b"], ["b", "a"])).toBe(true);
	});

	it("treats undefined and null as the same absence", () => {
		expect(valuesDiffer(undefined, null)).toBe(false);
		expect(valuesDiffer({ a: 1 }, { a: 1 })).toBe(false);
	});
});

describe("diffTaskFields", () => {
	const base = task({ id: "TSK-0104", status: "backlog", labels: [], rank: "0|hzzzzz:" });

	it("reports the fields that changed", () => {
		const next = { ...base, status: "started" };
		expect(diffTaskFields(base, next)).toEqual([
			{ field: "status", from: "backlog", to: "started" },
		]);
	});

	it("reports label changes as arrays", () => {
		const next = { ...base, labels: ["bug"] };
		expect(diffTaskFields(base, next)).toEqual([
			{ field: "labels", from: [], to: ["bug"] },
		]);
	});

	it("never records the always-churn / structural fields", () => {
		const next: Task = {
			...base,
			updatedAt: "2099-01-01T00:00:00.000Z",
			createdAt: "2099-01-01T00:00:00.000Z",
			rank: "0|i00004:",
			path: "Product Team/Tasks/TSK-0104",
			relations: {
				blocks: ["Other"],
				blockedBy: [],
				related: [],
				duplicateOf: "",
			},
			mentions: ["someone"],
		};
		expect(diffTaskFields(base, next)).toEqual([]);
	});

	it("lets the caller opt fields out (drag rank juggling)", () => {
		const next = { ...base, status: "started", rank: "0|i00004:" };
		expect(diffTaskFields(base, next, { skip: ["status"] })).toEqual([]);
	});

	it("returns no changes for an untouched task", () => {
		expect(diffTaskFields(base, { ...base })).toEqual([]);
	});
});

describe("diffProjectFields", () => {
	const base = project({ title: "Core App", status: "in-progress" });

	it("reports the fields that changed", () => {
		const next = { ...base, title: "Core App v2", owner: "allan" };
		expect(diffProjectFields(base, next)).toEqual([
			{ field: "title", from: "Core App", to: "Core App v2" },
			{ field: "owner", from: null, to: "allan" },
		]);
	});

	it("ignores the body / always-churn fields", () => {
		const next: Project = {
			...base,
			updatedAt: "2099-01-01T00:00:00.000Z",
			path: "Product Team/Projects/Nope",
		};
		expect(diffProjectFields(base, next)).toEqual([]);
	});
});

describe("workspaceConfigChanges", () => {
	function ws(partial: Partial<WorkspaceConfig>): WorkspaceConfig {
		return {
			...createWorkspaceConfig("Product Team", "TSK", "Product Team"),
			...partial,
		};
	}

	it("records scalar config edits", () => {
		const from = ws({});
		const to = { ...from, name: "Prod", icon: "rocket" };
		expect(workspaceConfigChanges(from, to)).toEqual([
			{ field: "name", from: "Product Team", to: "Prod" },
			{ field: "icon", from: undefined, to: "rocket" },
		]);
		expect(workspaceConfigChanges(from, from)).toEqual([]);
	});

	it("flattens archiving and history into dotted fields", () => {
		const from = ws({});
		const to = {
			...from,
			archiving: { autoArchiveEnabled: true, autoArchiveDays: 45 },
			history: { enabled: true },
		};
		expect(workspaceConfigChanges(from, to)).toEqual([
			{ field: "archiving.autoArchiveEnabled", from: false, to: true },
			{ field: "archiving.autoArchiveDays", from: 30, to: 45 },
			{ field: "history.enabled", from: false, to: true },
		]);
	});

	it("records taxonomy identity, per-item edits, adds and removes", () => {
		const from = ws({
			statuses: [
				{ id: "backlog", name: "Backlog", color: "#999", category: "backlog", order: 1 },
				{ id: "done", name: "Done", color: "#0f0", category: "completed", order: 2 },
			],
		});
		const to = ws({
			statuses: [
				{ id: "backlog", name: "To Do", color: "#999", category: "backlog", order: 1 },
				{ id: "shipped", name: "Shipped", color: "#0f0", category: "completed", order: 2 },
			],
		});
		expect(workspaceConfigChanges(from, to)).toEqual([
			// "done" left, "shipped" arrived
			{ field: "statuses", from: ["backlog", "done"], to: ["backlog", "shipped"] },
			// "backlog" was renamed
			{ field: "statuses.backlog.name", from: "Backlog", to: "To Do" },
			// per-item removals/additions
			{ field: "statuses.done", from: { id: "done", name: "Done", color: "#0f0", category: "completed", order: 2 } },
			{ field: "statuses.shipped", to: { id: "shipped", name: "Shipped", color: "#0f0", category: "completed", order: 2 } },
		]);
	});

	it("records people edits, including the isSelf flag", () => {
		const from = ws({
			people: [{ id: "allan", name: "Allan", aliases: [], isSelf: false }],
		});
		const to = ws({
			people: [
				{ id: "allan", name: "Allan", aliases: [], isSelf: true },
				{ id: "jo", name: "Jo", aliases: [], isSelf: false },
			],
		});
		expect(workspaceConfigChanges(from, to)).toEqual([
			{ field: "people", from: ["allan"], to: ["allan", "jo"] },
			{ field: "people.allan.isSelf", from: false, to: true },
			{
				field: "people.jo",
				to: { id: "jo", name: "Jo", aliases: [], isSelf: false },
			},
		]);
	});

	it("ignores the structural root field", () => {
		const from = ws({});
		const to = { ...from, root: "Somewhere Else" };
		expect(workspaceConfigChanges(from, to)).toEqual([]);
	});
});

describe("workspace default", () => {
	it("starts with history off", () => {
		const ws = createWorkspaceConfig("Product Team", "TSK", "Product Team");
		expect(ws.history).toEqual({ enabled: false });
	});
});

describe("template override", () => {
	it("maps a flat `history: true` in template frontmatter to the config shape", () => {
		const source = [
			"templateSchema: 1",
			"kind: template",
			"id: fixture",
			"name: Fixture",
			"description: A fixture.",
			"supportsExampleContent: false",
			"history: true",
			"",
		].join("\n");
		const parsed = parseTemplateMarkdown(`---\n${source}\n---\n\n# Projects\n\n# Tasks\n`);
		expect(parsed.workspaceOverrides.history).toEqual({ enabled: true });
	});

	it("stays off when the template omits history", () => {
		const parsed = parseTemplateMarkdown(
			`---
templateSchema: 1
kind: template
id: fixture
name: Fixture
description: A fixture.
supportsExampleContent: false
---

# Projects

# Tasks
`,
		);
		expect(parsed.workspaceOverrides.history).toBeUndefined();
	});

	it("applies the override when a template workspace is instantiated", () => {
		const gettingStarted = templateById("getting-started");
		expect(gettingStarted).toBeDefined();
		const { workspace } = instantiateTemplate({
			template: gettingStarted!,
			root: "Getting Started",
			name: "Getting Started",
			includeExampleContent: false,
			now: new Date("2026-09-05T12:00:00Z"),
		});
		expect(workspace.history.enabled).toBe(true);
	});

	it("keeps history off for a blank workspace", () => {
		const blank = templateById("blank-workspace");
		expect(blank).toBeDefined();
		const { workspace } = instantiateTemplate({
			template: blank!,
			root: "Blank",
			name: "Blank",
			includeExampleContent: false,
			now: new Date("2026-09-05T12:00:00Z"),
		});
		expect(workspace.history.enabled).toBe(false);
	});

	it("lets the creator turn a template's history off", () => {
		const gettingStarted = templateById("getting-started");
		expect(gettingStarted).toBeDefined();
		const { workspace } = instantiateTemplate({
			template: gettingStarted!,
			root: "Getting Started",
			name: "Getting Started",
			includeExampleContent: false,
			enableHistory: false,
			now: new Date("2026-09-05T12:00:00Z"),
		});
		expect(workspace.history.enabled).toBe(false);
	});

	it("lets the creator turn a template's history on", () => {
		const blank = templateById("blank-workspace");
		expect(blank).toBeDefined();
		const { workspace } = instantiateTemplate({
			template: blank!,
			root: "Blank",
			name: "Blank",
			includeExampleContent: false,
			enableHistory: true,
			now: new Date("2026-09-05T12:00:00Z"),
		});
		expect(workspace.history.enabled).toBe(true);
	});
});

describe("demo history for a fresh workspace", () => {
	const now = new Date("2026-09-05T12:00:00Z");

	function populated(enableHistory: boolean) {
		return instantiateTemplate({
			template: templateById("getting-started")!,
			root: "Getting Started",
			name: "Getting Started",
			includeExampleContent: true,
			enableHistory,
			now,
		});
	}

	it("seeds a log only when history is on and example content is included", () => {
		expect(populated(true).history?.length ?? 0).toBeGreaterThan(0);
		expect(populated(false).history).toBeUndefined();
		// History on but no example content → nothing to narrate.
		const empty = instantiateTemplate({
			template: templateById("getting-started")!,
			root: "Getting Started",
			name: "Getting Started",
			includeExampleContent: false,
			enableHistory: true,
			now,
		});
		expect(empty.history).toBeUndefined();
	});

	it("opens with history switched on, authored by the bracketed system handle", () => {
		const { history } = populated(true);
		const first = history![0];
		expect(first.action).toBe("workspace.config.update");
		expect(first.actor).toEqual({ kind: "system", name: "[system]" });
		expect(first.targets[0].kind).toBe("workspace");
		expect(first.changes).toEqual([{ field: "history.enabled", to: true }]);
	});

	it("mentions every example Project and Task it scaffolds", () => {
		const generated = populated(true);
		const { history, snapshot } = generated;
		const creates = (action: string) =>
			history!.filter((e) => e.action === action);
		expect(creates("project.create")).toHaveLength(snapshot.projects.length);
		expect(creates("task.create")).toHaveLength(snapshot.tasks.length);
		expect(creates("task.create").every((e, i) => e.targets[0].id === snapshot.tasks[i].id)).toBe(true);
	});

	it("records the scaffolded Views and Dashboards", () => {
		const generated = instantiateTemplate({
			template: templateById("agency-client-management")!,
			root: "Agency",
			name: "Agency",
			includeExampleContent: true,
			enableHistory: true,
			now,
		});
		const { history, snapshot } = generated;
		const recordedViews = history!.filter((e) => e.action === "view.create");
		const recordedDashboards = history!.filter(
			(e) => e.action === "dashboard.create",
		);
		const expectedViews = snapshot.views.filter(
			(v) => v.id !== SYSTEM_VIEW_ALL_TASKS_ID,
		);
		expect(expectedViews.length).toBeGreaterThan(0);
		expect(recordedViews).toHaveLength(expectedViews.length);
		expect(recordedDashboards).toHaveLength(snapshot.dashboards.length);
		expect(recordedViews.map((e) => e.targets[0].id)).toEqual(
			expectedViews.map((v) => v.id),
		);
		expect(recordedDashboards.map((e) => e.targets[0].id)).toEqual(
			snapshot.dashboards.map((d) => d.id),
		);
	});

	it("shows a bulk status change, an individual advance, a priority bump and a comment", () => {
		const generated = populated(true);
		const { history, snapshot, workspace } = generated;
		const entries = history!;

		const bulk = entries.find((e) => e.action === "task.bulk-update");
		expect(bulk).toBeDefined();
		expect(bulk!.targets).toHaveLength(3);
		expect(new Set(bulk!.changes?.map((c) => c.field))).toEqual(new Set(["status"]));
		const started = workspace.statuses.find((s) => s.category === "started");
		expect(bulk!.changes?.every((c) => c.to === started?.id)).toBe(true);

		const statusChange = entries.find(
			(e) => e.action === "task.update" && e.changes?.[0]?.field === "status",
		);
		const completed = workspace.statuses.find((s) => s.category === "completed");
		expect(statusChange?.targets[0].path).toBe(
			snapshot.tasks[snapshot.tasks.length - 1].path,
		);
		expect(statusChange?.changes?.[0].to).toBe(completed?.id);

		const priorityChange = entries.find(
			(e) => e.action === "task.update" && e.changes?.[0]?.field === "priority",
		);
		expect(priorityChange?.targets[0].path).toBe(snapshot.tasks[0].path);
		expect(priorityChange?.changes?.[0].to).toBe(workspace.priorities[0].id);

		const comment = entries.find((e) => e.action === "comment.add");
		expect(comment?.targets[0].path).toBe(snapshot.tasks[0].path);
		expect(comment?.changes).toEqual([{ field: "comment" }]);
	});

	it("is strictly chronological with seq 1..N", () => {
		const { history } = populated(true);
		for (let i = 1; i < history!.length; i++) {
			expect(history![i].seq).toBe(history![i - 1].seq + 1);
			expect(history![i].ts >= history![i - 1].ts).toBe(true);
		}
		expect(history![0].seq).toBe(1);
	});

	it("still round-trips when written as lines", () => {
		const { history } = populated(true);
		const text = history!.map(serializeEntryLine).join("");
		expect(parseHistoryLog(text)).toEqual(history);
	});
});