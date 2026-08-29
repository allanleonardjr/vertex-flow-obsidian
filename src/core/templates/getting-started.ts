/**
 * Getting Started — a complete sample workspace that happens to open with a
 * short guided intro.
 *
 * It uses the workspace-default Statuses / Priorities / Task Types, adds a
 * tiny generic Label set, and its example content is a full feature showcase:
 * three relatable mini-projects, two sub-task hierarchies, un-parented errands,
 * archived work, relations, and a seeded dashboard — the first six tasks are
 * still the hands-on tutorial (drag to Done, set a due date, set a priority,
 * write a description, make a Project, make a Saved View).
 *
 * This is the "blank" option — there is no separate blank path.
 */

import {
	DEFAULT_PRIORITIES,
	DEFAULT_STATUSES,
	DEFAULT_TASK_TYPES,
} from "../taxonomy/defaults";
import type { LabelValue } from "../types";
import {
	makeDashboard,
	makeProject,
	makeTask,
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

const labels: LabelValue[] = [
	{ id: "important", name: "Important", color: "#ef4444" },
	{ id: "quick-win", name: "Quick win", color: "#22c55e" },
	{ id: "waiting", name: "Waiting on someone", color: "#f59e0b" },
];

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const intro = makeProject(ctx, "Getting Started", {
		status: "in-progress",
		createdAt: ctx.iso(-14),
	});
	const trip = makeProject(ctx, "Plan a weekend trip", {
		status: "in-progress",
		createdAt: ctx.iso(-20),
	});
	const room = makeProject(ctx, "Redecorate the living room", {
		status: "todo",
		createdAt: ctx.iso(-25),
	});

	const rank = rankSeq(25);
	const T = (n: number) => ctx.taskPath(n);

	const tasks = [
		// --- The guided intro (unchanged tutorial tasks).
		makeTask(ctx, 1, rank, {
			title: "Drag this task to Done",
			status: "todo",
			priority: "medium",
			project: intro.path,
		}),
		makeTask(ctx, 2, rank, {
			title: "Give this task a due date",
			status: "todo",
			project: intro.path,
		}),
		makeTask(ctx, 3, rank, {
			title: "Set a priority on this task",
			status: "todo",
			project: intro.path,
		}),
		makeTask(ctx, 4, rank, {
			title: "Open this task and write a description",
			status: "queue",
			project: intro.path,
		}),
		makeTask(ctx, 5, rank, {
			title: "Create your first Project of your own",
			status: "queue",
			priority: "high",
			project: intro.path,
		}),
		makeTask(ctx, 6, rank, {
			title: "Make a Saved View from the sidebar",
			status: "queue",
			project: intro.path,
		}),
		makeTask(ctx, 7, rank, {
			title: "Try the Board and Calendar views",
			status: "queue",
			project: intro.path,
			labels: ["quick-win"],
		}),

		// --- Plan a weekend trip: relations + hierarchy #1 (~50% done).
		makeTask(ctx, 8, rank, {
			title: "Decide on travel dates",
			taskType: "chore",
			status: "done",
			priority: "high",
			project: trip.path,
			labels: ["important"],
			dueDate: ctx.day(-2),
			createdAt: ctx.iso(-18),
			relations: { blocks: [T(10)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 9, rank, {
			title: "Agree a budget with everyone",
			taskType: "chore",
			status: "done",
			priority: "medium",
			project: trip.path,
			labels: ["waiting"],
			createdAt: ctx.iso(-17),
		}),
		makeTask(ctx, 10, rank, {
			title: "Book flights and accommodation",
			taskType: "chore",
			status: "in-progress",
			priority: "high",
			project: trip.path,
			labels: ["important"],
			startDate: ctx.day(-3),
			dueDate: ctx.day(6),
			createdAt: ctx.iso(-15),
			relations: { blocks: [], blockedBy: [T(8)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 11, rank, {
			title: "Book the outbound flights",
			taskType: "chore",
			status: "done",
			priority: "medium",
			project: trip.path,
			parent: T(10),
			createdAt: ctx.iso(-14),
		}),
		makeTask(ctx, 12, rank, {
			title: "Reserve the hotel",
			taskType: "chore",
			status: "todo",
			priority: "medium",
			project: trip.path,
			parent: T(10),
			labels: ["waiting"],
			createdAt: ctx.iso(-13),
		}),
		makeTask(ctx, 13, rank, {
			title: "Make a shared packing list",
			taskType: "feature",
			status: "todo",
			priority: "low",
			project: trip.path,
			labels: ["quick-win"],
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 14, rank, {
			title: "Research things to do while we're there",
			taskType: "chore",
			status: "todo",
			priority: "low",
			project: trip.path,
			startDate: ctx.day(-6),
			dueDate: ctx.day(4),
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 15, rank, {
			title: "Cancel the old hotel booking",
			taskType: "chore",
			status: "done",
			priority: "low",
			project: trip.path,
			archived: true,
			archivedAt: ctx.iso(-5),
			createdAt: ctx.iso(-16),
		}),
		makeTask(ctx, 16, rank, {
			title: "Look into travel insurance",
			taskType: "chore",
			status: "canceled",
			priority: "low",
			project: trip.path,
			archived: true,
			archivedAt: ctx.iso(-4),
			createdAt: ctx.iso(-12),
		}),

		// --- Redecorate the living room: hierarchy #2 (all sub-tasks done),
		//     plus a relation pair.
		makeTask(ctx, 17, rank, {
			title: "Choose a colour scheme",
			taskType: "chore",
			status: "done",
			priority: "medium",
			project: room.path,
			labels: ["important"],
			createdAt: ctx.iso(-24),
			relations: { blocks: [T(18)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 18, rank, {
			title: "Repaint the walls",
			taskType: "chore",
			status: "in-progress",
			priority: "high",
			project: room.path,
			startDate: ctx.day(-1),
			dueDate: ctx.day(3),
			createdAt: ctx.iso(-20),
			relations: { blocks: [], blockedBy: [T(17)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 19, rank, {
			title: "Patch and sand the walls",
			taskType: "chore",
			status: "done",
			priority: "medium",
			project: room.path,
			parent: T(18),
			createdAt: ctx.iso(-19),
		}),
		makeTask(ctx, 20, rank, {
			title: "Prime the walls",
			taskType: "chore",
			status: "done",
			priority: "low",
			project: room.path,
			parent: T(18),
			createdAt: ctx.iso(-18),
		}),
		makeTask(ctx, 21, rank, {
			title: "Apply two topcoats",
			taskType: "chore",
			status: "done",
			priority: "medium",
			project: room.path,
			parent: T(18),
			createdAt: ctx.iso(-16),
		}),
		makeTask(ctx, 22, rank, {
			title: "Fix the flickering light fixture",
			taskType: "bug",
			status: "done",
			priority: "medium",
			project: room.path,
			archived: true,
			archivedAt: ctx.iso(-6),
			createdAt: ctx.iso(-22),
		}),
		// --- Un-parented errands, not tied to any project.
		makeTask(ctx, 23, rank, {
			title: "Book the annual car service",
			taskType: "chore",
			status: "todo",
			priority: "low",
			dueDate: ctx.day(9),
			createdAt: ctx.iso(-9),
		}),
		makeTask(ctx, 24, rank, {
			title: "Renew the car insurance",
			taskType: "chore",
			status: "todo",
			priority: "high",
			labels: ["important"],
			dueDate: ctx.day(12),
			createdAt: ctx.iso(-7),
		}),
		makeTask(ctx, 25, rank, {
			title: "Schedule a dentist appointment",
			taskType: "chore",
			status: "todo",
			priority: "low",
			labels: ["waiting", "quick-win"],
			createdAt: ctx.iso(-3),
		}),
	];

	const descriptions = new Map<string, string>([
		[
			T(1),
			"## Description\nEvery view is drag-and-drop. On the Board, drop a card into another column to change its status; on the List, drag a row to reorder it.\n",
		],
		[
			T(10),
			"## Description\nFlights first, then the hotel to match. Blocked until the dates are locked in.\n",
		],
	]);

	const dashboard = makeDashboard(
		"overview",
		"Overview",
		[
			makeWidget(
				"w-status",
				"bar",
				"Tasks by Status",
				{ chartType: "bar", groupBy: "status" },
				{ x: 0, y: 0, w: 7, h: 4 },
			),
			makeWidget(
				"w-priority",
				"pie",
				"Tasks by Priority",
				{ chartType: "pie", groupBy: "priority" },
				{ x: 7, y: 0, w: 5, h: 4 },
			),
		],
		"gauge",
	);

	return {
		workspace: { labels },
		projects: [intro, trip, room],
		tasks,
		descriptions,
		dashboards: [dashboard],
	};
}

export const gettingStartedTemplate: WorkspaceTemplate = {
	id: "getting-started",
	name: "Getting Started",
	description:
		"A complete sample workspace with three mini-projects that opens on a short hands-on intro.",
	icon: "rocket",
	defaultIdPrefix: "TSK",
	// Only a small generic Label set is overridden; Statuses / Priorities /
	// Task Types are exactly the workspace defaults.
	workspace: { labels },
	settings: [
		settingsFromValues("Statuses", DEFAULT_STATUSES),
		settingsFromValues("Priorities", DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", DEFAULT_TASK_TYPES),
		settingsFromValues("Labels", labels),
		plainSetting("Default view", "All Tasks (List, grouped by Status)"),
	],
	buildExampleContent,
};
