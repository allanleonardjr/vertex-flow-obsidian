/**
 * Demo log for a brand-new, history-enabled workspace.
 *
 * A template checkbox ("Start with activity history on") plus example content
 * produces a log that demonstrates the hub on first open instead of an empty
 * folder: workspace config toggling history on, each scaffolded Saved View,
 * Dashboard, Project and Task arriving, then a few *follow-ups* that show the
 * fun parts of the Feed — a bulk status change (aggregated to "×N"), an
 * individual status advance, a priority bump, and a comment.
 *
 * Everything here is authored by the machine — `SYSTEM_ACTOR_NAME`, a bracketed
 * handle nobody would type into a People field — because these entries record
 * the *scaffold*, not the owner, and a fresh workspace has nobody to credit
 * anyway. Pure core code: no Obsidian API, returns plain `HistoryEntry`s for
 * the glue layer to append.
 */

import { joinPath } from "../links";
import { SYSTEM_ACTOR_NAME } from "./index";
import type {
	DashboardConfig,
	HistoryChange,
	HistoryEntry,
	HistoryTarget,
	Project,
	SavedView,
	Task,
	WorkspaceConfig,
} from "../types";

const SYSTEM_ACTOR: HistoryEntry["actor"] = {
	kind: "system",
	name: SYSTEM_ACTOR_NAME,
};

export interface SeedHistoryInput {
	workspace: WorkspaceConfig;
	/** Saved Views the scaffold emits (system views excluded). */
	views: SavedView[];
	dashboards: DashboardConfig[];
	tasks: Task[];
	projects: Project[];
	/** The moment the workspace is scaffolded; seed timestamps build on it. */
	now: Date;
}

/**
 * Build the onboarding log for a workspace created with history enabled and
 * example content. Entries are oldest-first with strictly chronological,
 * second-distinct timestamps — a single running cursor, so no template's count
 * of views/projects/tasks can ever interleave the timeline. The whole batch
 * appends straight into the creating device's stream file unchanged.
 */
export function seedHistory(input: SeedHistoryInput): HistoryEntry[] {
	const { workspace, now } = input;
	const at = (s: number) => new Date(now.getTime() + s * 1000).toISOString();

	// Same shapes the mutations layer emits, so the Feed renders these
	// identically to live actions. The `_workspace` path is the config note.
	const workspaceTarget: HistoryTarget = {
		kind: "workspace",
		id: workspace.root,
		path: joinPath(workspace.root, "_workspace"),
	};
	const taskTarget = (task: Task): HistoryTarget => ({
		kind: "task",
		id: task.id,
		path: task.path,
	});
	const projectTarget = (project: Project): HistoryTarget => ({
		kind: "project",
		id: project.title,
		path: project.path,
	});
	const viewTarget = (view: SavedView): HistoryTarget => ({
		kind: "view",
		id: view.id,
		path: view.path,
	});
	const dashboardTarget = (dashboard: DashboardConfig): HistoryTarget => ({
		kind: "dashboard",
		id: dashboard.id,
		path: dashboard.path,
	});

	const entries: HistoryEntry[] = [];
	let t = 0; // monotonic second-cursor shared by every group below
	const push = (
		action: string,
		targets: HistoryTarget[],
		changes?: HistoryChange[],
	) => {
		entries.push({
			ts: at(t++),
			actor: SYSTEM_ACTOR,
			action,
			workspace: workspace.root,
			targets,
			...(changes?.length ? { changes } : {}),
		});
	};

	const tasks = input.tasks;

	// 1. History was just switched on for this workspace.
	push("workspace.config.update", [workspaceTarget], [
		{ field: "history.enabled", to: true },
	]);

	// 2. The scaffolded Saved Views (mirrors `addView` — target only).
	for (const view of input.views) push("view.create", [viewTarget(view)]);
	// 3. …and Dashboards (mirrors `addDashboard` — target only).
	for (const dashboard of input.dashboards) {
		push("dashboard.create", [dashboardTarget(dashboard)]);
	}
	// 4. The template's example Projects, then Tasks (with a title delta each).
	input.projects.forEach((project) => {
		push("project.create", [projectTarget(project)], [
			{ field: "title", to: project.title },
		]);
	});
	tasks.forEach((task) => {
		push("task.create", [taskTarget(task)], [
			{ field: "title", to: task.title },
		]);
	});

	// 5. A multi-select "set status" — real `task.bulk-update` entries carry
	//    one delta per task, and the hub aggregates identical triples to "×3".
	const started = workspace.statuses.find((s) => s.category === "started");
	if (started && tasks.length >= 3) {
		const first = tasks.slice(0, 3);
		push(
			"task.bulk-update",
			first.map(taskTarget),
			first.map((task) => ({
				field: "status",
				from: task.status ?? undefined,
				to: started.id,
			})),
		);
	}

	// 6. The last task carried through to Done — an individual field delta.
	const completed = workspace.statuses.find((s) => s.category === "completed");
	if (completed && tasks.length > 0) {
		const task = tasks[tasks.length - 1];
		push("task.update", [taskTarget(task)], [
			{ field: "status", from: task.status ?? undefined, to: completed.id },
		]);
	}

	// 7. A priority bump on the first task — proves more than status diffs render.
	if (workspace.priorities.length >= 2 && tasks.length > 0) {
		const task = tasks[0];
		push("task.update", [taskTarget(task)], [
			{
				field: "priority",
				from: task.priority ?? null,
				to: workspace.priorities[0].id,
			},
		]);
	}

	// 8. A comment on the first task, so the Feed's comment flavour shows too.
	if (tasks.length > 0) {
		push("comment.add", [taskTarget(tasks[0])], [{ field: "comment" }]);
	}

	return entries;
}