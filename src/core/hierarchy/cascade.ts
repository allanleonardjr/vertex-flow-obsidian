/**
 * Deletion & cascade policy.
 *
 * The rule that shapes this entire module: **one level of nesting at a time.**
 * A dialog never reasons about more than one level. Deleting a Project and
 * choosing "cascade" does not silently wipe out its tasks' sub-tasks — each
 * task that has children comes back as its own follow-up plan, and asks its
 * own question.
 */

import {
	childTasks,
	topLevelProjectTasks,
	type HierarchyScope,
} from "./resolve";
import type { LinkTarget, Project, Task } from "../types";

export type DeletableKind = "task" | "project";

/** What the user may choose in the confirmation dialog. */
export type DeletionChoice = "cancel" | "unparent" | "cascade";

/** One frontmatter field to clear on one note, produced by "unparent". */
export interface FieldEdit {
	path: LinkTarget;
	field: "parent" | "project";
	value: null;
}

export interface DeletionPlan {
	kind: DeletableKind;
	path: LinkTarget;
	title: string;
	/** Direct children only — never grandchildren. */
	childTasks: Task[];
	/** False when there is nothing underneath: delete without a dialog. */
	hasChildren: boolean;
	/** The choices worth offering. Always includes `cancel`. */
	options: DeletionChoice[];
}

/** The effect of a confirmed choice. */
export interface DeletionOutcome {
	/** Notes to delete right now. */
	deletePaths: LinkTarget[];
	/** Frontmatter edits to apply (children losing their parent reference). */
	edits: FieldEdit[];
	/**
	 * Further deletions that each need their own dialog. This is how the
	 * one-level-at-a-time rule is enforced structurally rather than by
	 * convention — a cascade cannot reach past the next level even if it wanted.
	 */
	followUps: DeletionPlan[];
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export function planTaskDeletion(scope: HierarchyScope, task: Task): DeletionPlan {
	return makePlan("task", task.path, task.title, childTasks(scope, task.path));
}

export function planProjectDeletion(
	scope: HierarchyScope,
	project: Project,
): DeletionPlan {
	// Direct hierarchical children only (the one-level-at-a-time rule). A
	// nested sub-task that merely carries this project as denormalized metadata
	// is a child of its parent *task*, not of the project — it isn't part of
	// this cascade/unparent choice. `danglingProjectEdits` tidies its stale
	// `project` link afterwards, silently.
	return makePlan(
		"project",
		project.path,
		project.title,
		topLevelProjectTasks(scope, project.path),
	);
}

function makePlan(
	kind: DeletableKind,
	path: LinkTarget,
	title: string,
	tasks: Task[],
): DeletionPlan {
	const hasChildren = tasks.length > 0;
	return {
		kind,
		path,
		title,
		childTasks: tasks,
		hasChildren,
		options: hasChildren
			? ["cancel", "unparent", "cascade"]
			: ["cancel", "cascade"],
	};
}

/** Dispatch on entity kind, so the UI has one entry point for any deletion. */
export function planDeletion(
	scope: HierarchyScope,
	entity: Task | Project,
): DeletionPlan {
	switch (entity.type) {
		case "task":
			return planTaskDeletion(scope, entity);
		case "project":
			return planProjectDeletion(scope, entity);
	}
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Turn a confirmed choice into concrete work.
 *
 * - `cancel`   → nothing happens.
 * - `unparent` → children lose only their reference to the deleted entity. A
 *                task under a deleted project is *not* re-pointed anywhere —
 *                inventing a new parent is a hierarchy decision the user didn't
 *                make.
 * - `cascade`  → the entity and its childless children go now; any child that
 *                itself has children returns as a follow-up plan.
 */
export function applyDeletion(
	scope: HierarchyScope,
	plan: DeletionPlan,
	choice: DeletionChoice,
): DeletionOutcome {
	if (choice === "cancel") {
		return { deletePaths: [], edits: [], followUps: [] };
	}

	if (choice === "unparent") {
		return {
			deletePaths: [plan.path],
			edits: unparentEdits(plan),
			followUps: [],
		};
	}

	const deletePaths: LinkTarget[] = [plan.path];
	const followUps: DeletionPlan[] = [];

	for (const child of plan.childTasks) {
		const childPlan = planTaskDeletion(scope, child);
		if (childPlan.hasChildren) followUps.push(childPlan);
		else deletePaths.push(child.path);
	}

	return { deletePaths, edits: [], followUps };
}

/** Which field each kind of child clears when unparented. */
function unparentEdits(plan: DeletionPlan): FieldEdit[] {
	const field: FieldEdit["field"] = plan.kind === "task" ? "parent" : "project";

	return plan.childTasks.map((task) => ({ path: task.path, field, value: null }));
}

// ---------------------------------------------------------------------------
// Dangling references
// ---------------------------------------------------------------------------

/**
 * Relations that point at notes being deleted.
 *
 * These are *not* part of the cascade dialog — they're not hierarchy, so
 * deleting a task never prompts about the tasks that merely reference it. The
 * plugin just tidies them up afterwards so no view renders a broken link.
 */
export function danglingRelationEdits(
	scope: HierarchyScope,
	deletedPaths: Iterable<LinkTarget>,
): { path: LinkTarget; relations: Task["relations"] }[] {
	const deleted = new Set(deletedPaths);
	const out: { path: LinkTarget; relations: Task["relations"] }[] = [];

	for (const task of scope.tasks) {
		if (deleted.has(task.path)) continue;

		const relations = {
			blocks: task.relations.blocks.filter((p) => !deleted.has(p)),
			blockedBy: task.relations.blockedBy.filter((p) => !deleted.has(p)),
			related: task.relations.related.filter((p) => !deleted.has(p)),
			duplicateOf:
				task.relations.duplicateOf && deleted.has(task.relations.duplicateOf)
					? null
					: task.relations.duplicateOf,
		};

		const changed =
			relations.blocks.length !== task.relations.blocks.length ||
			relations.blockedBy.length !== task.relations.blockedBy.length ||
			relations.related.length !== task.relations.related.length ||
			relations.duplicateOf !== task.relations.duplicateOf;

		if (changed) out.push({ path: task.path, relations });
	}

	return out;
}

/**
 * Tasks whose `project` points at a note being deleted (the denormalized
 * link). Same spirit as `danglingRelationEdits`: **not** part of the cascade
 * dialog — a deep sub-task carrying a project as metadata isn't a hierarchical
 * child of it — so deleting a project never prompts about these. The plugin
 * just clears the stale link afterwards so no view renders it broken.
 *
 * Scans every task *not* already being deleted, so a top-level task that the
 * cascade handles directly (its `project` is moot) is skipped.
 */
export function danglingProjectEdits(
	scope: HierarchyScope,
	deletedPaths: Iterable<LinkTarget>,
): FieldEdit[] {
	const deleted = new Set(deletedPaths);
	const out: FieldEdit[] = [];

	for (const task of scope.tasks) {
		if (deleted.has(task.path)) continue;
		if (task.project && deleted.has(task.project)) {
			out.push({ path: task.path, field: "project", value: null });
		}
	}

	return out;
}

/** Summary line for the dialog: `"3 sub-tasks"`, `"4 tasks"`. */
export function describePlanChildren(plan: DeletionPlan): string {
	if (plan.childTasks.length === 0) return "nothing";
	const noun = plan.kind === "task" ? "sub-task" : "task";
	return `${plan.childTasks.length} ${noun}${plan.childTasks.length === 1 ? "" : "s"}`;
}
