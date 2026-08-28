/**
 * Freelance / client work — one Project per client engagement, Tasks are the
 * deliverables. Single assignee throughout: you.
 */

import { DEFAULT_PRIORITIES, DEFAULT_TASK_TYPES } from "../taxonomy/defaults";
import type { LabelValue, Person, StatusValue } from "../types";
import { makeProject, makeTask, makeView, rankSeq } from "./helpers";
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
	});
	const beta = makeProject(ctx, "Beta LLC — Brand Refresh", {
		status: "waiting-on-client",
	});

	const rank = rankSeq(8);
	const mine = { assignee: "me" as string | null };
	const tasks = [
		makeTask(ctx, 1, rank, {
			...mine,
			title: "Wireframe the new homepage",
			status: "delivered",
			priority: "high",
			project: acme.path,
			labels: ["design"],
			dueDate: ctx.day(-6),
		}),
		makeTask(ctx, 2, rank, {
			...mine,
			title: "Build the responsive layout",
			status: "in-progress",
			priority: "high",
			project: acme.path,
			labels: ["development"],
			dueDate: ctx.day(4),
		}),
		makeTask(ctx, 3, rank, {
			...mine,
			title: "Migrate blog content",
			status: "todo",
			priority: "medium",
			project: acme.path,
			labels: ["development"],
			dueDate: ctx.day(9),
		}),
		makeTask(ctx, 4, rank, {
			...mine,
			title: "Get sign-off on copy",
			status: "waiting-on-client",
			priority: "medium",
			project: acme.path,
		}),
		makeTask(ctx, 5, rank, {
			...mine,
			title: "Present three logo directions",
			status: "delivered",
			priority: "high",
			project: beta.path,
			labels: ["design", "strategy"],
			dueDate: ctx.day(-2),
		}),
		makeTask(ctx, 6, rank, {
			...mine,
			title: "Revise chosen direction",
			status: "waiting-on-client",
			priority: "high",
			project: beta.path,
			labels: ["design"],
		}),
		makeTask(ctx, 7, rank, {
			...mine,
			title: "Produce the brand guidelines PDF",
			status: "not-started",
			priority: "medium",
			project: beta.path,
			labels: ["design"],
			dueDate: ctx.day(14),
		}),
		makeTask(ctx, 8, rank, {
			...mine,
			title: "Rush: social avatars for launch",
			status: "todo",
			priority: "urgent",
			project: beta.path,
			labels: ["design", "rush"],
			dueDate: ctx.day(2),
		}),
	];

	return { projects: [acme, beta], tasks };
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
