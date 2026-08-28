/**
 * Personal admin — a lightweight GTD setup. Projects are life areas; Labels
 * stand in for GTD contexts (@Home, @Errands, …).
 */

import { DEFAULT_PRIORITIES, DEFAULT_TASK_TYPES } from "../taxonomy/defaults";
import type { LabelValue, StatusValue } from "../types";
import { makeProject, makeTask, makeView, rankSeq } from "./helpers";
import {
	plainSetting,
	settingsFromValues,
	type TemplateBuildContext,
	type TemplateContent,
	type WorkspaceTemplate,
} from "./types";

const statuses: StatusValue[] = [
	{ id: "someday", name: "Someday", color: "#94a3b8", category: "backlog", order: 1 },
	{ id: "next-action", name: "Next Action", color: "#60a5fa", category: "unstarted", order: 2 },
	{ id: "doing", name: "Doing", color: "#fbbf24", category: "started", order: 3 },
	{ id: "done", name: "Done", color: "#34d399", category: "completed", order: 4 },
	{ id: "dropped", name: "Dropped", color: "#f87171", category: "canceled", order: 5 },
];

const labels: LabelValue[] = [
	{ id: "at-home", name: "@Home", color: "#22c55e" },
	{ id: "at-errands", name: "@Errands", color: "#f97316" },
	{ id: "at-calls", name: "@Calls", color: "#3b82f6" },
	{ id: "at-computer", name: "@Computer", color: "#6366f1" },
];

const byArea = makeView("by-area", "By Area", {
	icon: "folder",
	viewType: "list",
	groupBy: "project",
});

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const home = makeProject(ctx, "Home", { status: "doing" });
	const health = makeProject(ctx, "Health", { status: "doing" });
	const finances = makeProject(ctx, "Finances", { status: "doing" });
	const learning = makeProject(ctx, "Learning", { status: "someday" });

	const rank = rankSeq(9);
	const tasks = [
		makeTask(ctx, 1, rank, {
			title: "Replace the kitchen tap washer",
			status: "next-action",
			priority: "medium",
			project: home.path,
			labels: ["at-home"],
		}),
		makeTask(ctx, 2, rank, {
			title: "Book a carpet cleaner",
			status: "someday",
			priority: "low",
			project: home.path,
			labels: ["at-calls"],
		}),
		makeTask(ctx, 3, rank, {
			title: "Return the parcel at the post office",
			status: "next-action",
			priority: "high",
			project: home.path,
			labels: ["at-errands"],
			dueDate: ctx.day(2),
		}),
		makeTask(ctx, 4, rank, {
			title: "Schedule annual check-up",
			status: "next-action",
			priority: "medium",
			project: health.path,
			labels: ["at-calls"],
		}),
		makeTask(ctx, 5, rank, {
			title: "Walk 3x this week",
			status: "doing",
			priority: "medium",
			project: health.path,
		}),
		makeTask(ctx, 6, rank, {
			title: "Review credit card statements",
			status: "next-action",
			priority: "high",
			project: finances.path,
			labels: ["at-computer"],
			dueDate: ctx.day(4),
		}),
		makeTask(ctx, 7, rank, {
			title: "Set up automatic savings transfer",
			status: "someday",
			priority: "medium",
			project: finances.path,
			labels: ["at-computer"],
		}),
		makeTask(ctx, 8, rank, {
			title: "Finish the Spanish unit 4 exercises",
			status: "doing",
			priority: "low",
			project: learning.path,
			labels: ["at-computer"],
		}),
		makeTask(ctx, 9, rank, {
			title: "Pick a book for next month",
			status: "someday",
			priority: "low",
			project: learning.path,
		}),
	];

	return { projects: [home, health, finances, learning], tasks };
}

export const personalAdminTemplate: WorkspaceTemplate = {
	id: "personal-admin",
	name: "Personal Admin",
	description:
		"A GTD-style setup: life areas as Projects, next actions as Tasks, and @context labels to batch what you can do right now.",
	icon: "house",
	defaultIdPrefix: "TODO",
	workspace: { statuses, labels },
	views: [byArea],
	settings: [
		settingsFromValues("Statuses", statuses),
		settingsFromValues("Priorities", DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", DEFAULT_TASK_TYPES),
		settingsFromValues("Labels", labels),
		plainSetting("Default view", "By Area (List, grouped by Project)"),
	],
	buildExampleContent,
};
