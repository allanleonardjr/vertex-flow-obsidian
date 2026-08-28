/**
 * Content pipeline — Projects are series or campaigns, Tasks are individual
 * pieces of content with a publish date. Ships three `started` statuses
 * (Drafting / Editing / Scheduled) and no `unstarted` status at all — a
 * category is allowed to have zero statuses (§5.1).
 */

import { DEFAULT_PRIORITIES } from "../taxonomy/defaults";
import type { LabelValue, StatusValue, TaskTypeValue } from "../types";
import { makeProject, makeTask, makeView, rankSeq } from "./helpers";
import {
	plainSetting,
	settingsFromValues,
	type TemplateBuildContext,
	type TemplateContent,
	type WorkspaceTemplate,
} from "./types";

const statuses: StatusValue[] = [
	{ id: "idea", name: "Idea", color: "#94a3b8", category: "backlog", order: 1 },
	{ id: "drafting", name: "Drafting", color: "#60a5fa", category: "started", order: 2 },
	{ id: "editing", name: "Editing", color: "#fbbf24", category: "started", order: 3 },
	{ id: "scheduled", name: "Scheduled", color: "#a855f7", category: "started", order: 4 },
	{ id: "published", name: "Published", color: "#34d399", category: "completed", order: 5 },
	{ id: "killed", name: "Killed", color: "#f87171", category: "canceled", order: 6 },
];

const taskTypes: TaskTypeValue[] = [
	{ id: "article", name: "Article", color: "#3b82f6" },
	{ id: "video", name: "Video", color: "#ef4444" },
	{ id: "newsletter", name: "Newsletter", color: "#14b8a6" },
	{ id: "social-post", name: "Social Post", color: "#ec4899" },
];

const labels: LabelValue[] = [
	{ id: "blog", name: "Blog", color: "#60a5fa" },
	{ id: "youtube", name: "YouTube", color: "#f87171" },
	{ id: "newsletter", name: "Newsletter", color: "#06b6d4" },
	{ id: "social", name: "Social", color: "#d8b4fe" },
];

const calendar = makeView("by-publish-date", "By Publish Date", {
	icon: "calendar-days",
	viewType: "list",
	groupBy: "none",
	sortBy: "dueDate",
});
const board = makeView("pipeline", "Pipeline", {
	icon: "kanban",
	viewType: "board",
	groupBy: "status",
});

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const blogSeries = makeProject(ctx, "Q3 Blog Series", { status: "drafting" });
	const launch = makeProject(ctx, "Feature Launch Campaign", { status: "editing" });

	const rank = rankSeq(9);
	const tasks = [
		makeTask(ctx, 1, rank, {
			title: "How we cut our build time in half",
			taskType: "article",
			status: "published",
			priority: "medium",
			project: blogSeries.path,
			labels: ["blog"],
			dueDate: ctx.day(-7),
		}),
		makeTask(ctx, 2, rank, {
			title: "A field guide to LexoRank",
			taskType: "article",
			status: "editing",
			priority: "high",
			project: blogSeries.path,
			labels: ["blog"],
			dueDate: ctx.day(3),
		}),
		makeTask(ctx, 3, rank, {
			title: "Interview: how the design team works",
			taskType: "article",
			status: "drafting",
			priority: "low",
			project: blogSeries.path,
			labels: ["blog"],
			dueDate: ctx.day(12),
		}),
		makeTask(ctx, 4, rank, {
			title: "Reader Q&A roundup",
			taskType: "article",
			status: "idea",
			priority: "low",
			project: blogSeries.path,
			labels: ["blog"],
		}),
		makeTask(ctx, 5, rank, {
			title: "Announcement post",
			taskType: "article",
			status: "scheduled",
			priority: "high",
			project: launch.path,
			labels: ["blog"],
			dueDate: ctx.day(5),
		}),
		makeTask(ctx, 6, rank, {
			title: "2-minute demo video",
			taskType: "video",
			status: "editing",
			priority: "high",
			project: launch.path,
			labels: ["youtube"],
			dueDate: ctx.day(4),
		}),
		makeTask(ctx, 7, rank, {
			title: "Launch-day newsletter",
			taskType: "newsletter",
			status: "drafting",
			priority: "medium",
			project: launch.path,
			labels: ["newsletter"],
			dueDate: ctx.day(5),
		}),
		makeTask(ctx, 8, rank, {
			title: "Teaser thread",
			taskType: "social-post",
			status: "scheduled",
			priority: "medium",
			project: launch.path,
			labels: ["social"],
			dueDate: ctx.day(1),
		}),
		makeTask(ctx, 9, rank, {
			title: "Behind-the-scenes short",
			taskType: "video",
			status: "killed",
			priority: "low",
			project: launch.path,
			labels: ["youtube", "social"],
		}),
	];

	return { projects: [blogSeries, launch], tasks };
}

export const contentPipelineTemplate: WorkspaceTemplate = {
	id: "content-pipeline",
	name: "Content Pipeline",
	description:
		"Plan articles, videos and newsletters as Tasks under a series or campaign, each with a publish date.",
	icon: "pen-tool",
	defaultIdPrefix: "CNT",
	workspace: { statuses, taskTypes, labels },
	views: [calendar, board],
	settings: [
		settingsFromValues("Statuses", statuses),
		settingsFromValues("Priorities", DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", taskTypes),
		settingsFromValues("Labels", labels),
		plainSetting("Default view", "By Publish Date (List, sorted by due date)"),
	],
	buildExampleContent,
};
