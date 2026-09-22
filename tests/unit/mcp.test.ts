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
	countProjects,
	countTasks,
	dashboardDetail,
	dashboardRow,
	getStats,
	getSummary,
	labelRows,
	pageList,
	personRows,
	projectDetail,
	projectRows,
	readDashboard,
	recurringRows,
	runView,
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
import type { IsoDate, RecurrenceConfig } from "../../src/core/types";

const snapshot = sampleSnapshot();

/* ------------------------------------------------------------------- uris -- */

describe("vault URI grammar", () => {
	const intents: VaultUriIntent[] = [
		{ action: "open-task", path: "Sample Workspace/Tasks/TSK-0001", target: "vf" },
		{ action: "open-task", path: "A/B/C.md note", target: "native" },
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
			action: "open-task",
			path: "Sample Workspace/Projects/Core App Experience",
			target: "vf",
		};
		expect(parseVaultUri(buildVaultUri(intent))).toEqual(intent);
	});

	it("rejects URIs from another scheme", () => {
		expect(parseVaultUri("obsidian://other?open-task=x")).toBeNull();
	});

	it("defaults the open-task target to vf", () => {
		const parsed = parseVaultUri("obsidian://vertex-flow?open-task=Tasks%2FTSK-1");
		expect(parsed).toEqual({
			action: "open-task",
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

	it("rolls top-level progress into the detail", () => {
		const project = snapshot.projects[0];
		const detail = projectDetail(snapshot, project, "");
		expect(detail.project.progress).toHaveProperty("total");
		expect(detail.project.progress.text).toMatch(/^\d+\/\d+$/);
		expect(detail.project.progress.percent).toBeGreaterThanOrEqual(0);
		expect(detail.project.progress.percent).toBeLessThanOrEqual(100);
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

	it("carries comment/relation/archived/completed on every row", () => {
		const rows = taskRows(snapshot, {}, null, true);
		for (const row of rows) {
			expect(typeof row.commentCount).toBe("number");
			expect(typeof row.relationCount).toBe("number");
			expect("archivedAt" in row).toBe(true);
			expect("completedAt" in row).toBe(true);
		}
	});

	it("honours sort:comments descending", () => {
		const seeded = snapshot.tasks.map((t, i) => ({ ...t, commentCount: i }));
		const matched = taskRows(
			{ ...snapshot, tasks: seeded },
			{},
			null,
			true,
			{ sortBy: "comments", sortDirection: "desc" },
		);
		const counts = matched.map((r) => r.commentCount);
		expect(counts).toEqual([...counts].sort((a, b) => b - a));
	});

	it("sorts by subtask count and tables break ties across keys", () => {
		const bySubtasks = taskRows(snapshot, {}, null, true, {
			sortBy: "subtasks",
			sortDirection: "desc",
		});
		const counts = bySubtasks.map((r) => r.subTaskCount);
		expect(counts).toEqual([...counts].sort((a, b) => b - a));

		const multi = taskRows(snapshot, {}, null, true, {
			tableSort: [
				{ field: "priority", direction: "asc" },
				{ field: "comments", direction: "desc" },
			],
		});
		expect(multi.length).toBe(snapshot.tasks.length);
	});

	it("keeps rank order when no sort clause is passed", () => {
		const plain = taskRows(snapshot, {}, null, true);
		const ranked = taskRows(snapshot, {}, null, true, {
			sortBy: "rank",
			sortDirection: "asc",
		});
		expect(plain.map((r) => r.id)).toEqual(ranked.map((r) => r.id));
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
		expect(detail.task.vaultUri).toContain("open-task");
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

	it("reports sub-task progress on the detail", () => {
		const parentPath = snapshot.tasks.find((t) => t.parent)?.parent;
		const parent = snapshot.tasks.find((t) => t.path === parentPath);
		expect(parent).toBeDefined();

		const detail = taskDetail(snapshot, parent!, "", "alice");
		expect(detail.task.subtaskProgress.total).toBeGreaterThan(0);
		expect(detail.task.subtaskProgress).toHaveProperty("text");
		expect(detail.task.subtaskProgress.text).toMatch(/^\d+\/\d+$/);
	});

	it("reports an empty (not zero) rollup for a leaf task", () => {
		const leaf = snapshot.tasks.find(
			(t) => !snapshot.tasks.some((other) => other.parent === t.path),
		);
		const detail = taskDetail(snapshot, leaf!, "", "alice");
		expect(detail.task.subtaskProgress.total).toBe(0);
		expect(detail.task.subtaskProgress.text).toBe("0/0");
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
		expect(hits[0]).toHaveProperty("path");
		expect(hits[0]).toHaveProperty("vaultUri");
		expect(hits[0].vaultUri.startsWith("obsidian://vertex-flow?help=")).toBe(true);
	});

	it("returns an empty list for gibberish", () => {
		expect(searchHelp("zzzqqq")).toEqual([]);
	});

	it("fetches a topic's full content", () => {
		const topic = getHelpTopic("views-saved-views");
		expect(topic).not.toBeNull();
		expect(topic!.content.length).toBeGreaterThan(0);
	});

	it("carries a breadcrumb path and deep-link on the detail", () => {
		const topic = getHelpTopic("views-saved-views");
		expect(topic!.path).toEqual(["Views"]);
		expect(topic!.vaultUri).toContain("help=views-saved-views");

		const nested = getHelpTopic("concepts-tasks-subtasks");
		expect(nested!.path).toEqual(["Concepts", "Tasks"]);
	});

	it("lists anchors for deep-linking to a section", () => {
		const topic = getHelpTopic("views-saved-views");
		expect(topic!.anchors).toContain("query-language");
	});

	it("returns null for an unknown topic id", () => {
		expect(getHelpTopic("does-not-exist")).toBeNull();
	});
});

/* --------------------------------------------------------- count/summary -- */

const FIXTURE_TODAY: IsoDate = "2026-08-26";

const recurrenceRule = (
	partial: Partial<RecurrenceConfig> = {},
): RecurrenceConfig => ({
	trigger: "on-date",
	triggerStatus: null,
	freq: "daily",
	interval: 1,
	weekdays: [],
	dayOfMonth: null,
	weekdayOfMonth: null,
	monthOfYear: null,
	anchor: "dueDate",
	newStatus: null,
	endsAfter: null,
	endsOn: null,
	nextDate: FIXTURE_TODAY,
	copyFields: null,
	...partial,
});

describe("count builders", () => {
	const visible = snapshot.tasks.filter((t) => !t.archived);
	const archived = snapshot.tasks.filter((t) => t.archived);

	it("counts visible tasks and open/archived splits", () => {
		const counts = countTasks(snapshot);
		expect(counts.total).toBe(visible.length);
		expect(counts.archived).toBe(0);
		const statuses = snapshot.workspace.statuses;
		const open = visible.filter((t) => {
			const status = statuses.find((s) => s.id === t.status);
			return status?.category !== "completed" && status?.category !== "canceled";
		});
		expect(counts.open).toBe(open.length);
	});

	it("pulls archived tasks in when asked", () => {
		const counts = countTasks(snapshot, {}, null, true);
		expect(counts.total).toBe(visible.length + archived.length);
		expect(counts.archived).toBe(archived.length);
	});

	it("applies filters before counting", () => {
		const done = visible.filter((t) => t.status === "done").length;
		const counts = countTasks(snapshot, { status: ["done"] });
		expect(counts.total).toBe(done);
	});

	it("breaks counts down by status, assignee, project and label", () => {
		const counts = countTasks(snapshot, {}, null, false, [
			"status",
			"assignee",
			"project",
			"label",
		]);
		expect(counts.byStatus!.reduce((sum, b) => sum + b.count, 0)).toBe(
			counts.total,
		);
		expect(counts.byStatus!.every((b) => !b.isNone && b.name)).toBe(true);
		expect(counts.byAssignee!.find((b) => b.name === "Alice")).toBeTruthy();
		expect(
			counts.byProject!.find((b) => b.name === "Core App Experience"),
		).toBeTruthy();
		// Labels are multi-valued: a task with N labels counts under each, and
		// one with none lands in the `(none)` bucket — so the sum is the number
		// of label assignments plus one per label-less task.
		expect(counts.byLabel!.some((b) => b.isNone)).toBe(true);
		const assignments = snapshot.tasks
			.filter((t) => !t.archived)
			.reduce((sum, t) => sum + Math.max(1, t.labels.length), 0);
		expect(counts.byLabel!.reduce((sum, b) => sum + b.count, 0)).toBe(
			assignments,
		);
	});

	it("counts projects and their status spread", () => {
		const counts = countProjects(snapshot, false, true);
		expect(counts.total).toBe(3);
		expect(counts.archived).toBe(0);
		expect(counts.byStatus!.reduce((sum, b) => sum + b.count, 0)).toBe(3);
	});
});

describe("summary and stats", () => {
	it("summarises tallies for a mid-sprint day", () => {
		const summary = getSummary(snapshot, FIXTURE_TODAY);
		const visible = snapshot.tasks.filter((t) => !t.archived);
		expect(summary.tasks.total).toBe(visible.length);
		expect(summary.tasks.overdue).toBe(0);
		expect(summary.tasks.dueToday).toBe(0);
		expect(summary.tasks.archived).toBe(
			snapshot.tasks.filter((t) => t.archived).length,
		);
		expect(summary.projects.total).toBe(snapshot.projects.length);
		expect(summary.people).toBe(snapshot.workspace.people.length);
		expect(summary.labels).toBe(snapshot.workspace.labels.length);
		expect(summary.views).toBe(snapshot.views.length);
		expect(summary.dashboards).toBe(snapshot.dashboards.length);
		expect(summary.recurring.seriesCount).toBe(0);
	});

	it("flags overdue and due-today against a later date", () => {
		const day = "2026-09-05";
		const categories = new Map(
			snapshot.workspace.statuses.map((s) => [s.id, s.category]),
		);
		let overdue = 0;
		let dueToday = 0;
		for (const t of snapshot.tasks) {
			if (t.archived) continue;
			const category = categories.get(t.status ?? "");
			if (category === "completed" || category === "canceled") continue;
			if (t.dueDate && t.dueDate < day) overdue++;
			if (t.dueDate === day) dueToday++;
		}
		const summary = getSummary(snapshot, day);
		expect(summary.tasks.overdue).toBe(overdue);
		expect(summary.tasks.dueToday).toBe(dueToday);
		expect(summary.tasks.overdue).toBeGreaterThan(0);
		expect(summary.tasks.dueToday).toBeGreaterThan(0);
	});

	it("computes stats with a comment tally injected", () => {
		const stats = getStats(snapshot, FIXTURE_TODAY, {
			alice: 4,
			bob: 2,
		});
		expect(stats.comments.total).toBe(6);
		expect(stats.comments.perAuthor[0]).toMatchObject({
			id: "alice",
			name: "Alice",
			count: 4,
		});
		expect(stats.tasks.estimated).toBeGreaterThan(0);
		expect(stats.tasks.estimateAvg).toBeCloseTo(
			stats.tasks.estimateSum / stats.tasks.estimated,
		);
		expect(stats.subtaskProgress.percent).toBeGreaterThanOrEqual(0);
		expect(stats.subtaskProgress.percent).toBeLessThanOrEqual(100);
	});

	it("ranks the most-commented tasks", () => {
		const seeded = snapshot.tasks.map((t, i) => ({ ...t, commentCount: i }));
		const stats = getStats(
			{ ...snapshot, tasks: seeded },
			FIXTURE_TODAY,
			{},
		);
		const top = stats.tasks.mostCommented;
		expect(top.length).toBeGreaterThan(0);
		expect(top[0].commentCount).toBeGreaterThanOrEqual(
			top[top.length - 1].commentCount,
		);
	});
});

/* -------------------------------------------------------------- recurring -- */

describe("recurring payloads", () => {
	it("reports an empty list for a workspace with no recurring tasks", () => {
		const list = recurringRows(snapshot, FIXTURE_TODAY);
		expect(list.seriesCount).toBe(0);
		expect(list.results).toEqual([]);
	});

	it("describes one live on-date series", () => {
		const seeded = {
			...snapshot,
			tasks: snapshot.tasks.map((t, i) =>
				i === 0
					? { ...t, recurrence: recurrenceRule({ freq: "weekly", nextDate: "2026-08-30" }) }
					: t,
			),
		};
		const list = recurringRows(seeded, FIXTURE_TODAY);
		expect(list.seriesCount).toBe(1);
		expect(list.results[0]).toMatchObject({
			trigger: "on-date",
			frequency: "weekly",
			interval: 1,
			nextDate: "2026-08-30",
		});
		expect(list.results[0].summary).toContain("Every week");
		expect(list.results[0].vaultUri).toBe(
			buildVaultUri({
				action: "open-task",
				path: list.results[0].path,
				target: "vf",
			}),
		);
	});

	it("projects ghosts through taskRows when recurringPreview and today are set", () => {
		const seeded = {
			...snapshot,
			tasks: snapshot.tasks.map((t, i) =>
				i === 0
					? { ...t, recurrence: recurrenceRule({ freq: "weekly", nextDate: "2026-08-30" }) }
					: t,
			),
		};
		const plain = taskRows(seeded, {}, null, false);
		expect(plain.some((r) => r.path.endsWith("/occ/1"))).toBe(false);

		const projected = taskRows(seeded, {}, null, false, {
			recurringPreview: true,
			today: FIXTURE_TODAY,
		});
		const ghost = projected.find((r) => r.path.endsWith("/occ/1"));
		expect(ghost).toBeTruthy();
	});
});

/* --------------------------------------------------------------- run_view -- */

describe("run_view", () => {
	it("evaluates a saved view with the plugin's engine", () => {
		const view = snapshot.views.find((v) => v.id === "sprint-board")!;
		const result = runView(snapshot, view);
		const visible = snapshot.tasks.filter((t) => !t.archived).length;
		expect(result.viewId).toBe("sprint-board");
		expect(result.viewType).toBe("board");
		expect(result.total).toBe(visible);
		expect(result.filteredOut).toBe(
			snapshot.tasks.length - visible,
		);
		expect(result.results).toHaveLength(visible);
		expect(result.truncated).toBe(false);
	});

	it("returns board columns when grouping is requested", () => {
		const view = snapshot.views.find((v) => v.id === "sprint-board")!;
		const result = runView(snapshot, view, null, undefined, true);
		expect(result.groups!.length).toBeGreaterThan(0);
		const allRows = result.groups!.reduce(
			(sum, g) => sum + g.results.length,
			0,
		);
		expect(allRows).toBe(result.total);
	});

	it("caps rows and reports truncation", () => {
		const view = snapshot.views.find((v) => v.id === "sprint-board")!;
		// Cycle non-archived fixtures into a workspace well past the list cap.
		const base = snapshot.tasks.filter((t) => !t.archived);
		const padded = {
			...snapshot,
			tasks: Array.from(
				{ length: MCP_MAX_RESULTS + 10 },
				(_, i): typeof snapshot.tasks[number] => ({
					...base[i % base.length],
					id: `SMP-${9000 + i}`,
					path: `Sample/Tasks/SMP-${9000 + i}`,
				}),
			),
		};
		const result = runView(padded, view);
		expect(result.results).toHaveLength(MCP_MAX_RESULTS);
		expect(result.truncated).toBe(true);
		expect(result.total).toBe(padded.tasks.length);
	});
});

/* ------------------------------------------------------------- dashboards -- */

describe("read_dashboard", () => {
	it("computes widget data over the dashboard-wide filter", () => {
		const dashboard = snapshot.dashboards[0];
		const data = readDashboard(snapshot, dashboard);
		expect(data.dashboard.id).toBe("sprint-overview");
		expect(data.total).toBe(
			snapshot.tasks.filter((t) => !t.archived).length,
		);
		expect(data.widgets).toHaveLength(3);
		for (const widget of data.widgets) {
			expect(widget.data).toBeDefined();
		}
		const bar = data.widgets.find((w) => w.chartType === "bar")!;
		expect(bar.title).toBe("Tasks by Status");
	});
});