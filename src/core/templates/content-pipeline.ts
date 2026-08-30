/**
 * Content pipeline — Projects are series or campaigns, Tasks are individual
 * pieces of content with a publish date. Ships three `started` statuses
 * (Drafting / Editing / Scheduled) and no `unstarted` status at all — a
 * category is allowed to have zero statuses.
 *
 * The example content is a full feature showcase: three series/campaigns, two
 * productions broken into sub-tasks, a blocked dependency, channel-wide
 * un-parented work, archived (published and killed) pieces, mostly-dated tasks
 * with a realistic unscheduled bucket, every label and task type used more
 * than once, and a seeded dashboard.
 */

import { DEFAULT_PRIORITIES } from "../taxonomy/defaults";
import type { Comment, LabelValue, StatusValue, TaskTypeValue } from "../types";
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
	const blogSeries = makeProject(ctx, "Q3 Blog Series", {
		status: "drafting",
		createdAt: ctx.iso(-30),
	});
	const launch = makeProject(ctx, "Feature Launch Campaign", {
		status: "editing",
		createdAt: ctx.iso(-24),
	});
	const podcast = makeProject(ctx, "Podcast Season 2", {
		status: "drafting",
		createdAt: ctx.iso(-20),
	});

	const rank = rankSeq(25);
	const T = (n: number) => ctx.taskPath(n);

	const tasks = [
		// --- Q3 Blog Series: hierarchy #1 on the flagship post (~33% done).
		makeTask(ctx, 1, rank, {
			title: "How we cut our build time in half",
			taskType: "article",
			status: "published",
			priority: "medium",
			project: blogSeries.path,
			labels: ["blog"],
			dueDate: ctx.day(-7),
			createdAt: ctx.iso(-26),
		}),
		makeTask(ctx, 2, rank, {
			title: "A field guide to LexoRank",
			taskType: "article",
			status: "editing",
			priority: "high",
			project: blogSeries.path,
			labels: ["blog"],
			startDate: ctx.day(-10),
			dueDate: ctx.day(3),
			createdAt: ctx.iso(-22),
		}),
		makeTask(ctx, 3, rank, {
			title: "Outline the LexoRank post",
			taskType: "article",
			status: "published",
			priority: "medium",
			project: blogSeries.path,
			parent: T(2),
			labels: ["blog"],
			createdAt: ctx.iso(-21),
		}),
		makeTask(ctx, 4, rank, {
			title: "Draft the LexoRank post",
			taskType: "article",
			status: "editing",
			priority: "high",
			project: blogSeries.path,
			parent: T(2),
			labels: ["blog"],
			createdAt: ctx.iso(-16),
		}),
		makeTask(ctx, 5, rank, {
			title: "Get an engineering review on the LexoRank post",
			taskType: "article",
			status: "drafting",
			priority: "medium",
			project: blogSeries.path,
			parent: T(2),
			labels: ["blog"],
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 6, rank, {
			title: "Interview: how the design team works",
			taskType: "article",
			status: "drafting",
			priority: "low",
			project: blogSeries.path,
			labels: ["blog"],
			dueDate: ctx.day(12),
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 7, rank, {
			title: "Reader Q&A roundup",
			taskType: "newsletter",
			status: "idea",
			priority: "low",
			project: blogSeries.path,
			labels: ["blog", "newsletter"],
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 8, rank, {
			title: "Promo thread for the build-time post",
			taskType: "social-post",
			status: "published",
			priority: "low",
			project: blogSeries.path,
			labels: ["social", "blog"],
			dueDate: ctx.day(-6),
			archived: true,
			archivedAt: ctx.iso(-5),
			createdAt: ctx.iso(-24),
		}),

		// --- Feature Launch Campaign: hierarchy #2 on the demo video (~67% done)
		//     and the blocked dependency.
		makeTask(ctx, 9, rank, {
			title: "Announcement post",
			taskType: "article",
			status: "scheduled",
			priority: "high",
			project: launch.path,
			labels: ["blog"],
			dueDate: ctx.day(5),
			createdAt: ctx.iso(-14),
			relations: { blocks: [], blockedBy: [T(10)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 10, rank, {
			title: "2-minute demo video",
			taskType: "video",
			status: "editing",
			priority: "high",
			project: launch.path,
			labels: ["youtube"],
			startDate: ctx.day(-7),
			dueDate: ctx.day(4),
			createdAt: ctx.iso(-15),
			relations: { blocks: [T(9)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 11, rank, {
			title: "Write the demo script",
			taskType: "video",
			status: "published",
			priority: "medium",
			project: launch.path,
			parent: T(10),
			labels: ["youtube"],
			createdAt: ctx.iso(-14),
		}),
		makeTask(ctx, 12, rank, {
			title: "Record the screen capture",
			taskType: "video",
			status: "published",
			priority: "medium",
			project: launch.path,
			parent: T(10),
			labels: ["youtube"],
			createdAt: ctx.iso(-11),
		}),
		makeTask(ctx, 13, rank, {
			title: "Edit and add captions",
			taskType: "video",
			status: "editing",
			priority: "high",
			project: launch.path,
			parent: T(10),
			labels: ["youtube"],
			createdAt: ctx.iso(-8),
		}),
		makeTask(ctx, 14, rank, {
			title: "Launch-day newsletter",
			taskType: "newsletter",
			status: "drafting",
			priority: "medium",
			project: launch.path,
			labels: ["newsletter"],
			dueDate: ctx.day(5),
			createdAt: ctx.iso(-9),
		}),
		makeTask(ctx, 15, rank, {
			title: "Teaser thread",
			taskType: "social-post",
			status: "scheduled",
			priority: "medium",
			project: launch.path,
			labels: ["social"],
			dueDate: ctx.day(1),
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 16, rank, {
			title: "Behind-the-scenes short",
			taskType: "video",
			status: "killed",
			priority: "low",
			project: launch.path,
			labels: ["youtube", "social"],
			archived: true,
			archivedAt: ctx.iso(-4),
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 17, rank, {
			title: "Customer quote carousel",
			taskType: "social-post",
			status: "idea",
			priority: "low",
			project: launch.path,
			labels: ["social"],
			createdAt: ctx.iso(-5),
		}),

		// --- Podcast Season 2.
		makeTask(ctx, 18, rank, {
			title: "S2E1 — Scaling a design system",
			taskType: "video",
			status: "scheduled",
			priority: "high",
			project: podcast.path,
			labels: ["youtube"],
			dueDate: ctx.day(7),
			createdAt: ctx.iso(-16),
		}),
		makeTask(ctx, 19, rank, {
			title: "S2E2 — On-call without the dread",
			taskType: "video",
			status: "drafting",
			priority: "medium",
			project: podcast.path,
			labels: ["youtube"],
			dueDate: ctx.day(21),
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 20, rank, {
			title: "Season 2 trailer",
			taskType: "social-post",
			status: "published",
			priority: "medium",
			project: podcast.path,
			labels: ["social", "youtube"],
			dueDate: ctx.day(-3),
			archived: true,
			archivedAt: ctx.iso(-2),
			createdAt: ctx.iso(-18),
		}),
		makeTask(ctx, 21, rank, {
			title: "Book three guests for the back half of the season",
			taskType: "newsletter",
			status: "idea",
			priority: "low",
			project: podcast.path,
			createdAt: ctx.iso(-7),
		}),
		makeTask(ctx, 22, rank, {
			title: "Show-notes newsletter for S2E1",
			taskType: "newsletter",
			status: "drafting",
			priority: "medium",
			project: podcast.path,
			labels: ["newsletter"],
			dueDate: ctx.day(8),
			createdAt: ctx.iso(-4),
		}),

		// --- Channel-wide work, not tied to a series.
		makeTask(ctx, 23, rank, {
			title: "Refresh the content calendar template",
			taskType: "article",
			status: "drafting",
			priority: "low",
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 24, rank, {
			title: "Audit last quarter's top-performing posts",
			taskType: "article",
			status: "idea",
			priority: "medium",
			createdAt: ctx.iso(-3),
		}),
		makeTask(ctx, 25, rank, {
			title: "Update the media kit and one-pager",
			taskType: "social-post",
			status: "scheduled",
			priority: "low",
			labels: ["social"],
			dueDate: ctx.day(14),
			createdAt: ctx.iso(-2),
		}),
	];

	const comments = new Map<string, Comment[]>([
		[
			T(9),
			[
				{
					id: "cmt_01",
					author: "priya",
					date: ctx.iso(-2),
					body: "Copy is locked. Holding the schedule until the demo video is final so the embed goes out with it.",
					reactions: { "👍": 1 },
				},
			],
		],
	]);

	const descriptions = new Map<string, string>([
		[
			T(2),
			"## Description\nThe flagship explainer for the series. Outline, draft, and an engineering review before it goes to editing.\n",
		],
		[
			T(10),
			"## Description\n2-minute product demo for the launch. Script, screen capture, then edit with captions. The announcement post embeds it, so it ships first.\n",
		],
	]);

	const dashboard = makeDashboard(
		"editorial-calendar",
		"Editorial Calendar",
		[
			makeWidget(
				"w-status",
				"bar",
				"Pieces by Status",
				{ chartType: "bar", groupBy: "status" },
				{ x: 0, y: 0, w: 7, h: 4 },
			),
			makeWidget(
				"w-format",
				"pie",
				"Pieces by Format",
				{ chartType: "pie", groupBy: "taskType" },
				{ x: 7, y: 0, w: 5, h: 4 },
			),
			makeWidget(
				"w-publish",
				"timeline",
				"Publish Dates Over Time",
				{
					chartType: "timeline",
					xField: "dueDate",
					bucket: "week",
					groupBy: null,
				},
				{ x: 0, y: 4, w: 12, h: 4 },
			),
		],
		"pen-tool",
	);

	return {
		projects: [blogSeries, launch, podcast],
		tasks,
		comments,
		descriptions,
		dashboards: [dashboard],
	};
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
