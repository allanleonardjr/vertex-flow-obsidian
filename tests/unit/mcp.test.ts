/**
 * The MCP core layer: URI grammar round-trips and the JSON payload builders.
 *
 * These are pure functions over core types — the same surface the HTTP glue in
 * `src/mcp/` serves (minus the SDK wrappers), so a breaking change to a payload
 * shape fails a test here before any client ever sees it.
 */

import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import {
	MCP_MAX_RESULTS,
	commentRows,
	dashboardDetail,
	dashboardRow,
	labelRows,
	pageList,
	personRows,
	projectRows,
	taskDetail,
	taskRows,
	viewDetail,
	viewRow,
	workspaceDetail,
	workspaceRow,
} from "../../src/core/mcp/responses";
import {
	buildVaultUri,
	parseVaultUri,
	type VaultUriIntent,
} from "../../src/core/mcp/uris";
import {
	getHelpTopic,
	searchHelp,
} from "../../src/core/mcp/help";

const snapshot = sampleSnapshot();

/* ------------------------------------------------------------------- uris -- */

describe("vault URI grammar", () => {
	const intents: VaultUriIntent[] = [
		{ action: "open-note", path: "Sample Workspace/Tasks/TSK-0001", target: "vf" },
		{ action: "open-note", path: "A/B/C.md note", target: "native" },
		{ action: "open-view", viewId: "all-tasks", root: "Sample Workspace" },
		{ action: "open-view", viewId: "sprint-board" },
		{ action: "help", topicId: "views-saved-views", anchor: "query-language" },
		{ action: "query", source: 'status:todo label:"front end"', root: "Sample Workspace" },
	];

	it.each(intents)("round-trips $action", (intent) => {
		const uri = buildVaultUri(intent);
		expect(uri.startsWith("obsidian://vertex-flow?")).toBe(true);
		expect(parseVaultUri(uri)).toEqual(intent);
	});

	it("handles paths with spaces and slashes", () => {
		const intent: VaultUriIntent = {
			action: "open-note",
			path: "Sample Workspace/Projects/Core App Experience",
			target: "vf",
		};
		expect(parseVaultUri(buildVaultUri(intent))).toEqual(intent);
	});

	it("rejects URIs from another scheme", () => {
		expect(parseVaultUri("obsidian://other?open-note=x")).toBeNull();
	});

	it("defaults the open-note target to vf", () => {
		const parsed = parseVaultUri("obsidian://vertex-flow?open-note=Tasks%2FTSK-1");
		expect(parsed).toEqual({
			action: "open-note",
			path: "Tasks/TSK-1",
			target: "vf",
		});
	});

	it("decodes params straight from an Obsidian handler", () => {
		expect(
			parseVaultUri(
				"obsidian://vertex-flow?query=status%3Ain-progress&root=Sample%20Workspace",
			),
		).toEqual({
			action: "query",
			source: "status:in-progress",
			root: "Sample Workspace",
		});
	});
});

/* ------------------------------------------------------------ pagination --- */

describe("pageList", () => {
	it("caps at the shared limit and reports truncation", () => {
		const rows = Array.from({ length: MCP_MAX_RESULTS + 5 }, (_, i) => i);
		const payload = pageList(rows);
		expect(payload.results).toHaveLength(MCP_MAX_RESULTS);
		expect(payload.total).toBe(MCP_MAX_RESULTS + 5);
		expect(payload.truncated).toBe(true);
	});

	it("is not truncated under the cap", () => {
		const payload = pageList([1, 2, 3]);
		expect(payload).toEqual({ results: [1, 2, 3], total: 3, truncated: false });
	});
});

/* ------------------------------------------------------------ workspaces --- */

describe("workspace payloads", () => {
	it("summarises a workspace", () => {
		const row = workspaceRow(snapshot);
		expect(row.id).toBe(snapshot.workspace.root);
		expect(row.name).toBe("Sample Workspace");
		expect(row.taskCount).toBe(snapshot.tasks.length);
		expect(row.projectCount).toBe(snapshot.projects.length);
	});

	it("carries taxonomies and entity summaries in the detail", () => {
		const detail = workspaceDetail(snapshot);
		expect(detail.statuses.length).toBeGreaterThan(0);
		expect(detail.statuses[0]).toHaveProperty("category");
		expect(detail.people).toContain("Alice");
		expect(detail.projects.length).toBe(snapshot.projects.length);
		expect(detail.views.length).toBe(snapshot.views.length);
		expect(detail.labels.length).toBe(snapshot.workspace.labels.length);
	});
});

/* -------------------------------------------------------------- projects --- */

describe("project payloads", () => {
	it("counts each project's tasks", () => {
		const rows = projectRows(snapshot);
		expect(rows.length).toBe(snapshot.projects.length);
		const withTasks = rows.find((r) => r.taskCount > 0);
		expect(withTasks).toBeDefined();
	});

	it("filters by status id", () => {
		const project = snapshot.projects[0];
		const rows = projectRows(snapshot, { status: project.status });
		if (project.status == null) {
			expect(rows.every((r) => r.status === null)).toBe(true);
		} else {
			expect(rows.every((r) => r.status === project.status)).toBe(true);
		}
	});
});

/* ---------------------------------------------------------------- tasks ---- */

describe("task payloads", () => {
	it("lists tasks with sub-task counts", () => {
		const rows = taskRows(snapshot);
		const visible = snapshot.tasks.filter((t) => !t.archived).length;
		expect(rows.length).toBe(visible);
		expect(rows[0]).toHaveProperty("id");
		expect(rows[0]).toHaveProperty("path");
		expect(rows[0]).toHaveProperty("subTaskCount");
	});

	it("includes archived tasks on request", () => {
		const rows = taskRows(snapshot, {}, null, true);
		expect(rows.length).toBe(snapshot.tasks.length);
	});

	it("filters through the real view filter engine", () => {
		const rows = taskRows(snapshot, { status: ["in-progress"] });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.status === "in-progress")).toBe(true);
	});

	it("filters by assignee id", () => {
		const rows = taskRows(snapshot, { assignee: ["alice"] });
		expect(rows.every((r) => r.assignee === "alice")).toBe(true);
	});

	it("filters by project path", () => {
		const project = snapshot.projects[0];
		const rows = taskRows(snapshot, { project: [project.path] });
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.project === project.path)).toBe(true);
	});

	it("resolves names and builds the deep link in the detail", () => {
		const task = snapshot.tasks[0];
		const detail = taskDetail(snapshot, task, "Do the thing.", "alice");
		expect(detail.task.id).toBe(task.id);
		expect(detail.task.vaultUri).toContain("open-note");
		expect(detail.task.description).toBe("Do the thing.");
		expect(detail.task.relations).toHaveProperty("blocks");
		expect(detail.task.relations).toHaveProperty("duplicateOf");
		if (task.status) {
			expect(detail.task.statusName).toBe(
				snapshot.workspace.statuses.find((s) => s.id === task.status)?.name,
			);
		}
	});

	it("only includes optional detail fields when present", () => {
		const task = snapshot.tasks[0];
		const detail = taskDetail(snapshot, task, "", "alice");
		expect(detail.task.description).toBeUndefined();
		expect(detail.task.parentTitle).toBeUndefined();
	});

	it("exposes a subtasksQuery when the task has sub-tasks", () => {
		const parentPath = snapshot.tasks.find((t) => t.parent)?.parent;
		const parent = snapshot.tasks.find((t) => t.path === parentPath);
		expect(parent).toBeDefined();

		const detail = taskDetail(snapshot, parent!, "", "alice");
		expect(detail.task.subtasksQuery).toBe(`parent:${parent!.id}`);
	});

	it("omits subtasksQuery when the task has no sub-tasks", () => {
		const leaf = snapshot.tasks.find(
			(t) => !snapshot.tasks.some((other) => other.parent === t.path),
		);
		expect(leaf).toBeDefined();

		const detail = taskDetail(snapshot, leaf!, "", "alice");
		expect(detail.task.subtasksQuery).toBeUndefined();
	});
});

/* ---------------------------------------------------------------- views ---- */

describe("view payloads", () => {
	it("exposes a view row with its deep link", () => {
		const view = snapshot.views[0];
		const row = viewRow(snapshot.workspace.root, view);
		expect(row.id).toBe(view.id);
		expect(row.vaultUri).toContain("open-view");
	});

	it("carries the full definition in the detail", () => {
		const view = snapshot.views[0];
		const detail = viewDetail(snapshot.workspace.root, view);
		expect(detail.filters).toEqual(view.filters);
		expect(detail.viewType).toBe(view.viewType);
		expect(detail.hiddenFields).toEqual(view.hiddenFields);
	});
});

/* ------------------------------------------------------------ dashboards --- */

describe("dashboard payloads", () => {
	it("summarises a dashboard", () => {
		const dashboard = snapshot.dashboards[0];
		const row = dashboardRow(snapshot.workspace.root, dashboard);
		expect(row.id).toBe(dashboard.id);
		expect(row.widgetCount).toBe(dashboard.widgets.length);
		expect(row.vaultUri).toContain("open-view");
	});

	it("lists widget types in the detail", () => {
		const dashboard = snapshot.dashboards[0];
		const detail = dashboardDetail(snapshot.workspace.root, dashboard);
		expect(detail.widgets.length).toBe(dashboard.widgets.length);
	});
});

/* -------------------------------------------------------------- taxonomy --- */

describe("label payloads", () => {
	it("counts tasks per label", () => {
		const rows = labelRows(snapshot);
		expect(rows.length).toBe(snapshot.workspace.labels.length);
		const withTasks = rows.find((r) => r.taskCount > 0);
		expect(withTasks).toBeDefined();
	});
});

/* ---------------------------------------------------------------- people --- */

describe("person payloads", () => {
	it("tallies assigned tasks", () => {
		const rows = personRows(snapshot);
		expect(rows.length).toBe(snapshot.workspace.people.length);
		const alice = rows.find((r) => r.name === "Alice");
		expect(alice?.aliases).toContain("al");
	});
});

/* --------------------------------------------------------------- comments --- */

describe("comment payloads", () => {
	it("flattens a comment to JSON-safe fields", () => {
		const rows = commentRows([
			{
				id: "cmt_1",
				author: "alice",
				date: "2026-01-02",
				body: "See the linked spec.",
				reactions: { "👍": 2 },
				editedAt: null,
				replyTo: null,
			},
		]);
		expect(rows).toEqual([
			{
				id: "cmt_1",
				author: "alice",
				date: "2026-01-02",
				editedAt: null,
				replyTo: null,
				body: "See the linked spec.",
				reactions: { "👍": 2 },
			},
		]);
		expect(commentRows([])).toEqual([]);
	});
});

/* ------------------------------------------------------------------- help -- */

describe("help payloads", () => {
	it("ranks topics for a free-text search", () => {
		const hits = searchHelp("saved views query language");
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]).toHaveProperty("topicId");
		expect(hits[0]).toHaveProperty("title");
	});

	it("returns an empty list for gibberish", () => {
		expect(searchHelp("zzzqqq")).toEqual([]);
	});

	it("fetches a topic's full content", () => {
		const topic = getHelpTopic("views-saved-views");
		expect(topic).not.toBeNull();
		expect(topic!.content.length).toBeGreaterThan(0);
	});

	it("returns null for an unknown topic id", () => {
		expect(getHelpTopic("does-not-exist")).toBeNull();
	});
});