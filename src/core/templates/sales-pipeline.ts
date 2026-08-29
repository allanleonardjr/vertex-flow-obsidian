/**
 * Sales pipeline — one Project per deal, Tasks are the activities that move it
 * forward. Priorities are relabelled as deal temperature (Hot/Warm/Cold).
 *
 * The example content is a full feature showcase: five deals at different
 * stages (one Won, one Lost), two multi-step activities broken into sub-tasks,
 * a blocked dependency (proposal ← confirmed budget), pipeline-wide un-parented
 * tasks, archived activity from closed deals, every label used more than once,
 * and a seeded dashboard.
 */

import { DEFAULT_TASK_TYPES } from "../taxonomy/defaults";
import type { Comment, LabelValue, PriorityValue, StatusValue } from "../types";
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
		createdAt: ctx.iso(-30),
	});
	const globex = makeProject(ctx, "Globex — Team Plan", {
		status: "qualified",
		createdAt: ctx.iso(-24),
	});
	const initech = makeProject(ctx, "Initech — Pilot", {
		status: "contacted",
		createdAt: ctx.iso(-16),
	});
	const hooli = makeProject(ctx, "Hooli — Startup Plan", {
		status: "won",
		createdAt: ctx.iso(-40),
		updatedAt: ctx.iso(-8),
	});
	const umbrella = makeProject(ctx, "Umbrella Health — Multi-year", {
		status: "lost",
		createdAt: ctx.iso(-45),
		updatedAt: ctx.iso(-12),
	});

	const rank = rankSeq(25);
	const T = (n: number) => ctx.taskPath(n);

	const tasks = [
		// --- Acme Corp: hierarchy #1 (~33% done).
		makeTask(ctx, 1, rank, {
			title: "Send proposal and pricing",
			status: "won",
			priority: "hot",
			project: acme.path,
			labels: ["inbound"],
			dueDate: ctx.day(-5),
			createdAt: ctx.iso(-22),
		}),
		makeTask(ctx, 2, rank, {
			title: "Follow up on the proposal",
			status: "proposal-sent",
			priority: "hot",
			project: acme.path,
			dueDate: ctx.day(2),
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 3, rank, {
			title: "Run the security review",
			status: "qualified",
			priority: "warm",
			project: acme.path,
			labels: ["inbound"],
			startDate: ctx.day(-8),
			dueDate: ctx.day(6),
			createdAt: ctx.iso(-18),
		}),
		makeTask(ctx, 4, rank, {
			title: "Complete the SIG security questionnaire",
			status: "won",
			priority: "warm",
			project: acme.path,
			parent: T(3),
			createdAt: ctx.iso(-17),
		}),
		makeTask(ctx, 5, rank, {
			title: "Schedule the pen-test review call",
			status: "proposal-sent",
			priority: "warm",
			project: acme.path,
			parent: T(3),
			dueDate: ctx.day(4),
			createdAt: ctx.iso(-12),
		}),
		makeTask(ctx, 6, rank, {
			title: "Redline the MSA with legal",
			status: "qualified",
			priority: "cold",
			project: acme.path,
			parent: T(3),
			labels: ["inbound"],
			createdAt: ctx.iso(-9),
		}),

		// --- Globex: hierarchy #2 (~67% done) + the blocked dependency.
		makeTask(ctx, 7, rank, {
			title: "Discovery call with the ops lead",
			status: "won",
			priority: "warm",
			project: globex.path,
			labels: ["referral"],
			createdAt: ctx.iso(-22),
		}),
		makeTask(ctx, 8, rank, {
			title: "Scope a 20-seat rollout",
			status: "qualified",
			priority: "warm",
			project: globex.path,
			labels: ["referral"],
			startDate: ctx.day(-5),
			dueDate: ctx.day(10),
			createdAt: ctx.iso(-20),
		}),
		makeTask(ctx, 9, rank, {
			title: "Map their current toolset",
			status: "won",
			priority: "warm",
			project: globex.path,
			parent: T(8),
			createdAt: ctx.iso(-19),
		}),
		makeTask(ctx, 10, rank, {
			title: "Estimate the migration effort",
			status: "won",
			priority: "cold",
			project: globex.path,
			parent: T(8),
			createdAt: ctx.iso(-15),
		}),
		makeTask(ctx, 11, rank, {
			title: "Draft the rollout timeline",
			status: "qualified",
			priority: "warm",
			project: globex.path,
			parent: T(8),
			createdAt: ctx.iso(-11),
		}),
		makeTask(ctx, 12, rank, {
			title: "Confirm budget and timeline",
			status: "contacted",
			priority: "warm",
			project: globex.path,
			dueDate: ctx.day(5),
			createdAt: ctx.iso(-8),
			relations: { blocks: [T(13)], blockedBy: [], related: [], duplicateOf: null },
		}),
		makeTask(ctx, 13, rank, {
			title: "Send proposal and pricing",
			status: "lead",
			priority: "warm",
			project: globex.path,
			labels: ["referral"],
			createdAt: ctx.iso(-7),
			relations: { blocks: [], blockedBy: [T(12)], related: [], duplicateOf: null },
		}),

		// --- Initech.
		makeTask(ctx, 14, rank, {
			title: "Intro email from the partner team",
			status: "won",
			priority: "cold",
			project: initech.path,
			labels: ["partner"],
			createdAt: ctx.iso(-14),
		}),
		makeTask(ctx, 15, rank, {
			title: "Book a first demo",
			status: "contacted",
			priority: "cold",
			project: initech.path,
			labels: ["outbound"],
			dueDate: ctx.day(3),
			createdAt: ctx.iso(-10),
		}),
		makeTask(ctx, 16, rank, {
			title: "Send a case study from a similar customer",
			status: "lead",
			priority: "cold",
			project: initech.path,
			labels: ["partner", "outbound"],
			createdAt: ctx.iso(-6),
		}),
		makeTask(ctx, 17, rank, {
			title: "Add to the Q3 nurture sequence",
			status: "contacted",
			priority: "cold",
			project: initech.path,
			labels: ["outbound"],
			createdAt: ctx.iso(-4),
		}),

		// --- Hooli: a closed-won deal — its activity is archived.
		makeTask(ctx, 18, rank, {
			title: "Negotiate the annual contract",
			status: "won",
			priority: "hot",
			project: hooli.path,
			labels: ["inbound"],
			createdAt: ctx.iso(-38),
		}),
		makeTask(ctx, 19, rank, {
			title: "Countersign and send the order form",
			status: "won",
			priority: "hot",
			project: hooli.path,
			archived: true,
			archivedAt: ctx.iso(-9),
			createdAt: ctx.iso(-34),
		}),
		makeTask(ctx, 20, rank, {
			title: "Hand off to the customer success team",
			status: "won",
			priority: "warm",
			project: hooli.path,
			archived: true,
			archivedAt: ctx.iso(-8),
			createdAt: ctx.iso(-30),
		}),

		// --- Umbrella Health: a lost deal.
		makeTask(ctx, 21, rank, {
			title: "Final pricing negotiation with procurement",
			status: "lost",
			priority: "warm",
			project: umbrella.path,
			labels: ["referral"],
			archived: true,
			archivedAt: ctx.iso(-12),
			createdAt: ctx.iso(-40),
		}),
		makeTask(ctx, 22, rank, {
			title: "Send the 'sorry we missed it' follow-up",
			status: "lost",
			priority: "cold",
			project: umbrella.path,
			labels: ["outbound"],
			createdAt: ctx.iso(-11),
		}),

		// --- Pipeline-wide work, not attached to any one deal.
		makeTask(ctx, 23, rank, {
			title: "Refresh the standard proposal template",
			status: "contacted",
			priority: "warm",
			labels: ["inbound"],
			dueDate: ctx.day(9),
			createdAt: ctx.iso(-5),
		}),
		makeTask(ctx, 24, rank, {
			title: "Clean up stale leads in the CRM",
			status: "lead",
			priority: "cold",
			createdAt: ctx.iso(-3),
		}),
		makeTask(ctx, 25, rank, {
			title: "Prep the Q3 pipeline review deck",
			status: "qualified",
			priority: "warm",
			labels: ["outbound"],
			startDate: ctx.day(-2),
			dueDate: ctx.day(7),
			createdAt: ctx.iso(-2),
		}),
	];

	const comments = new Map<string, Comment[]>([
		[
			T(2),
			[
				{
					id: "cmt_01",
					author: "dana",
					date: ctx.iso(-1),
					body: "Champion says legal is the only blocker. Chasing their counsel for a call this week.",
					reactions: { "🤞": 1 },
				},
			],
		],
		[
			T(12),
			[
				{
					id: "cmt_01",
					author: "dana",
					date: ctx.iso(-2),
					body: "Budget is approved for the fiscal year but the number isn't confirmed — proposal stays on hold until it is.",
					reactions: {},
				},
			],
		],
	]);

	const descriptions = new Map<string, string>([
		[
			T(3),
			"## Description\nEnterprise security review: SIG questionnaire, a pen-test walkthrough, and MSA redlines. All three have to clear before the proposal can be signed.\n",
		],
	]);

	const dashboard = makeDashboard(
		"pipeline-health",
		"Pipeline Health",
		[
			makeWidget(
				"w-proposals",
				"kpi",
				"Proposals out",
				{ chartType: "kpi", metric: "count", scope: { field: "status", value: "proposal-sent" } },
				{ x: 0, y: 0, w: 3, h: 3 },
			),
			makeWidget(
				"w-temp",
				"pie",
				"Activities by Temperature",
				{ chartType: "pie", groupBy: "priority" },
				{ x: 3, y: 0, w: 5, h: 4 },
			),
			makeWidget(
				"w-flow",
				"timeline",
				"Pipeline Flow by Close Month",
				{
					chartType: "timeline",
					xField: "dueDate",
					bucket: "month",
					groupBy: "status",
				},
				{ x: 0, y: 4, w: 12, h: 4 },
			),
		],
		"handshake",
	);

	return {
		projects: [acme, globex, initech, hooli, umbrella],
		tasks,
		comments,
		descriptions,
		dashboards: [dashboard],
	};
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
