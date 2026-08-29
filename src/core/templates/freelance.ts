/**
 * Freelance / client work — one Project per client engagement, Tasks are the
 * deliverables. Single assignee throughout: you.
 *
 * The example content is a full feature showcase: three client engagements,
 * two deliverables broken into sub-tasks, a blocked dependency, un-parented
 * business-admin tasks, archived (delivered and cancelled) work, every label
 * used more than once, and a seeded dashboard.
 */

import { DEFAULT_PRIORITIES, DEFAULT_TASK_TYPES } from "../taxonomy/defaults";
import type { Comment, LabelValue, Person, StatusValue } from "../types";
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
	{ id: "not-started", name: "Not Started", color: "#94a3b8", category: "backlog", order: 1 },
	{ id: "todo", name: "Todo", color: "#60a5fa", category: "unstarted", order: 2 },
	{ id: "in-progress", name: "In Progress", color: "#fbbf24", category: "started", order: 3 },
	{ id: "waiting-on-client", name: "Waiting on Client", color: "#a855f7", category: "started", order: 4 },
	{ id: "delivered", name: "Delivered", color: "#34d399", category: "completed", order: 5 },
	{ id: "cancelled", name: "Cancelled", color: "#f87171", category: "canceled", order: 6 },
];

const labels: LabelValue[] = [
	{ id: "design", name: "Design", color: "#a855f7" },
	{ id: "development", name: "Development", color: "#3b82f6" },
	{ id: "strategy", name: "Strategy", color: "#14b8a6" },
	{ id: "rush", name: "Rush", color: "#ef4444" },
];

const people: Person[] = [{ id: "me", name: "Me", aliases: [], isSelf: true }];

const byClient = makeView("by-client", "By Client", {
	icon: "folder",
	viewType: "list",
	groupBy: "project",
});

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const acme = makeProject(ctx, "Acme Co. — Website Redesign", {
		status: "in-progress",
		createdAt: ctx.iso(-30),
	});
	const beta = makeProject(ctx, "Beta LLC — Brand Refresh", {
		status: "waiting-on-client",
		createdAt: ctx.iso(-24),
	});
	const cirrus = makeProject(ctx, "Cirrus Studios — Marketing Site", {
		status: "in-progress",
		createdAt: ctx.iso(-16),
	});

	const rank = rankSeq(25);
	const T = (n: number) => ctx.taskPath(n);
	const mine = { assignee: "me" as string | null };

	const tasks = [
		// --- Acme: hierarchy #1 on the responsive build (~67% done) + a
		//     blocked dependency.
		makeTask(ctx, 1, rank, {
			...mine,
			title: "Wireframe the new homepage",
			taskType: "feature",
			status: "delivered",
			priority: "high",
			project: acme.path,
			labels: ["design"],
			dueDate: ctx.day(-6),
			createdAt: ctx.iso(-26),
		}),
		makeTask(ctx, 2, rank, {
			...mine,
			title: "Build the responsive layout",
			taskType: "feature",
			status: "in-progress",
			priority: "high",
			project: acme.path,
			labels: ["development"],
			startDate: ctx.day(-8),
			dueDate: ctx.day(4),
			createdAt: ctx.iso(-22),
			relations: { blocks: [T(6)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 3, rank, {
			...mine,
			title: "Homepage template",
			taskType: "feature",
			status: "delivered",
			priority: "high",
			project: acme.path,
			parent: T(2),
			labels: ["development"],
			createdAt: ctx.iso(-21),
		}),
		makeTask(ctx, 4, rank, {
			...mine,
			title: "About and team pages",
			taskType: "feature",
			status: "delivered",
			priority: "medium",
			project: acme.path,
			parent: T(2),
			labels: ["development"],
			createdAt: ctx.iso(-17),
		}),
		makeTask(ctx, 5, rank, {
			...mine,
			title: "Contact page with the enquiry form",
			taskType: "feature",
			status: "in-progress",
			priority: "medium",
			project: acme.path,
			parent: T(2),
			labels: ["development"],
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 6, rank, {
			...mine,
			title: "Migrate the blog content",
			taskType: "chore",
			status: "todo",
			priority: "medium",
			project: acme.path,
			labels: ["development"],
			dueDate: ctx.day(9),
			createdAt: ctx.iso(-10),
			relations: { blocks: [], blockedBy: [T(2)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 7, rank, {
			...mine,
			title: "Get sign-off on the homepage copy",
			taskType: "chore",
			status: "waiting-on-client",
			priority: "medium",
			project: acme.path,
			labels: ["strategy"],
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 8, rank, {
			...mine,
			title: "Fix layout shift on the pricing page",
			taskType: "bug",
			status: "delivered",
			priority: "high",
			project: acme.path,
			labels: ["development"],
			archived: true,
			archivedAt: ctx.iso(-5),
			createdAt: ctx.iso(-14),
		}),

		// --- Beta: hierarchy #2 on the brand guidelines (~33% done).
		makeTask(ctx, 9, rank, {
			...mine,
			title: "Present three logo directions",
			taskType: "feature",
			status: "delivered",
			priority: "high",
			project: beta.path,
			labels: ["design", "strategy"],
			dueDate: ctx.day(-2),
			createdAt: ctx.iso(-20),
		}),
		makeTask(ctx, 10, rank, {
			...mine,
			title: "Revise the chosen direction",
			taskType: "feature",
			status: "waiting-on-client",
			priority: "high",
			project: beta.path,
			labels: ["design"],
			createdAt: ctx.iso(-15),
		}),
		makeTask(ctx, 11, rank, {
			...mine,
			title: "Produce the brand guidelines PDF",
			taskType: "feature",
			status: "in-progress",
			priority: "medium",
			project: beta.path,
			labels: ["design"],
			startDate: ctx.day(-4),
			dueDate: ctx.day(14),
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 12, rank, {
			...mine,
			title: "Typography and colour section",
			taskType: "feature",
			status: "delivered",
			priority: "medium",
			project: beta.path,
			parent: T(11),
			labels: ["design"],
			createdAt: ctx.iso(-11),
		}),
		makeTask(ctx, 13, rank, {
			...mine,
			title: "Logo usage and clear-space rules",
			taskType: "feature",
			status: "in-progress",
			priority: "medium",
			project: beta.path,
			parent: T(11),
			labels: ["design"],
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 14, rank, {
			...mine,
			title: "Voice and tone guidelines",
			taskType: "feature",
			status: "not-started",
			priority: "low",
			project: beta.path,
			parent: T(11),
			labels: ["strategy"],
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 15, rank, {
			...mine,
			title: "Social avatars for launch",
			taskType: "feature",
			status: "todo",
			priority: "urgent",
			project: beta.path,
			labels: ["design", "rush"],
			dueDate: ctx.day(2),
			createdAt: ctx.iso(-4),
		}),
		makeTask(ctx, 16, rank, {
			...mine,
			title: "Animated logo reveal",
			taskType: "feature",
			status: "cancelled",
			priority: "low",
			project: beta.path,
			labels: ["design"],
			archived: true,
			archivedAt: ctx.iso(-3),
			createdAt: ctx.iso(-9),
		}),

		// --- Cirrus Studios.
		makeTask(ctx, 17, rank, {
			...mine,
			title: "Content strategy workshop",
			taskType: "chore",
			status: "delivered",
			priority: "medium",
			project: cirrus.path,
			labels: ["strategy"],
			dueDate: ctx.day(-4),
			archived: true,
			archivedAt: ctx.iso(-6),
			createdAt: ctx.iso(-15),
		}),
		makeTask(ctx, 18, rank, {
			...mine,
			title: "Design the landing page",
			taskType: "feature",
			status: "in-progress",
			priority: "high",
			project: cirrus.path,
			labels: ["design"],
			startDate: ctx.day(-3),
			dueDate: ctx.day(6),
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 19, rank, {
			...mine,
			title: "Build the landing page",
			taskType: "feature",
			status: "not-started",
			priority: "high",
			project: cirrus.path,
			labels: ["development"],
			dueDate: ctx.day(13),
			createdAt: ctx.iso(-7),
		}),
		makeTask(ctx, 20, rank, {
			...mine,
			title: "Rush: hero image for the investor deck",
			taskType: "feature",
			status: "todo",
			priority: "urgent",
			project: cirrus.path,
			labels: ["design", "rush"],
			dueDate: ctx.day(1),
			createdAt: ctx.iso(-3),
		}),
		makeTask(ctx, 21, rank, {
			...mine,
			title: "Fix the mobile nav not closing on tap",
			taskType: "bug",
			status: "todo",
			priority: "medium",
			project: cirrus.path,
			labels: ["development"],
			createdAt: ctx.iso(-5),
		}),
		makeTask(ctx, 22, rank, {
			...mine,
			title: "Second-round feedback on the wireframes",
			taskType: "chore",
			status: "waiting-on-client",
			priority: "medium",
			project: cirrus.path,
			labels: ["strategy"],
			createdAt: ctx.iso(-4),
		}),

		// --- Business admin, not billed to any client.
		makeTask(ctx, 23, rank, {
			...mine,
			title: "Send the Q3 invoices",
			taskType: "chore",
			status: "todo",
			priority: "high",
			dueDate: ctx.day(3),
			createdAt: ctx.iso(-2),
		}),
		makeTask(ctx, 24, rank, {
			...mine,
			title: "Refresh the portfolio site with recent work",
			taskType: "chore",
			status: "not-started",
			priority: "low",
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 25, rank, {
			...mine,
			title: "Renew the business registration",
			taskType: "chore",
			status: "todo",
			priority: "medium",
			dueDate: ctx.day(20),
			createdAt: ctx.iso(-1),
		}),
	];

	const comments = new Map<string, Comment[]>([
		[
			T(7),
			[
				{
					id: "cmt_01",
					author: "me",
					date: ctx.iso(-2),
					body: "Chased twice. If there's no copy by Friday I'll ship with the placeholder and swap it post-launch.",
					reactions: {},
				},
			],
		],
	]);

	const descriptions = new Map<string, string>([
		[
			T(11),
			"## Description\nThe deliverable: a PDF covering typography, colour, logo usage, and voice. Each section is a sub-task so progress is visible while the client reviews the logo.\n",
		],
	]);

	const dashboard = makeDashboard(
		"studio-overview",
		"Studio Overview",
		[
			makeWidget(
				"w-waiting",
				"kpi",
				"Waiting on a client",
				{ chartType: "kpi", metric: "count", scope: { field: "status", value: "waiting-on-client" } },
				{ x: 0, y: 0, w: 3, h: 3 },
			),
			makeWidget(
				"w-status",
				"bar",
				"Deliverables by Status",
				{ chartType: "bar", groupBy: "status" },
				{ x: 3, y: 0, w: 9, h: 4 },
			),
			makeWidget(
				"w-client",
				"pie",
				"Work by Client",
				{ chartType: "pie", groupBy: "project" },
				{ x: 0, y: 4, w: 6, h: 4 },
			),
		],
		"briefcase",
	);

	return {
		projects: [acme, beta, cirrus],
		tasks,
		comments,
		descriptions,
		dashboards: [dashboard],
	};
}

export const freelanceTemplate: WorkspaceTemplate = {
	id: "freelance",
	name: "Freelance & Client Work",
	description:
		"One Project per client engagement, deliverables as Tasks, with a status for work that's parked waiting on the client.",
	icon: "briefcase",
	defaultIdPrefix: "JOB",
	workspace: { statuses, labels, people },
	views: [byClient],
	settings: [
		settingsFromValues("Statuses", statuses),
		settingsFromValues("Priorities", DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", DEFAULT_TASK_TYPES),
		settingsFromValues("Labels", labels),
		plainSetting("Default view", "By Client (List, grouped by Project)"),
	],
	buildExampleContent,
};
