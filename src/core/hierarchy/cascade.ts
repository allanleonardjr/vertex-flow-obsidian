/**
 * Deletion & cascade policy (§7.8).
 *
 * The rule that shapes this entire module: **one level of nesting at a time.**
 * A dialog never reasons about more than one level. Deleting an Initiative and
 * choosing "cascade" does not silently wipe out its projects' tasks — each
 * project that has children comes back as its own follow-up plan, and asks its
 * own question.
 */

import {
	childTasks,
	initiativeDirectTasks,
	initiativeProjects,
	projectTasks,
	type HierarchyScope,
} from "./resolve";
import type { Initiative, LinkTarget, Project, Task } from "../types";

export type DeletableKind = "task" | "project" | "initiative";

/** What the user may choose in the confirmation dialog. */
export type DeletionChoice = "cancel" | "unparent" | "cascade";

/** One frontmatter field to clear on one note, produced by "unparent". */
export interface FieldEdit {
	path: LinkTarget;
	field: "parent" | "project" | "initiative" | "cycle";
	value: null;
}

export interface DeletionPlan {
	kind: DeletableKind;
	path: LinkTarget;
	title: string;
	/** Direct children only — never grandchildren. */
	childTasks: Task[];
	childProjects: Project[];
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
	const children = childTasks(scope, task.path);
	return makePlan("task", task.path, task.title, children, []);
}

export function planProjectDeletion(
	scope: HierarchyScope,
	project: Project,
): DeletionPlan {
	const tasks = projectTasks(scope, project.path);
	return makePlan("project", project.path, project.title, tasks, []);
}

export function planInitiativeDeletion(
	scope: HierarchyScope,
	initiative: Initiative,
): DeletionPlan {
	// An initiative's direct children are its projects *and* any tasks attached
	// straight to it (§2 allows a task to skip the project level entirely).
	const projects = initiativeProjects(scope, initiative.path);
	const tasks = initiativeDirectTasks(scope, initiative.path);
	return makePlan("initiative", initiative.path, initiative.title, tasks, projects);
}

function makePlan(
	kind: DeletableKind,
	path: LinkTarget,
	title: string,
	tasks: Task[],
	projects: Project[],
): DeletionPlan {
	const hasChildren = tasks.length > 0 || projects.length > 0;
	return {
		kind,
		path,
		title,
		childTasks: tasks,
		childProjects: projects,
		hasChildren,
		options: hasChildren
			? ["cancel", "unparent", "cascade"]
			: ["cancel", "cascade"],
	};
}

/** Dispatch on entity kind, so the UI has one entry point for any deletion. */
export function planDeletion(
	scope: HierarchyScope,
	entity: Task | Project | Initiative,
): DeletionPlan {
	switch (entity.type) {
		case "task":
			return planTaskDeletion(scope, entity);
		case "project":
			return planProjectDeletion(scope, entity);
		case "initiative":
			return planInitiativeDeletion(scope, entity);
	}
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Turn a confirmed choice into concrete work.
 *
 * - `cancel`   → nothing happens.
 * - `unparent` → children lose only their reference to the deleted entity. They
 *                are *not* re-pointed at the grandparent: silently promoting a
 *                task into its project's initiative would be inventing a
 *                hierarchy decision the user didn't make.
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

	for (const project of plan.childProjects) {
		const childPlan = planProjectDeletion(scope, project);
		if (childPlan.hasChildren) followUps.push(childPlan);
		else deletePaths.push(project.path);
	}

	return { deletePaths, edits: [], followUps };
}

/** Which field each kind of child clears when unparented. */
function unparentEdits(plan: DeletionPlan): FieldEdit[] {
	const field: FieldEdit["field"] =
		plan.kind === "task"
			? "parent"
			: plan.kind === "project"
				? "project"
				: "initiative";

	const edits: FieldEdit[] = plan.childTasks.map((task) => ({
		path: task.path,
		field,
		value: null,
	}));

	// Child projects of an initiative always clear `initiative`, whatever the
	// task-side field was.
	for (const project of plan.childProjects) {
		edits.push({ path: project.path, field: "initiative", value: null });
	}

	return edits;
}

// ---------------------------------------------------------------------------
// Dangling references
// ---------------------------------------------------------------------------

/**
 * Relations and cycle references that point at notes being deleted (§7.3).
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

/** Summary line for the dialog: `"3 sub-tasks"`, `"2 projects and 4 tasks"`. */
export function describePlanChildren(plan: DeletionPlan): string {
	const parts: string[] = [];
	const noun = plan.kind === "task" ? "sub-task" : "task";
	if (plan.childProjects.length > 0) {
		parts.push(
			`${plan.childProjects.length} project${plan.childProjects.length === 1 ? "" : "s"}`,
		);
	}
	if (plan.childTasks.length > 0) {
		parts.push(
			`${plan.childTasks.length} ${noun}${plan.childTasks.length === 1 ? "" : "s"}`,
		);
	}
	if (parts.length === 0) return "nothing";
	return parts.join(" and ");
}
