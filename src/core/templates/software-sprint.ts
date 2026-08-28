/**
 * Software sprint — the Project is the sprint container, tasks are the work.
 *
 * Deliberately ships two `started` statuses ("In Progress" and "In Review") to
 * demonstrate that a status's category drives logic while its name is free —
 * category ≠ name (§5.1).
 *
 * This template is also the fixture the core unit tests build on
 * (`sampleSnapshot()` in `instantiate.ts`), so its example content — project
 * titles, task ids, relations, comments — is load-bearing. Change it
 * deliberately.
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
import { makeProject, makeTask, makeView, rankSeq } from "./helpers";
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
		// Deliberately still in the backlog while its tasks move — status and
		// progress never auto-sync (§7.1).
		status: "backlog",
		createdAt: ctx.iso(-30),
		updatedAt: ctx.iso(-5),
		path: joinPath(ctx.root, "Projects", "App Store Launch"),
	});

	const rank = rankSeq(9);
	const T = (n: number) => ctx.taskPath(n);

	const tasks = [
		// A parent task with sub-tasks → demonstrates the progress bar (§7.2).
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
		}),
		makeTask(ctx, 103, rank, {
			title: "Wire up account creation",
			taskType: "feature",
			// In review, not just in progress — the two `started` statuses in one
			// column set is the whole point of this template.
			status: "in-review",
			priority: "high",
			project: core.path,
			parent: T(101),
			assignee: "bob",
			labels: ["frontend"],
		}),

		// The blocked/blocking pair → demonstrates relations (§7.3).
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
		}),
		makeTask(ctx, 107, rank, {
			title: "Capture screenshots for the store listing",
			taskType: "chore",
			status: "backlog",
			priority: "low",
			project: launch.path,
			labels: ["docs", "design"],
		}),
		makeTask(ctx, 108, rank, {
			title: "Agree the launch date with the whole team",
			taskType: "chore",
			status: "todo",
			priority: "urgent",
			project: launch.path,
			assignee: "alice",
		}),

		// No parent at all, and archived → demonstrates both (§2, §7.7).
		makeTask(ctx, 109, rank, {
			title: "Spike: evaluate offline sync options",
			taskType: "chore",
			status: "canceled",
			priority: "low",
			archived: true,
			archivedAt: ctx.iso(-3),
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
	]);

	return {
		workspace: { people },
		projects: [core, launch],
		tasks,
		comments,
		descriptions,
	};
}

export const softwareSprintTemplate: WorkspaceTemplate = {
	id: "software-sprint",
	name: "Software Sprint",
	description:
		"A sprint per Project, issues as Tasks. Board-first, with a separate In Review status alongside In Progress.",
	icon: "kanban",
	defaultIdPrefix: "SPR",
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
