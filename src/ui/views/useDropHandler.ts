/**
 * What a drop *means*, shared by List and Board.
 *
 * A drop writes at most two things: a new rank, and — when the grouping maps
 * onto a single-valued field — that field. Keeping this in one place is what
 * stops the two views from disagreeing about whether dragging into a column
 * reassigns a task or merely reorders it.
 */

import { useCallback } from "react";
import type { EvaluatedView } from "../../core/views";
import { NONE, type GroupByField, type SavedView, type Task } from "../../core/types";
import { usePlugin } from "../context";
import type { DropTarget } from "./useTaskDrag";

/**
 * Turn "dropped into group X" into a field edit.
 *
 * `label` is deliberately absent: grouping by label is many-to-many, so a card
 * can legitimately sit in two columns at once and "moved into Design" has no
 * single meaning. Those drags reorder only.
 */
function fieldEditFor(
	groupBy: GroupByField,
	groupKey: string,
): Partial<Task> | null {
	const value = groupKey === NONE ? null : groupKey;

	switch (groupBy) {
		case "status":
			// Status is the one required field — there is no "no status".
			return value ? { status: value } : null;
		case "priority":
			return { priority: value };
		case "taskType":
			return { taskType: value };
		case "assignee":
			return { assignee: value };
		case "cycle":
			return { cycle: value };
		// A task has exactly one primary parent (Golden Rule), so moving it into
		// a project clears any initiative it was attached to directly, and
		// vice versa.
		case "project":
			return { project: value, initiative: null };
		case "initiative":
			return { initiative: value, project: null };
		case "label":
		case "none":
			return null;
	}
}

export function useTaskDropHandler(
	view: SavedView,
	evaluated: EvaluatedView,
): (taskPath: string, target: DropTarget) => void {
	const plugin = usePlugin();

	// A cycle board is the one context with its own order (§6).
	const rankField = view.sortBy === "cycleRank" ? "cycleRank" : "rank";

	return useCallback(
		(taskPath: string, target: DropTarget) => {
			const task = evaluated.tasks.find((candidate) => candidate.path === taskPath);
			const group = evaluated.groups.find((candidate) => candidate.key === target.groupKey);
			if (!task || !group) return;

			const edit = fieldEditFor(view.groupBy, target.groupKey);

			void plugin.mutations.moveTask(
				task,
				group.tasks,
				target.index,
				rankField,
				edit ?? undefined,
			);
		},
		[evaluated, view.groupBy, plugin, rankField],
	);
}
