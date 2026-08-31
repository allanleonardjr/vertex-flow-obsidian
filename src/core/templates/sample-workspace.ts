/**
 * Sample workspace — the fixed fixture the core unit test suite is built on
 * (`sampleSnapshot()` in `instantiate.ts`). Its content — project titles, task
 * ids, relations, comments — is load-bearing across `hierarchy.test.ts`,
 * `views.test.ts`, `taxonomy.test.ts`, and three tests in `templates.test.ts`.
 * Change it deliberately and update those tests alongside.
 *
 * This is a deliberate copy of the (still separately maintained, not-yet-
 * converted) `software-sprint.ts` gallery-candidate template, frozen here so
 * the two can evolve independently. Do NOT import this from `templates/index.ts`
 * or add it to `WORKSPACE_TEMPLATES` — it is test-only.
 */

import { joinPath } from "../links";
import { DEFAULT_PRIORITIES } from "../taxonomy/defaults";
import type {
	Comment,
	LabelValue,
	Person,
	StatusValue,
	TaskTypeValue,
} from "../types";
import {
	makeDashboard,
	makeProject,
	makeTask,
	makeView,
	makeWidget,
	rankSeq,
} from "./helpers";
import {
	plainSetting,
	settingsFromValues,
	type TemplateBuildContext,
	type TemplateContent,
	type WorkspaceTemplate,
} from "./types";

const statuses: StatusValue[] = [
	{ id: "backlog", name: "Backlog", color: "#94a3b8", category: "backlog", order: 1 },
	{ id: "todo", name: "Todo", color: "#60a5fa", category: "unstarted", order: 2 },
	{ id: "in-progress", name: "In Progress", color: "#fbbf24", category: "started", order: 3 },
	{ id: "in-review", name: "In Review", color: "#f59e0b", category: "started", order: 4 },
	{ id: "done", name: "Done", color: "#34d399", category: "completed", order: 5 },
	{ id: "canceled", name: "Canceled", color: "#f87171", category: "canceled", order: 6 },
];

const taskTypes: TaskTypeValue[] = [
	{ id: "bug", name: "Bug", color: "#ef4444" },
	{ id: "feature", name: "Feature", color: "#3b82f6" },
	{ id: "chore", name: "Chore", color: "#94a3b8" },
	{ id: "tech-debt", name: "Tech Debt", color: "#f97316" },
];

const labels: LabelValue[] = [
	{ id: "frontend", name: "Frontend", color: "#06b6d4" },
	{ id: "backend", name: "Backend", color: "#6366f1" },
	{ id: "performance", name: "Performance", color: "#f97316" },
	{ id: "design", name: "Design", color: "#a855f7" },
	{ id: "docs", name: "Docs", color: "#14b8a6" },
];

const people: Person[] = [
	{ id: "alice", name: "Alice", aliases: ["al"], isSelf: true },
	{ id: "bob", name: "Bob", aliases: [], isSelf: false },
];

const sprintBoard = makeView("sprint-board", "Sprint Board", {
	icon: "kanban",
	viewType: "board",
	groupBy: "status",
});

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const core = makeProject(ctx, "Core App Experience", {
		status: "in-progress",
		createdAt: ctx.iso(-38),
	});
	const launch = makeProject(ctx, "App Store Launch & Marketing", {
		status: "backlog",
		createdAt: ctx.iso(-30),
		updatedAt: ctx.iso(-5),
		path: joinPath(ctx.root, "Projects", "App Store Launch"),
	});
	const platform = makeProject(ctx, "Developer Platform", {
		status: "todo",
		createdAt: ctx.iso(-22),
		updatedAt: ctx.iso(-2),
	});

	const rank = rankSeq(25);
	const T = (n: number) => ctx.taskPath(n);

	const tasks = [
		makeTask(ctx, 101, rank, {
			title: "Rebuild the onboarding flow",
			taskType: "feature",
			status: "in-progress",
			priority: "high",
			project: core.path,
			assignee: "alice",
			estimate: 5,
			labels: ["design"],
			startDate: ctx.day(-5),
			dueDate: ctx.day(4),
			createdAt: ctx.iso(-36),
		}),
		makeTask(ctx, 102, rank, {
			title: "Design the welcome screen",
			taskType: "feature",
			status: "done",
			priority: "medium",
			project: core.path,
			parent: T(101),
			assignee: "alice",
			labels: ["design"],
			createdAt: ctx.iso(-34),
		}),
		makeTask(ctx, 103, rank, {
			title: "Wire up account creation",
			taskType: "feature",
			status: "in-review",
			priority: "high",
			project: core.path,
			parent: T(101),
			assignee: "bob",
			labels: ["frontend"],
			createdAt: ctx.iso(-30),
		}),
		makeTask(ctx, 104, rank, {
			title: "Fix LexoRank calculation when moving tasks into empty columns",
			taskType: "bug",
			status: "in-progress",
			priority: "urgent",
			project: core.path,
			assignee: "alice",
			estimate: 3,
			labels: ["performance", "backend"],
			dueDate: ctx.day(2),
			createdAt: ctx.iso(-24),
			relations: { blocks: [], blockedBy: [T(105)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 105, rank, {
			title: "Add regression tests for the ranking engine",
			taskType: "tech-debt",
			status: "todo",
			priority: "high",
			project: core.path,
			assignee: "bob",
			labels: ["backend"],
			createdAt: ctx.iso(-22),
			relations: { blocks: [T(104)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 106, rank, {
			title: "Draft App Store listing copy",
			taskType: "chore",
			status: "todo",
			priority: "medium",
			project: launch.path,
			assignee: "alice",
			labels: ["docs"],
			dueDate: ctx.day(10),
			createdAt: ctx.iso(-20),
		}),
		makeTask(ctx, 107, rank, {
			title: "Capture screenshots for the store listing",
			taskType: "chore",
			status: "backlog",
			priority: "low",
			project: launch.path,
			labels: ["docs", "design"],
			createdAt: ctx.iso(-19),
		}),
		makeTask(ctx, 108, rank, {
			title: "Agree the launch date with the whole team",
			taskType: "chore",
			status: "todo",
			priority: "urgent",
			project: launch.path,
			assignee: "alice",
			createdAt: ctx.iso(-18),
		}),
		makeTask(ctx, 109, rank, {
			title: "Spike: evaluate offline sync options",
			taskType: "chore",
			status: "canceled",
			priority: "low",
			archived: true,
			archivedAt: ctx.iso(-3),
			createdAt: ctx.iso(-40),
		}),
		makeTask(ctx, 110, rank, {
			title: "Build the public REST API v1",
			taskType: "feature",
			status: "in-progress",
			priority: "high",
			project: platform.path,
			assignee: "bob",
			estimate: 8,
			labels: ["backend"],
			startDate: ctx.day(-8),
			dueDate: ctx.day(14),
			createdAt: ctx.iso(-21),
		}),
		makeTask(ctx, 111, rank, {
			title: "Design the API resource schema",
			taskType: "feature",
			status: "done",
			priority: "medium",
			project: platform.path,
			parent: T(110),
			assignee: "bob",
			labels: ["backend"],
			createdAt: ctx.iso(-20),
		}),
		makeTask(ctx, 112, rank, {
			title: "Implement token auth middleware",
			taskType: "feature",
			status: "done",
			priority: "high",
			project: platform.path,
			parent: T(110),
			assignee: "bob",
			estimate: 3,
			labels: ["backend", "performance"],
			createdAt: ctx.iso(-17),
		}),
		makeTask(ctx, 113, rank, {
			title: "Write the API reference docs",
			taskType: "chore",
			status: "done",
			priority: "medium",
			project: platform.path,
			parent: T(110),
			assignee: "alice",
			labels: ["docs"],
			createdAt: ctx.iso(-13),
		}),
		makeTask(ctx, 114, rank, {
			title: "Add cursor pagination to list endpoints",
			taskType: "feature",
			status: "todo",
			priority: "medium",
			project: platform.path,
			assignee: "bob",
			estimate: 2,
			labels: ["backend"],
			startDate: ctx.day(-2),
			dueDate: ctx.day(18),
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 115, rank, {
			title: "Rate-limit the public API gateway",
			taskType: "chore",
			status: "todo",
			priority: "high",
			project: platform.path,
			assignee: "bob",
			labels: ["backend", "performance"],
			dueDate: ctx.day(8),
			createdAt: ctx.iso(-11),
		}),
		makeTask(ctx, 116, rank, {
			title: "Build the API playground page",
			taskType: "feature",
			status: "todo",
			priority: "low",
			project: platform.path,
			assignee: "alice",
			labels: ["frontend", "design"],
			startDate: ctx.day(-4),
			dueDate: ctx.day(9),
			createdAt: ctx.iso(-10),
			relations: { blocks: [T(117)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 117, rank, {
			title: "Ship the developer portal landing page",
			taskType: "feature",
			status: "in-review",
			priority: "medium",
			project: platform.path,
			assignee: "alice",
			labels: ["frontend", "design"],
			startDate: ctx.day(-3),
			dueDate: ctx.day(6),
			createdAt: ctx.iso(-9),
			relations: { blocks: [], blockedBy: [T(116)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 118, rank, {
			title: "Fix flaky auth integration test",
			taskType: "bug",
			status: "in-review",
			priority: "medium",
			project: platform.path,
			assignee: "bob",
			labels: ["backend"],
			dueDate: ctx.day(5),
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 119, rank, {
			title: "Investigate slow cold-start on the API server",
			taskType: "bug",
			status: "in-progress",
			priority: "high",
			project: platform.path,
			assignee: "alice",
			labels: ["performance", "backend"],
			startDate: ctx.day(-1),
			dueDate: ctx.day(3),
			createdAt: ctx.iso(-7),
		}),
		makeTask(ctx, 120, rank, {
			title: "Set up API uptime monitoring",
			taskType: "chore",
			status: "done",
			priority: "medium",
			project: platform.path,
			assignee: "bob",
			labels: ["backend"],
			archived: true,
			archivedAt: ctx.iso(-4),
			createdAt: ctx.iso(-15),
		}),
		makeTask(ctx, 121, rank, {
			title: "Prototype a GraphQL gateway",
			taskType: "feature",
			status: "canceled",
			priority: "low",
			project: platform.path,
			labels: ["backend"],
			archived: true,
			archivedAt: ctx.iso(-6),
			createdAt: ctx.iso(-16),
		}),
		makeTask(ctx, 122, rank, {
			title: "Prepare the press kit and media assets",
			taskType: "chore",
			status: "todo",
			priority: "low",
			project: launch.path,
			assignee: "alice",
			labels: ["design", "docs"],
			dueDate: ctx.day(11),
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 123, rank, {
			title: "Set up App Store Connect and TestFlight",
			taskType: "chore",
			status: "in-progress",
			priority: "high",
			project: launch.path,
			assignee: "alice",
			labels: ["docs"],
			startDate: ctx.day(-2),
			dueDate: ctx.day(8),
			createdAt: ctx.iso(-5),
		}),
		makeTask(ctx, 124, rank, {
			title: "Clean up unused feature flags",
			taskType: "tech-debt",
			status: "todo",
			priority: "low",
			assignee: "bob",
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 125, rank, {
			title: "Upgrade the CI runner image",
			taskType: "chore",
			status: "done",
			priority: "medium",
			assignee: "alice",
			createdAt: ctx.iso(-4),
		}),
	];

	const comments = new Map<string, Comment[]>([
		[
			T(104),
			[
				{
					id: "cmt_01",
					author: "alice",
					date: ctx.iso(-1),
					body: "Traced this to the boundary check: we need a fallback when `prevRank` and `nextRank` are both undefined.",
					reactions: { "👍": 2, "🚀": 1 },
				},
				{
					id: "cmt_02",
					author: "bob",
					date: ctx.iso(-1),
					body: "@alice I can take the fix. Ship it now or push to the next release?",
					reactions: { "❤️": 1 },
				},
			],
		],
		[
			T(101),
			[
				{
					id: "cmt_01",
					author: "bob",
					date: ctx.iso(-2),
					body: "@alice the welcome screen is done — account creation is the last piece.",
					reactions: {},
				},
			],
		],
		[
			T(110),
			[
				{
					id: "cmt_01",
					author: "alice",
					date: ctx.iso(-3),
					body: "Schema and auth are merged — nice work. @bob can you pick up pagination next, then this moves to review?",
					reactions: { "👍": 1 },
				},
			],
		],
		[
			T(119),
			[
				{
					id: "cmt_01",
					author: "alice",
					date: ctx.iso(-1),
					body: "Profiler points at the ORM warming its connection pool lazily. @bob does eager-init break anything on your side?",
					reactions: {},
				},
			],
		],
	]);

	const descriptions = new Map<string, string>([
		[
			T(104),
			"## Description\nDragging a task into an empty column fails to evaluate neighbouring ranks.\n\n### Steps to Reproduce\n1. Create a fresh column with 0 tasks.\n2. Drag a task into the empty column.\n3. Observe the console error.\n",
		],
		[
			T(101),
			"## Description\nThe current onboarding drops people straight into an empty vault with no explanation.\n",
		],
		[
			T(110),
			"## Description\nA read/write REST API covering tasks, projects and workspaces, with token auth and cursor pagination. v1 is the surface the developer portal documents.\n",
		],
		[
			T(117),
			"## Description\nMarketing-owned landing page for the developer portal. Embeds the interactive playground, so it can't ship until that page is built.\n",
		],
	]);

	const dashboard = makeDashboard(
		"sprint-overview",
		"Sprint Overview",
		[
			makeWidget(
				"w-status",
				"bar",
				"Tasks by Status",
				{ chartType: "bar", groupBy: "status" },
				{ x: 0, y: 0, w: 6, h: 4 },
			),
			makeWidget(
				"w-assignee",
				"pie",
				"Tasks by Assignee",
				{ chartType: "pie", groupBy: "assignee" },
				{ x: 6, y: 0, w: 6, h: 4 },
			),
			makeWidget(
				"w-created",
				"timeline",
				"Tasks Created Over Time",
				{
					chartType: "timeline",
					xField: "createdAt",
					bucket: "week",
					groupBy: null,
				},
				{ x: 0, y: 4, w: 12, h: 4 },
			),
		],
		"gauge",
	);

	return {
		workspace: { people },
		projects: [core, launch, platform],
		tasks,
		comments,
		descriptions,
		dashboards: [dashboard],
	};
}

export const sampleWorkspaceTemplate: WorkspaceTemplate = {
	id: "sample-workspace",
	name: "Sample Workspace",
	description: "Frozen fixture backing sampleSnapshot() and the unit test suite. Not a gallery template — do not register this in templates/index.ts.",
	icon: "kanban",
	defaultIdPrefix: "SMP",
	workspace: { statuses, taskTypes, labels },
	views: [sprintBoard],
	settings: [
		settingsFromValues("Statuses", statuses),
		settingsFromValues("Priorities", DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", taskTypes),
		settingsFromValues("Labels", labels),
		plainSetting("Default view", "Board (grouped by Status)"),
	],
	buildExampleContent,
};
