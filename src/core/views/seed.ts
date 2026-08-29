/**
 * Seeding a new task from the view it's created in.
 *
 * "New task" on a screen you've narrowed — a project, a label, "assigned to
 * me" — should land where you're looking, not in the unfiltered backlog. This
 * turns a view's filters into starting field values for `createTask`.
 *
 * Pure, like the rest of `core/views`: it reads `ViewFilters` (and, only to
 * expand the `self` sentinel, a `ViewContext`) and returns a plain object.
 */

import { NONE, SELF, type ViewFilters } from "../types";
import type { ViewContext } from "./context";

/** Task fields a view's filters can meaningfully pre-fill. A subset of `NewTaskInput`. */
export interface TaskSeed {
	status?: string;
	priority?: string;
	taskType?: string;
	assignee?: string;
	project?: string;
	parent?: string;
	labels?: string[];
}

/**
 * The one concrete value in a single-select filter, or `null`.
 *
 * A filter that ORs several values ("todo or in-progress") has no single right
 * answer, so it seeds nothing. `NONE` is "field is unset" — also nothing to
 * seed. `SELF` is resolved by the caller where it means a real person.
 */
function onlyValue(values: string[] | undefined): string | null {
	if (!values) return null;
	const concrete = values.filter((value) => value !== NONE && value !== SELF);
	return concrete.length === 1 ? concrete[0] : null;
}

export function seedFromFilters(
	filters: ViewFilters,
	context?: ViewContext,
): TaskSeed {
	const seed: TaskSeed = {};

	const status = onlyValue(filters.status);
	if (status) seed.status = status;

	const priority = onlyValue(filters.priority);
	if (priority) seed.priority = priority;

	const taskType = onlyValue(filters.taskType);
	if (taskType) seed.taskType = taskType;

	// `assignee: [self]` on an "Assigned to Me" view seeds the self person, if
	// the workspace has one flagged.
	const assignee = onlyValue(filters.assignee);
	if (assignee) {
		seed.assignee = assignee;
	} else if (
		filters.assignee?.length === 1 &&
		filters.assignee[0] === SELF &&
		context?.selfId
	) {
		seed.assignee = context.selfId;
	}

	// A task has exactly one primary parent (Golden Rule): a `parent` filter
	// wins over a `project` filter, matching `primaryParent()`.
	const parent = onlyValue(filters.parent);
	const project = onlyValue(filters.project);
	if (parent) seed.parent = parent;
	else if (project) seed.project = project;

	// Labels are multi-select and additive, so every concrete label applies.
	const labels = (filters.labels ?? []).filter((value) => value !== NONE);
	if (labels.length > 0) seed.labels = labels;

	return seed;
}
