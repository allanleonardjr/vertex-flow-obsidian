/**
 * Personal admin — a lightweight GTD setup. Projects are life areas; Labels
 * stand in for GTD contexts (@Home, @Errands, …).
 *
 * The example content is a full feature showcase: four life areas, two
 * multi-step outcomes broken into next-action sub-tasks, a blocked dependency,
 * un-filed inbox items with no project, archived (done and dropped) tasks, a
 * mostly-undated backlog the way real GTD lists look, every context label used
 * more than once, and a seeded dashboard. Task Types stay available but unused
 * — GTD next-actions aren't typed.
 */

import { DEFAULT_PRIORITIES, DEFAULT_TASK_TYPES } from "../taxonomy/defaults";
import type { Comment, LabelValue, StatusValue } from "../types";
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
	const home = makeProject(ctx, "Home", { status: "doing", createdAt: ctx.iso(-40) });
	const health = makeProject(ctx, "Health", { status: "doing", createdAt: ctx.iso(-36) });
	const finances = makeProject(ctx, "Finances", { status: "doing", createdAt: ctx.iso(-30) });
	const learning = makeProject(ctx, "Learning", { status: "someday", createdAt: ctx.iso(-24) });

	const rank = rankSeq(25);
	const T = (n: number) => ctx.taskPath(n);

	const tasks = [
		// --- Home: hierarchy #1 — "Redo the home office" (~33% done).
		makeTask(ctx, 1, rank, {
			title: "Replace the kitchen tap washer",
			status: "next-action",
			priority: "medium",
			project: home.path,
			labels: ["at-home"],
			createdAt: ctx.iso(-20),
		}),
		makeTask(ctx, 2, rank, {
			title: "Book a carpet cleaner",
			status: "done",
			priority: "low",
			project: home.path,
			labels: ["at-calls"],
			archived: true,
			archivedAt: ctx.iso(-8),
			createdAt: ctx.iso(-18),
		}),
		makeTask(ctx, 3, rank, {
			title: "Return the parcel at the post office",
			status: "next-action",
			priority: "high",
			project: home.path,
			labels: ["at-errands"],
			dueDate: ctx.day(2),
			createdAt: ctx.iso(-5),
		}),
		makeTask(ctx, 4, rank, {
			title: "Redo the home office",
			status: "doing",
			priority: "medium",
			project: home.path,
			startDate: ctx.day(-7),
			dueDate: ctx.day(16),
			createdAt: ctx.iso(-14),
		}),
		makeTask(ctx, 5, rank, {
			title: "Declutter the desk and drawers",
			status: "done",
			priority: "medium",
			project: home.path,
			parent: T(4),
			labels: ["at-home"],
			createdAt: ctx.iso(-13),
		}),
		makeTask(ctx, 6, rank, {
			title: "Order a monitor arm",
			status: "next-action",
			priority: "low",
			project: home.path,
			parent: T(4),
			labels: ["at-computer"],
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 7, rank, {
			title: "Sort out the cable mess",
			status: "someday",
			priority: "low",
			project: home.path,
			parent: T(4),
			labels: ["at-home"],
			createdAt: ctx.iso(-9),
		}),
		makeTask(ctx, 8, rank, {
			title: "Fix the wobbly bookshelf",
			status: "done",
			priority: "low",
			project: home.path,
			labels: ["at-home"],
			archived: true,
			archivedAt: ctx.iso(-6),
			createdAt: ctx.iso(-22),
		}),

		// --- Health.
		makeTask(ctx, 9, rank, {
			title: "Schedule the annual check-up",
			status: "next-action",
			priority: "medium",
			project: health.path,
			labels: ["at-calls"],
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 10, rank, {
			title: "Walk 3x this week",
			status: "doing",
			priority: "medium",
			project: health.path,
			dueDate: ctx.day(3),
			createdAt: ctx.iso(-4),
		}),
		makeTask(ctx, 11, rank, {
			title: "Refill the allergy prescription",
			status: "next-action",
			priority: "high",
			project: health.path,
			labels: ["at-errands", "at-calls"],
			dueDate: ctx.day(1),
			createdAt: ctx.iso(-3),
		}),
		makeTask(ctx, 12, rank, {
			title: "Book a dentist appointment",
			status: "someday",
			priority: "low",
			project: health.path,
			labels: ["at-calls"],
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 13, rank, {
			title: "Try the new running route",
			status: "dropped",
			priority: "low",
			project: health.path,
			archived: true,
			archivedAt: ctx.iso(-7),
			createdAt: ctx.iso(-15),
		}),

		// --- Finances: hierarchy #2 — "Sort out retirement contributions"
		//     (~67% done) + a blocked dependency.
		makeTask(ctx, 14, rank, {
			title: "Review the credit card statements",
			status: "next-action",
			priority: "high",
			project: finances.path,
			labels: ["at-computer"],
			dueDate: ctx.day(4),
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 15, rank, {
			title: "Sort out retirement contributions",
			status: "doing",
			priority: "medium",
			project: finances.path,
			startDate: ctx.day(-10),
			dueDate: ctx.day(9),
			createdAt: ctx.iso(-16),
			relations: { blocks: [T(19)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 16, rank, {
			title: "Read the plan options document",
			status: "done",
			priority: "medium",
			project: finances.path,
			parent: T(15),
			labels: ["at-computer"],
			createdAt: ctx.iso(-15),
		}),
		makeTask(ctx, 17, rank, {
			title: "Ask HR about the employer match",
			status: "done",
			priority: "medium",
			project: finances.path,
			parent: T(15),
			labels: ["at-calls"],
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 18, rank, {
			title: "Decide on the new contribution rate",
			status: "next-action",
			priority: "high",
			project: finances.path,
			parent: T(15),
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 19, rank, {
			title: "Update the payroll contribution form",
			status: "someday",
			priority: "medium",
			project: finances.path,
			labels: ["at-computer"],
			createdAt: ctx.iso(-7),
			relations: { blocks: [], blockedBy: [T(15)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 20, rank, {
			title: "Set up an automatic savings transfer",
			status: "someday",
			priority: "medium",
			project: finances.path,
			labels: ["at-computer"],
			createdAt: ctx.iso(-11),
		}),
		// --- Learning.
		makeTask(ctx, 21, rank, {
			title: "Finish the Spanish unit 4 exercises",
			status: "doing",
			priority: "low",
			project: learning.path,
			labels: ["at-computer"],
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 22, rank, {
			title: "Pick a book for next month",
			status: "someday",
			priority: "low",
			project: learning.path,
			createdAt: ctx.iso(-6),
		}),

		// --- Un-filed inbox items, not yet sorted into a life area.
		makeTask(ctx, 23, rank, {
			title: "File the tax documents folder",
			status: "next-action",
			priority: "low",
			labels: ["at-home"],
			createdAt: ctx.iso(-9),
		}),
		makeTask(ctx, 24, rank, {
			title: "Reply to the school newsletter about the trip",
			status: "next-action",
			priority: "medium",
			labels: ["at-computer"],
			dueDate: ctx.day(2),
			createdAt: ctx.iso(-2),
		}),
		makeTask(ctx, 25, rank, {
			title: "RSVP to the wedding",
			status: "next-action",
			priority: "high",
			labels: ["at-errands"],
			createdAt: ctx.iso(-1),
		}),
	];

	const comments = new Map<string, Comment[]>([
		[
			T(18),
			[
				{
					id: "cmt_01",
					author: "me",
					date: ctx.iso(-1),
					body: "Match is 5%. Bumping to at least that, then decide if there's room for more after the car payment clears in March.",
					reactions: {},
				},
			],
		],
	]);

	const descriptions = new Map<string, string>([
		[
			T(15),
			"## Description\nRead the options, confirm the employer match, pick a rate, then update the form. The form update is a separate next action once the rate is decided.\n",
		],
	]);

	const dashboard = makeDashboard(
		"weekly-review",
		"Weekly Review",
		[
			makeWidget(
				"w-status",
				"bar",
				"Actions by Status",
				{ chartType: "bar", groupBy: "status" },
				{ x: 0, y: 0, w: 7, h: 4 },
			),
			makeWidget(
				"w-context",
				"pie",
				"Actions by Context",
				{ chartType: "pie", groupBy: "label" },
				{ x: 7, y: 0, w: 5, h: 4 },
			),
		],
		"house",
	);

	return {
		projects: [home, health, finances, learning],
		tasks,
		comments,
		descriptions,
		dashboards: [dashboard],
	};
}

export const personalAdminTemplate: WorkspaceTemplate = {
	id: "personal-admin",
	name: "Personal Admin",
	description:
		"A GTD-style setup: life areas as Projects, next actions as Tasks, and @context labels to batch what you can do right now.",
	icon: "house",
	supportsExampleContent: true,
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
