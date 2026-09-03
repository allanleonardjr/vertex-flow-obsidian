/**
 * Feedback roadmap — Featurebase-style. Projects are product areas; Tasks are
 * individual pieces of feedback moving across a public-roadmap status set.
 *
 * The example content is a full feature showcase: four product areas, two
 * feature requests broken into sub-tasks, un-parented cross-cutting feedback,
 * archived (shipped and declined) items, a blocked dependency, every label and
 * task type used more than once, and a seeded dashboard.
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
	{ id: "under-review", name: "Under Review", color: "#94a3b8", category: "backlog", order: 1 },
	{ id: "planned", name: "Planned", color: "#60a5fa", category: "unstarted", order: 2 },
	{ id: "in-progress", name: "In Progress", color: "#fbbf24", category: "started", order: 3 },
	{ id: "shipped", name: "Shipped", color: "#34d399", category: "completed", order: 4 },
	{ id: "declined", name: "Declined", color: "#f87171", category: "canceled", order: 5 },
];

const taskTypes: TaskTypeValue[] = [
	{ id: "feature-request", name: "Feature Request", color: "#3b82f6" },
	{ id: "bug-report", name: "Bug Report", color: "#ef4444" },
	{ id: "improvement", name: "Improvement", color: "#22c55e" },
];

const labels: LabelValue[] = [
	{ id: "customer-request", name: "Customer Request", color: "#f97316" },
	{ id: "internal", name: "Internal", color: "#94a3b8" },
	{ id: "support-escalation", name: "Support Escalation", color: "#ec4899" },
	{ id: "quick-win", name: "Quick Win", color: "#84cc16" },
];

const roadmap = makeView("roadmap", "Roadmap", {
	icon: "kanban",
	viewType: "board",
	groupBy: "status",
});

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const editor = makeProject(ctx, "Editor", {
		status: "in-progress",
		createdAt: ctx.iso(-40),
	});
	const sync = makeProject(ctx, "Sync & Sharing", {
		status: "in-progress",
		createdAt: ctx.iso(-38),
	});
	const mobile = makeProject(ctx, "Mobile Apps", {
		status: "planned",
		createdAt: ctx.iso(-34),
	});
	const search = makeProject(ctx, "Search & Navigation", {
		status: "in-progress",
		createdAt: ctx.iso(-30),
	});

	const rank = rankSeq(25);
	const T = (n: number) => ctx.taskPath(n);

	const tasks = [
		// --- Editor.
		makeTask(ctx, 1, rank, {
			title: "Inline code blocks with syntax highlighting",
			taskType: "feature-request",
			status: "planned",
			priority: "high",
			project: editor.path,
			labels: ["customer-request"],
			dueDate: ctx.day(21),
			createdAt: ctx.iso(-38),
		}),
		makeTask(ctx, 2, rank, {
			title: "Cursor jumps to top when pasting long text",
			taskType: "bug-report",
			status: "in-progress",
			priority: "urgent",
			project: editor.path,
			labels: ["support-escalation"],
			startDate: ctx.day(-4),
			dueDate: ctx.day(2),
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 3, rank, {
			title: "Remember last-used heading level",
			taskType: "improvement",
			status: "under-review",
			priority: "low",
			project: editor.path,
			labels: ["quick-win"],
			createdAt: ctx.iso(-9),
		}),
		makeTask(ctx, 4, rank, {
			title: "Markdown table editing with a visual grid",
			taskType: "feature-request",
			status: "planned",
			priority: "medium",
			project: editor.path,
			labels: ["customer-request"],
			dueDate: ctx.day(30),
			createdAt: ctx.iso(-20),
		}),
		makeTask(ctx, 5, rank, {
			title: "Slash-command menu for block types",
			taskType: "feature-request",
			status: "shipped",
			priority: "medium",
			project: editor.path,
			labels: ["quick-win"],
			createdAt: ctx.iso(-28),
		}),
		makeTask(ctx, 6, rank, {
			title: "Spellcheck flags code identifiers",
			taskType: "bug-report",
			status: "declined",
			priority: "low",
			project: editor.path,
			labels: ["internal"],
			archived: true,
			archivedAt: ctx.iso(-7),
			createdAt: ctx.iso(-24),
		}),

		// --- Sync & Sharing: hierarchy #1 (~33% done) + a blocked dependency.
		makeTask(ctx, 7, rank, {
			title: "Real-time collaborative editing",
			taskType: "feature-request",
			status: "in-progress",
			priority: "high",
			project: sync.path,
			labels: ["customer-request"],
			startDate: ctx.day(-14),
			dueDate: ctx.day(28),
			createdAt: ctx.iso(-30),
			relations: { blocks: [T(11)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 8, rank, {
			title: "Design the shared document (CRDT) model",
			taskType: "feature-request",
			status: "shipped",
			priority: "high",
			project: sync.path,
			parent: T(7),
			labels: ["internal"],
			createdAt: ctx.iso(-29),
		}),
		makeTask(ctx, 9, rank, {
			title: "Live cursors and selection sync",
			taskType: "feature-request",
			status: "in-progress",
			priority: "medium",
			project: sync.path,
			parent: T(7),
			labels: ["customer-request"],
			createdAt: ctx.iso(-22),
		}),
		makeTask(ctx, 10, rank, {
			title: "Presence indicators — who's viewing a note",
			taskType: "improvement",
			status: "planned",
			priority: "low",
			project: sync.path,
			parent: T(7),
			labels: ["quick-win"],
			createdAt: ctx.iso(-18),
		}),
		makeTask(ctx, 11, rank, {
			title: "Conflict resolution when two devices edit offline",
			taskType: "improvement",
			status: "planned",
			priority: "medium",
			project: sync.path,
			labels: ["internal"],
			createdAt: ctx.iso(-16),
			relations: { blocks: [], blockedBy: [T(7)], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 12, rank, {
			title: "Share a read-only link to a single note",
			taskType: "feature-request",
			status: "in-progress",
			priority: "high",
			project: sync.path,
			labels: ["customer-request", "support-escalation"],
			startDate: ctx.day(-6),
			dueDate: ctx.day(5),
			createdAt: ctx.iso(-13),
		}),
		makeTask(ctx, 13, rank, {
			title: "Sync status icon stuck on 'syncing'",
			taskType: "bug-report",
			status: "shipped",
			priority: "urgent",
			project: sync.path,
			labels: ["support-escalation"],
			archived: true,
			archivedAt: ctx.iso(-4),
			createdAt: ctx.iso(-15),
		}),

		// --- Mobile Apps.
		makeTask(ctx, 14, rank, {
			title: "Widgets on the iOS home screen",
			taskType: "feature-request",
			status: "shipped",
			priority: "medium",
			project: mobile.path,
			labels: ["quick-win"],
			createdAt: ctx.iso(-26),
		}),
		makeTask(ctx, 15, rank, {
			title: "Android tablet split-view layout",
			taskType: "feature-request",
			status: "under-review",
			priority: "low",
			project: mobile.path,
			labels: ["customer-request"],
			createdAt: ctx.iso(-11),
		}),
		makeTask(ctx, 16, rank, {
			title: "Drop support for iOS 15",
			taskType: "improvement",
			status: "declined",
			priority: "low",
			project: mobile.path,
			labels: ["internal"],
			createdAt: ctx.iso(-19),
		}),
		makeTask(ctx, 17, rank, {
			title: "Offline attachments don't download on cellular",
			taskType: "bug-report",
			status: "in-progress",
			priority: "high",
			project: mobile.path,
			labels: ["support-escalation"],
			dueDate: ctx.day(4),
			createdAt: ctx.iso(-8),
		}),

		// --- Search & Navigation: hierarchy #2 (~67% done).
		makeTask(ctx, 18, rank, {
			title: "Full-text search across the whole vault",
			taskType: "feature-request",
			status: "in-progress",
			priority: "high",
			project: search.path,
			labels: ["customer-request"],
			startDate: ctx.day(-10),
			dueDate: ctx.day(12),
			createdAt: ctx.iso(-28),
		}),
		makeTask(ctx, 19, rank, {
			title: "Build the incremental search index",
			taskType: "feature-request",
			status: "shipped",
			priority: "high",
			project: search.path,
			parent: T(18),
			labels: ["internal"],
			createdAt: ctx.iso(-27),
		}),
		makeTask(ctx, 20, rank, {
			title: "Relevance ranking and fuzzy matching",
			taskType: "improvement",
			status: "shipped",
			priority: "medium",
			project: search.path,
			parent: T(18),
			labels: ["internal"],
			createdAt: ctx.iso(-21),
		}),
		makeTask(ctx, 21, rank, {
			title: "Search results panel with previews",
			taskType: "feature-request",
			status: "in-progress",
			priority: "medium",
			project: search.path,
			parent: T(18),
			labels: ["customer-request"],
			createdAt: ctx.iso(-14),
		}),
		makeTask(ctx, 22, rank, {
			title: "Jump-to-anything quick switcher",
			taskType: "feature-request",
			status: "shipped",
			priority: "high",
			project: search.path,
			labels: ["quick-win"],
			archived: true,
			archivedAt: ctx.iso(-3),
			createdAt: ctx.iso(-25),
		}),

		// --- Cross-cutting feedback, not tied to any one product area.
		makeTask(ctx, 23, rank, {
			title: "Publish a public changelog page",
			taskType: "improvement",
			status: "planned",
			priority: "medium",
			labels: ["customer-request"],
			dueDate: ctx.day(18),
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 24, rank, {
			title: "Keyboard shortcut cheat-sheet in the help menu",
			taskType: "improvement",
			status: "under-review",
			priority: "low",
			labels: ["quick-win"],
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 25, rank, {
			title: "One-click data export for account deletion requests",
			taskType: "feature-request",
			status: "in-progress",
			priority: "urgent",
			labels: ["support-escalation", "internal"],
			startDate: ctx.day(-3),
			dueDate: ctx.day(1),
			createdAt: ctx.iso(-5),
		}),
	];

	const comments = new Map<string, Comment[]>([
		[
			T(2),
			[
				{
					id: "cmt_01",
					author: "sam",
					date: ctx.iso(-2),
					body: "Three separate customers reported this in the last week — bumping to urgent.",
					reactions: { "👍": 3 },
				},
			],
		],
		[
			T(7),
			[
				{
					id: "cmt_01",
					author: "jordan",
					date: ctx.iso(-4),
					body: "CRDT model is merged. Cursors next, then presence — conflict resolution stays blocked on this landing fully.",
					reactions: {},
				},
			],
		],
	]);

	const descriptions = new Map<string, string>([
		[
			T(7),
			"## Description\nMultiple people editing the same note at once, with live cursors and presence. The most-requested item on the roadmap.\n",
		],
		[
			T(18),
			"## Description\nOne search box that covers note titles and full text, ranked by relevance, with inline previews in the results.\n",
		],
	]);

	const dashboard = makeDashboard(
		"roadmap-overview",
		"Roadmap Overview",
		[
			makeWidget(
				"w-status",
				"bar",
				"Feedback by Status",
				{ chartType: "bar", groupBy: "status" },
				{ x: 0, y: 0, w: 7, h: 4 },
			),
			makeWidget(
				"w-type",
				"pie",
				"Feedback by Type",
				{ chartType: "pie", groupBy: "taskType" },
				{ x: 7, y: 0, w: 5, h: 4 },
			),
		],
		"megaphone",
	);

	return {
		projects: [editor, sync, mobile, search],
		tasks,
		comments,
		descriptions,
		dashboards: [dashboard],
	};
}

export const feedbackRoadmapTemplate: WorkspaceTemplate = {
	id: "feedback-roadmap",
	name: "Feedback Roadmap",
	description:
		"Collect feature requests and bug reports as Tasks under product areas, then move them across a public-roadmap status set.",
	icon: "megaphone",
	supportsExampleContent: true,
	workspace: { statuses, taskTypes, labels },
	views: [roadmap],
	settings: [
		settingsFromValues("Statuses", statuses),
		settingsFromValues("Priorities", DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", taskTypes),
		settingsFromValues("Labels", labels),
		plainSetting("Default view", "Board (grouped by Status)"),
	],
	buildExampleContent,
};
