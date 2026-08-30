/**
 * Saved View grouping — the thing that turns a task list into Board columns.
 *
 * Two behaviours here are board-specific and deliberate:
 *
 * 1. Grouping by `status` emits a column for **every** configured status, even
 *    empty ones. A Kanban board with a missing "Done" column isn't a board.
 *    Every other grouping emits only groups that actually have tasks, plus a
 *    trailing "no value" group when relevant.
 * 2. Grouping by `label` is many-to-many: a task with two labels appears in two
 *    columns. Dragging between label columns therefore means *add/remove*, not
 *    *move* — the UI has to treat that case specially.
 */

import { basename } from "../links";
import { displayColor, listValues } from "../taxonomy/engine";
import {
	NONE,
	type EmptyColumnBehavior,
	type GroupByField,
	type SavedView,
	type Task,
	type TaskGroup,
	type ViewColumnState,
} from "../types";
import type { ViewContext } from "./context";

const NO_VALUE_LABELS: Record<GroupByField, string> = {
	none: "All",
	status: "No Status",
	priority: "No Priority",
	taskType: "No Type",
	assignee: "Unassigned",
	project: "No Project",
	label: "No Labels",
};

/** The group key(s) a task belongs to. Only `label` ever returns more than one. */
function keysFor(task: Task, groupBy: GroupByField): string[] {
	switch (groupBy) {
		case "none":
			return ["all"];
		case "status":
			return [task.status ?? NONE];
		case "priority":
			return [task.priority ?? NONE];
		case "taskType":
			return [task.taskType ?? NONE];
		case "assignee":
			return [task.assignee ?? NONE];
		case "project":
			return [task.project ?? NONE];
		case "label":
			return task.labels.length > 0 ? task.labels.slice() : [NONE];
	}
}

function labelFor(
	key: string,
	groupBy: GroupByField,
	context: ViewContext,
): string {
	if (key === NONE) return NO_VALUE_LABELS[groupBy];
	if (key === "all") return "All";

	switch (groupBy) {
		case "status":
		case "priority":
		case "taskType":
			return context.taxonomies[groupBy].values.find((v) => v.id === key)?.name ?? key;
		case "label":
			return context.taxonomies.label.values.find((v) => v.id === key)?.name ?? key;
		case "assignee":
			return context.people.find((p) => p.id === key)?.name ?? key;
		case "project":
			// Titles come from the snapshot; fall back to the filename, which for
			// projects *is* human-readable (only Tasks are named by ID).
			return context.titles?.get(key) ?? basename(key);
		default:
			return key;
	}
}

function colorFor(
	key: string,
	groupBy: GroupByField,
	context: ViewContext,
): string | null {
	if (key === NONE || key === "all") return null;
	switch (groupBy) {
		case "status":
		case "priority":
		case "taskType":
		case "label":
			return displayColor(context.taxonomies[groupBy], key);
		default:
			return null;
	}
}

/**
 * The full ordered set of group keys a view should render, before tasks are
 * distributed into them.
 */
function orderedKeys(
	tasks: Task[],
	groupBy: GroupByField,
	context: ViewContext,
): string[] {
	if (groupBy === "none") return ["all"];

	const present = new Set<string>();
	for (const task of tasks) {
		for (const key of keysFor(task, groupBy)) present.add(key);
	}

	// Taxonomy groupings render every configured value in taxonomy order, so
	// board columns stay stable as tasks move in and out of them.
	if (
		groupBy === "status" ||
		groupBy === "priority" ||
		groupBy === "taskType" ||
		groupBy === "label"
	) {
		const keys = listValues(context.taxonomies[groupBy]).map((v) => v.id);
		if (present.has(NONE)) keys.push(NONE);
		return keys;
	}

	if (groupBy === "assignee") {
		const keys = context.people.map((person) => person.id);
		for (const key of present) {
			if (key !== NONE && !keys.includes(key)) keys.push(key);
		}
		if (present.has(NONE)) keys.push(NONE);
		return keys;
	}

	// Link grouping (project): only what's actually in play, alphabetically,
	// with the "no value" bucket last.
	const keys = [...present].filter((key) => key !== NONE);
	keys.sort((a, b) =>
		labelFor(a, groupBy, context).localeCompare(labelFor(b, groupBy, context)),
	);
	if (present.has(NONE)) keys.push(NONE);
	return keys;
}

export interface GroupOptions {
	columns?: ViewColumnState;
	emptyColumnBehavior?: EmptyColumnBehavior;
}

/**
 * Distribute already-filtered, already-sorted tasks into groups.
 *
 * Hidden groups are still returned (carrying `hidden: true`) rather than
 * dropped, so the sidebar can offer to bring them back and the caller can
 * report accurate totals. Rendering is the UI's decision.
 */
export function groupTasks(
	tasks: Task[],
	groupBy: GroupByField,
	context: ViewContext,
	options: GroupOptions = {},
): TaskGroup[] {
	const collapsed = new Set(options.columns?.collapsed ?? []);
	const hidden = new Set(options.columns?.hidden ?? []);
	const emptyBehavior: EmptyColumnBehavior =
		options.emptyColumnBehavior ?? "show-normal";

	const buckets = new Map<string, Task[]>();
	for (const key of orderedKeys(tasks, groupBy, context)) buckets.set(key, []);
	for (const task of tasks) {
		for (const key of keysFor(task, groupBy)) {
			const bucket = buckets.get(key);
			if (bucket) bucket.push(task);
			else buckets.set(key, [task]);
		}
	}

	const groups: TaskGroup[] = [];
	for (const [key, bucketTasks] of buckets) {
		const isEmpty = bucketTasks.length === 0;
		groups.push({
			key,
			label: labelFor(key, groupBy, context),
			color: colorFor(key, groupBy, context),
			tasks: bucketTasks,
			// Manual collapse always wins; the empty-column behaviour only ever
			// adds collapse/hide, never un-collapses something the user collapsed.
			collapsed:
				collapsed.has(key) || (isEmpty && emptyBehavior === "auto-collapse"),
			hidden: hidden.has(key) || (isEmpty && emptyBehavior === "auto-hide"),
		});
	}
	return groups;
}

/** Convenience wrapper reading the grouping options straight off a Saved View. */
export function groupTasksForView(
	tasks: Task[],
	view: SavedView,
	context: ViewContext,
): TaskGroup[] {
	return groupTasks(tasks, view.groupBy, context, {
		columns: view.columns,
		emptyColumnBehavior: view.emptyColumnBehavior,
	});
}
