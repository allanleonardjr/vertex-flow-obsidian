/**
 * Sales pipeline — one Project per deal, Tasks are the activities that move it
 * forward. Priorities are relabelled as deal temperature (Hot/Warm/Cold).
 */

import { DEFAULT_TASK_TYPES } from "../taxonomy/defaults";
import type { LabelValue, PriorityValue, StatusValue } from "../types";
import { makeProject, makeTask, makeView, rankSeq } from "./helpers";
import {
	plainSetting,
	settingsFromValues,
	type TemplateBuildContext,
	type TemplateContent,
	type WorkspaceTemplate,
} from "./types";

const statuses: StatusValue[] = [
	{ id: "lead", name: "Lead", color: "#94a3b8", category: "backlog", order: 1 },
	{ id: "contacted", name: "Contacted", color: "#60a5fa", category: "unstarted", order: 2 },
	{ id: "qualified", name: "Qualified", color: "#fbbf24", category: "started", order: 3 },
	{ id: "proposal-sent", name: "Proposal Sent", color: "#f59e0b", category: "started", order: 4 },
	{ id: "won", name: "Won", color: "#34d399", category: "completed", order: 5 },
	{ id: "lost", name: "Lost", color: "#f87171", category: "canceled", order: 6 },
];

const priorities: PriorityValue[] = [
	{ id: "hot", name: "Hot", color: "#ef4444", order: 1 },
	{ id: "warm", name: "Warm", color: "#f97316", order: 2 },
	{ id: "cold", name: "Cold", color: "#60a5fa", order: 3 },
];

const labels: LabelValue[] = [
	{ id: "referral", name: "Referral", color: "#22c55e" },
	{ id: "inbound", name: "Inbound", color: "#3b82f6" },
	{ id: "outbound", name: "Outbound", color: "#a855f7" },
	{ id: "partner", name: "Partner", color: "#14b8a6" },
];

const pipeline = makeView("pipeline", "Pipeline", {
	icon: "kanban",
	viewType: "board",
	groupBy: "status",
});

function buildExampleContent(ctx: TemplateBuildContext): TemplateContent {
	const acme = makeProject(ctx, "Acme Corp — Enterprise Plan", {
		status: "proposal-sent",
	});
	const globex = makeProject(ctx, "Globex — Team Plan", { status: "qualified" });
	const initech = makeProject(ctx, "Initech — Pilot", { status: "contacted" });

	const rank = rankSeq(9);
	const tasks = [
		makeTask(ctx, 1, rank, {
			title: "Send proposal and pricing",
			status: "won",
			priority: "hot",
			project: acme.path,
			labels: ["inbound"],
			dueDate: ctx.day(-2),
		}),
		makeTask(ctx, 2, rank, {
			title: "Follow up on proposal",
			status: "proposal-sent",
			priority: "hot",
			project: acme.path,
			dueDate: ctx.day(2),
		}),
		makeTask(ctx, 3, rank, {
			title: "Loop in their security team for review",
			status: "contacted",
			priority: "warm",
			project: acme.path,
			labels: ["inbound"],
		}),
		makeTask(ctx, 4, rank, {
			title: "Discovery call with the ops lead",
			status: "won",
			priority: "warm",
			project: globex.path,
			labels: ["referral"],
		}),
		makeTask(ctx, 5, rank, {
			title: "Scope a 20-seat rollout",
			status: "qualified",
			priority: "warm",
			project: globex.path,
		}),
		makeTask(ctx, 6, rank, {
			title: "Confirm budget and timeline",
			status: "contacted",
			priority: "warm",
			project: globex.path,
			dueDate: ctx.day(5),
		}),
		makeTask(ctx, 7, rank, {
			title: "Intro email from the partner team",
			status: "won",
			priority: "cold",
			project: initech.path,
			labels: ["partner"],
		}),
		makeTask(ctx, 8, rank, {
			title: "Book a first demo",
			status: "contacted",
			priority: "cold",
			project: initech.path,
			labels: ["outbound"],
		}),
		makeTask(ctx, 9, rank, {
			title: "Qualify against our ICP",
			status: "lead",
			priority: "cold",
			project: initech.path,
		}),
	];

	return { projects: [acme, globex, initech], tasks };
}

export const salesPipelineTemplate: WorkspaceTemplate = {
	id: "sales-pipeline",
	name: "Sales Pipeline",
	description:
		"Track deals as Projects moving from Lead to Won, with the activities to close each one as Tasks underneath.",
	icon: "handshake",
	defaultIdPrefix: "DEAL",
	workspace: { statuses, priorities, labels },
	views: [pipeline],
	settings: [
		settingsFromValues("Statuses", statuses),
		settingsFromValues("Priorities", priorities),
		settingsFromValues("Task Types", DEFAULT_TASK_TYPES),
		settingsFromValues("Labels", labels),
		plainSetting("Default view", "Board (grouped by Status)"),
	],
	buildExampleContent,
};
