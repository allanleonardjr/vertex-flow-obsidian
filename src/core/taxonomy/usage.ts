/**
 * Counting taxonomy usage — the input to the §5.6 deletion guard.
 *
 * Status is the one taxonomy used by Projects and Initiatives as well as Tasks
 * (§5.1), so its usage count spans all three entity types. The other three are
 * Task-only.
 */

import type { Initiative, Project, Task, TaxonomyKind } from "../types";

export interface TaxonomyUsageScope {
	tasks: Task[];
	projects?: Project[];
	initiatives?: Initiative[];
}

/** Every entity currently referencing `valueId`, as human-readable labels. */
export interface TaxonomyUsage {
	count: number;
	/** Paths of the affected notes, for "12 tasks, 2 projects" dialog copy. */
	taskPaths: string[];
	projectPaths: string[];
	initiativePaths: string[];
}

export function findTaxonomyUsage(
	kind: TaxonomyKind,
	valueId: string,
	scope: TaxonomyUsageScope,
): TaxonomyUsage {
	const taskPaths: string[] = [];
	const projectPaths: string[] = [];
	const initiativePaths: string[] = [];

	for (const task of scope.tasks) {
		if (taskUsesValue(task, kind, valueId)) taskPaths.push(task.path);
	}

	// Projects and Initiatives reuse the Task status taxonomy — no separate
	// system — so deleting a status has to account for them too.
	if (kind === "status") {
		for (const project of scope.projects ?? []) {
			if (project.status === valueId) projectPaths.push(project.path);
		}
		for (const initiative of scope.initiatives ?? []) {
			if (initiative.status === valueId) initiativePaths.push(initiative.path);
		}
	}

	return {
		count: taskPaths.length + projectPaths.length + initiativePaths.length,
		taskPaths,
		projectPaths,
		initiativePaths,
	};
}

export function taskUsesValue(
	task: Task,
	kind: TaxonomyKind,
	valueId: string,
): boolean {
	switch (kind) {
		case "status":
			return task.status === valueId;
		case "priority":
			return task.priority === valueId;
		case "taskType":
			return task.taskType === valueId;
		case "label":
			return task.labels.includes(valueId);
	}
}

/** Short summary for dialog copy: `"12 tasks and 2 projects"`. */
export function describeUsage(usage: TaxonomyUsage): string {
	const parts: string[] = [];
	const push = (n: number, singular: string) => {
		if (n > 0) parts.push(`${n} ${n === 1 ? singular : `${singular}s`}`);
	};
	push(usage.taskPaths.length, "task");
	push(usage.projectPaths.length, "project");
	push(usage.initiativePaths.length, "initiative");

	if (parts.length === 0) return "nothing";
	if (parts.length === 1) return parts[0];
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
