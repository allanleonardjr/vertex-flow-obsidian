/**
 * Getting Started — the plainest template. No taxonomy overrides at all: it
 * uses the workspace defaults verbatim. The example content is a short in-app
 * tutorial rather than a realistic project.
 *
 * This is the "blank" option — there is no separate blank path.
 */

import {
	DEFAULT_LABELS,
	DEFAULT_PRIORITIES,
	DEFAULT_STATUSES,
	DEFAULT_TASK_TYPES,
} from "../taxonomy/defaults";
import { makeProject, makeTask, rankSeq } from "./helpers";
import {
	plainSetting,
	settingsFromValues,
	type TemplateBuildContext,
	type TemplateContent,
	type WorkspaceTemplate,
} from "./types";

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const project = makeProject(ctx, "Getting Started", { status: "in-progress" });
	const rank = rankSeq(6);

	const tasks = [
		makeTask(ctx, 1, rank, {
			title: "Drag this task to Done",
			status: "todo",
			priority: "medium",
			project: project.path,
		}),
		makeTask(ctx, 2, rank, {
			title: "Give this task a due date",
			status: "todo",
			project: project.path,
		}),
		makeTask(ctx, 3, rank, {
			title: "Set a priority on this task",
			status: "todo",
			project: project.path,
		}),
		makeTask(ctx, 4, rank, {
			title: "Open this task and write a description",
			status: "queue",
			project: project.path,
		}),
		makeTask(ctx, 5, rank, {
			title: "Create your first Project of your own",
			status: "queue",
			priority: "high",
			project: project.path,
		}),
		makeTask(ctx, 6, rank, {
			title: "Make a Saved View from the sidebar",
			status: "queue",
			project: project.path,
		}),
	];

	const descriptions = new Map<string, string>([
		[
			ctx.taskPath(1),
			"## Description\nEvery view is drag-and-drop. On the Board, drop a card into another column to change its status; on the List, drag a row to reorder it.\n",
		],
	]);

	return { projects: [project], tasks, descriptions };
}

export const gettingStartedTemplate: WorkspaceTemplate = {
	id: "getting-started",
	name: "Getting Started",
	description:
		"A clean workspace with the standard defaults and a handful of tutorial tasks to click through.",
	icon: "rocket",
	defaultIdPrefix: "TSK",
	// No taxonomy overrides — the workspace defaults are exactly right here.
	settings: [
		settingsFromValues("Statuses", DEFAULT_STATUSES),
		settingsFromValues("Priorities", DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", DEFAULT_TASK_TYPES),
		settingsFromValues("Labels", DEFAULT_LABELS),
		plainSetting("Default view", "All Tasks (List, grouped by Status)"),
	],
	buildExampleContent,
};
