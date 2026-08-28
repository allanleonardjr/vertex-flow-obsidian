/**
 * Feedback roadmap — Featurebase-style. Projects are product areas; Tasks are
 * individual pieces of feedback moving across a public-roadmap status set.
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
	const editor = makeProject(ctx, "Editor", { status: "in-progress" });
	const sync = makeProject(ctx, "Sync & Sharing", { status: "in-progress" });
	const mobile = makeProject(ctx, "Mobile Apps", { status: "planned" });

	const rank = rankSeq(9);
	const tasks = [
		makeTask(ctx, 1, rank, {
			title: "Inline code blocks with syntax highlighting",
			taskType: "feature-request",
			status: "planned",
			priority: "high",
			project: editor.path,
			labels: ["customer-request"],
		}),
		makeTask(ctx, 2, rank, {
			title: "Cursor jumps to top when pasting long text",
			taskType: "bug-report",
			status: "in-progress",
			priority: "urgent",
			project: editor.path,
			labels: ["support-escalation"],
		}),
		makeTask(ctx, 3, rank, {
			title: "Remember last-used heading level",
			taskType: "improvement",
			status: "under-review",
			priority: "low",
			project: editor.path,
			labels: ["quick-win"],
		}),
		makeTask(ctx, 4, rank, {
			title: "Real-time collaborative editing",
			taskType: "feature-request",
			status: "under-review",
			priority: "medium",
			project: sync.path,
			labels: ["customer-request"],
		}),
		makeTask(ctx, 5, rank, {
			title: "Share a read-only link to a single note",
			taskType: "feature-request",
			status: "in-progress",
			priority: "high",
			project: sync.path,
			labels: ["customer-request"],
		}),
		makeTask(ctx, 6, rank, {
			title: "Conflict resolution when two devices edit offline",
			taskType: "improvement",
			status: "planned",
			priority: "medium",
			project: sync.path,
			labels: ["internal"],
		}),
		makeTask(ctx, 7, rank, {
			title: "Widgets on the iOS home screen",
			taskType: "feature-request",
			status: "shipped",
			priority: "medium",
			project: mobile.path,
			labels: ["quick-win"],
		}),
		makeTask(ctx, 8, rank, {
			title: "Android tablet split-view layout",
			taskType: "feature-request",
			status: "under-review",
			priority: "low",
			project: mobile.path,
			labels: ["customer-request"],
		}),
		makeTask(ctx, 9, rank, {
			title: "Drop support for iOS 15",
			taskType: "improvement",
			status: "declined",
			priority: "low",
			project: mobile.path,
			labels: ["internal"],
		}),
	];

	return { projects: [editor, sync, mobile], tasks };
}

export const feedbackRoadmapTemplate: WorkspaceTemplate = {
	id: "feedback-roadmap",
	name: "Feedback Roadmap",
	description:
		"Collect feature requests and bug reports as Tasks under product areas, then move them across a public-roadmap status set.",
	icon: "megaphone",
	defaultIdPrefix: "FDB",
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
