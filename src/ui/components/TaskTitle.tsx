/**
 * A task's title for display, with the untitled case handled once.
 *
 * Tasks are unnamed until the user types something: `createTask` stores no
 * title, the editor leaves it blank, and nothing writes the task ID into the
 * title. So every surface that shows a title must render a grayed
 * "Untitled task" instead of an empty gap (and never fall back to the ID —
 * the ID is a separate identity badge, not the name).
 */

import type { Task } from "../../core/types";

/** Shown wherever a title-less task appears. */
export const UNTITLED_TASK_LABEL = "Untitled task";

/** Title text for a task — the display string, not a DOM node. */
export function displayTitle(task: Task): string {
	return task.title || UNTITLED_TASK_LABEL;
}

/** The title with a grayed fallback when the task has none yet. */
export function TaskTitle({ task }: { task: Task }) {
	if (!task.title) {
		return <span className="vf-untitled-title">{UNTITLED_TASK_LABEL}</span>;
	}
	return <>{task.title}</>;
}