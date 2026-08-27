/**
 * Sample workspace generator (§13).
 *
 * Built as a single reusable function on purpose: it powers the onboarding
 * "Try a Sample Workspace" path *and* doubles as fixture/seed data for tests.
 * Anything it demonstrates is therefore also something the test suite exercises.
 *
 * It emits plain note descriptions — path, frontmatter, body — and writes
 * nothing itself, so it stays inside the no-Obsidian-imports rule.
 */

import { formatTaskId } from "../ids";
import { joinPath } from "../links";
import { initialRanks, rankBefore } from "../ranking/lexorank";
import { serializeComments } from "../serialization/comments";
import { serializeCycle, serializeInitiative, serializeProject } from "../serialization/entities";
import { serializeTask } from "../serialization/task";
import { serializeViews } from "../serialization/views";
import { serializeWorkspace } from "../serialization/workspace";
import { createWorkspaceConfig } from "../serialization/workspace";
import { defaultViews } from "../views/defaults";
import {
	emptyRelations,
	type Comment,
	type Cycle,
	type Initiative,
	type Project,
	type Task,
	type WorkspaceConfig,
	type WorkspaceSnapshot,
} from "../types";

export interface GeneratedNote {
	path: string;
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface GeneratedWorkspace {
	root: string;
	workspace: WorkspaceConfig;
	notes: GeneratedNote[];
	/** The same content as a ready-to-use in-memory snapshot, for tests. */
	snapshot: WorkspaceSnapshot;
}

export interface SampleOptions {
	root: string;
	name?: string;
	idPrefix?: string;
	/** Injectable clock so generated fixtures are deterministic in tests. */
	now?: Date;
}

const DAY = 24 * 60 * 60 * 1000;

export function generateSampleWorkspace(
	options: SampleOptions,
): GeneratedWorkspace {
	const root = options.root;
	const name = options.name ?? "Sample Workspace";
	const prefix = (options.idPrefix ?? "SMP").toUpperCase();
	const now = options.now ?? new Date();
	const iso = (offsetDays: number) =>
		new Date(now.getTime() + offsetDays * DAY).toISOString();
	const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);

	// --- Workspace config -----------------------------------------------------

	const workspace: WorkspaceConfig = {
		...createWorkspaceConfig(name, prefix, root),
		// The sample turns cycles on so the feature is discoverable. Real new
		// workspaces still start with them off (§7.5).
		cycles: { enabled: true, termLabel: "Cycle", rolloverPolicy: "auto-rollover" },
		labels: [
			{ id: "performance", name: "Performance", color: "#f97316" },
			{ id: "design", name: "Design", color: "#a855f7" },
			{ id: "docs", name: "Docs", color: "#06b6d4" },
		],
		people: [
			{ id: "alice", name: "Alice", aliases: ["al"], isSelf: true },
			{ id: "bob", name: "Bob", aliases: [], isSelf: false },
		],
	};

	// --- Paths ----------------------------------------------------------------

	const initiativePath = joinPath(root, "Initiatives", "Launch Mobile App");
	const coreProjectPath = joinPath(root, "Projects", "Core App Experience");
	const launchProjectPath = joinPath(root, "Projects", "App Store Launch");
	const cyclePath = joinPath(root, "Cycles", `${now.getFullYear()}-Cycle-18`);
	const taskPath = (n: number) => joinPath(root, "Tasks", formatTaskId(prefix, n));

	// --- Entities -------------------------------------------------------------

	const initiative: Initiative = {
		type: "initiative",
		title: "Launch Mobile App (v1.0)",
		status: "in-progress",
		archived: false,
		archivedAt: null,
		createdAt: iso(-40),
		updatedAt: iso(-2),
		path: initiativePath,
	};

	const projects: Project[] = [
		{
			type: "project",
			title: "Core App Experience",
			status: "in-progress",
			initiative: initiativePath,
			archived: false,
			archivedAt: null,
			createdAt: iso(-38),
			updatedAt: iso(-1),
			path: coreProjectPath,
		},
		{
			type: "project",
			// Deliberately "Planned" while its tasks are already moving —
			// demonstrating that status and progress never auto-sync (§7.1).
			title: "App Store Launch & Marketing",
			status: "queue",
			initiative: initiativePath,
			archived: false,
			archivedAt: null,
			createdAt: iso(-30),
			updatedAt: iso(-5),
			path: launchProjectPath,
		},
	];

	const cycle: Cycle = {
		type: "cycle",
		title: `${now.getFullYear()}-Cycle-18`,
		startDate: day(-7),
		endDate: day(7),
		status: "active",
		createdAt: iso(-7),
		updatedAt: iso(-7),
		path: cyclePath,
	};

	// --- Tasks ----------------------------------------------------------------

	const ranks = initialRanks(9);
	let rankIndex = 0;
	const nextRank = () => ranks[rankIndex++];

	const base = (n: number, overrides: Partial<Task>): Task => ({
		type: "task",
		id: formatTaskId(prefix, n),
		title: "",
		taskType: null,
		status: "queue",
		priority: "medium",
		rank: nextRank(),
		cycleRank: null,
		project: null,
		initiative: null,
		parent: null,
		cycle: null,
		assignee: null,
		estimate: null,
		labels: [],
		startDate: null,
		dueDate: null,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: iso(-10),
		updatedAt: iso(-1),
		path: taskPath(n),
		mentions: [],
		...overrides,
	});

	const tasks: Task[] = [
		// A parent task with sub-tasks → demonstrates the progress bar (§7.2).
		base(101, {
			title: "Rebuild the onboarding flow",
			taskType: "feature",
			status: "in-progress",
			priority: "high",
			project: coreProjectPath,
			cycle: cyclePath,
			assignee: "alice",
			estimate: 5,
			labels: ["design"],
			startDate: day(-5),
			dueDate: day(4),
		}),
		base(102, {
			title: "Design the welcome screen",
			taskType: "feature",
			status: "done",
			priority: "medium",
			project: coreProjectPath,
			parent: taskPath(101),
			cycle: cyclePath,
			assignee: "alice",
			labels: ["design"],
		}),
		base(103, {
			title: "Wire up account creation",
			taskType: "feature",
			status: "in-progress",
			priority: "high",
			project: coreProjectPath,
			parent: taskPath(101),
			cycle: cyclePath,
			assignee: "bob",
		}),

		// The blocked/blocking pair → demonstrates relations (§7.3).
		base(104, {
			title: "Fix LexoRank calculation when moving tasks into empty columns",
			taskType: "bug",
			status: "in-progress",
			priority: "urgent",
			project: coreProjectPath,
			cycle: cyclePath,
			assignee: "alice",
			estimate: 3,
			labels: ["performance"],
			dueDate: day(2),
			relations: {
				blocks: [],
				blockedBy: [taskPath(105)],
				related: [],
				duplicateOf: null,
			},
			// A cycleRank override → the one legitimate per-context order (§6).
			// This task sits 4th by global `rank` but leads the cycle board.
			cycleRank: rankBefore(ranks[0]),
		}),
		base(105, {
			title: "Add regression tests for the ranking engine",
			taskType: "chore",
			status: "todo",
			priority: "high",
			project: coreProjectPath,
			cycle: cyclePath,
			assignee: "bob",
			relations: {
				blocks: [taskPath(104)],
				blockedBy: [],
				related: [],
				duplicateOf: null,
			},
		}),

		base(106, {
			title: "Draft App Store listing copy",
			taskType: "chore",
			status: "todo",
			priority: "medium",
			project: launchProjectPath,
			assignee: "alice",
			labels: ["docs"],
			dueDate: day(10),
		}),
		base(107, {
			title: "Capture screenshots for the store listing",
			taskType: "chore",
			status: "queue",
			priority: "low",
			project: launchProjectPath,
			labels: ["docs", "design"],
		}),

		// Attached straight to the Initiative, skipping the Project level (§2).
		base(108, {
			title: "Agree the launch date with the whole team",
			taskType: "chore",
			status: "todo",
			priority: "urgent",
			initiative: initiativePath,
			assignee: "alice",
		}),

		// No parent at all, and archived → demonstrates both (§2, §7.7).
		base(109, {
			title: "Spike: evaluate offline sync options",
			taskType: "chore",
			status: "canceled",
			priority: "low",
			archived: true,
			archivedAt: iso(-3),
		}),
	];

	// --- Comments -------------------------------------------------------------

	const commentsByPath = new Map<string, Comment[]>([
		[
			taskPath(104),
			[
				{
					id: "cmt_01",
					author: "alice",
					date: iso(-1),
					body: "Traced this to the boundary check: we need a fallback when `prevRank` and `nextRank` are both undefined.",
					reactions: { "👍": 2, "🚀": 1 },
				},
				{
					id: "cmt_02",
					author: "bob",
					date: iso(-1),
					body: "@alice I can take the fix. Ship it this cycle or push to the next one?",
					reactions: { "❤️": 1 },
				},
			],
		],
		[
			taskPath(101),
			[
				{
					id: "cmt_01",
					author: "bob",
					date: iso(-2),
					body: "@alice the welcome screen is done — account creation is the last piece.",
					reactions: {},
				},
			],
		],
	]);

	// Mentions are derived from comment bodies, exactly as the indexer does it.
	for (const task of tasks) {
		const comments = commentsByPath.get(task.path) ?? [];
		const mentioned = new Set<string>();
		for (const comment of comments) {
			for (const person of workspace.people) {
				if (comment.body.toLowerCase().includes(`@${person.id.toLowerCase()}`)) {
					mentioned.add(person.id);
				}
			}
		}
		task.mentions = [...mentioned];
	}

	// --- Notes ----------------------------------------------------------------

	const descriptions = new Map<string, string>([
		[
			taskPath(104),
			"## Description\nDragging a task into an empty column fails to evaluate neighbouring ranks.\n\n### Steps to Reproduce\n1. Create a fresh column with 0 tasks.\n2. Drag a task into the empty column.\n3. Observe the console error.\n",
		],
		[
			taskPath(101),
			"## Description\nThe current onboarding drops people straight into an empty vault with no explanation.\n",
		],
	]);

	const notes: GeneratedNote[] = [
		{
			path: joinPath(root, "_workspace"),
			frontmatter: serializeWorkspace(workspace),
			body: "",
		},
		{
			path: joinPath(root, "_views"),
			frontmatter: serializeViews(defaultViews()),
			body: "",
		},
		{
			path: initiative.path,
			frontmatter: serializeInitiative(initiative),
			body: "## Overview\nShip version 1.0 of the mobile app to both stores.\n",
		},
		...projects.map((project) => ({
			path: project.path,
			frontmatter: serializeProject(project),
			body: `## Overview\n${project.title}.\n`,
		})),
		{
			path: cycle.path,
			frontmatter: serializeCycle(cycle),
			body: "## Goal\nGet onboarding and the ranking fix shipped.\n\n## Retro\n",
		},
		...tasks.map((task) => {
			const description = descriptions.get(task.path) ?? "";
			const comments = commentsByPath.get(task.path) ?? [];
			const block = serializeComments(comments);
			return {
				path: task.path,
				frontmatter: serializeTask(task),
				body: block ? `${description}\n${block}\n` : description,
			};
		}),
	];

	return {
		root,
		workspace,
		notes,
		snapshot: {
			workspace,
			tasks,
			projects,
			initiatives: [initiative],
			cycles: [cycle],
			views: defaultViews(),
		},
	};
}

/** Shorthand used throughout the unit tests. */
export function sampleSnapshot(root = "Sample"): WorkspaceSnapshot {
	return generateSampleWorkspace({
		root,
		idPrefix: "SMP",
		now: new Date("2026-08-26T12:00:00Z"),
	}).snapshot;
}
