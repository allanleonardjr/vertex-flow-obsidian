/**
 * View evaluation: snapshot + Saved View → what to render.
 *
 * This is the single path every List and Board render goes through, so the two
 * views can never drift out of agreement about which tasks a filter matches.
 */

import type { SavedView, Task, TaskGroup, WorkspaceSnapshot } from "../types";
import { snapshotContext, type ViewContext } from "./context";
import { applyFilters } from "./filter";
import { groupTasksForView } from "./group";
import { sortTasks } from "./sort";

export interface EvaluatedView {
	view: SavedView;
	context: ViewContext;
	/** Filtered + sorted, before grouping — what the List view renders. */
	tasks: Task[];
	/** Grouped — what the Board view renders. */
	groups: TaskGroup[];
	/** Tasks matching the filters. Excludes nothing that grouping hid. */
	total: number;
	/** How many were filtered out of the workspace's full task list. */
	filteredOut: number;
}

export function evaluateView(
	snapshot: WorkspaceSnapshot,
	view: SavedView,
	context: ViewContext = snapshotContext(snapshot),
): EvaluatedView {
	const filtered = applyFilters(snapshot.tasks, view.filters, context);
	// `hidden` drops sub-tasks outright; `nested` and `flat` both keep them in the
	// evaluated set (the List view derives the tree from it — see `nest.ts`).
	const visible =
		view.subtaskDisplay === "hidden"
			? filtered.filter((task) => task.parent == null)
			: filtered;
	const sorted = sortTasks(visible, view.sortBy, view.sortDirection, context);

	return {
		view,
		context,
		tasks: sorted,
		groups: groupTasksForView(sorted, view, context),
		total: sorted.length,
		filteredOut: snapshot.tasks.length - sorted.length,
	};
}

/** Groups the Board should actually paint, in order. */
export function visibleGroups(evaluated: EvaluatedView): TaskGroup[] {
	return evaluated.groups.filter((group) => !group.hidden);
}

/** Groups the user hid, so the sidebar can offer to restore them. */
export function hiddenGroups(evaluated: EvaluatedView): TaskGroup[] {
	return evaluated.groups.filter((group) => group.hidden);
}

/** Toggle a column's collapsed state, returning a new Saved View (§8.2). */
export function toggleColumnCollapsed(view: SavedView, key: string): SavedView {
	const collapsed = view.columns.collapsed.includes(key)
		? view.columns.collapsed.filter((k) => k !== key)
		: [...view.columns.collapsed, key];
	return { ...view, columns: { ...view.columns, collapsed } };
}

/**
 * Collapse or expand a whole set of columns at once — the "collapse all" /
 * "expand all" list-view control. Collapsing is a union (keys already collapsed
 * stay collapsed); expanding removes exactly the given keys.
 */
export function setColumnsCollapsed(
	view: SavedView,
	keys: string[],
	collapsed: boolean,
): SavedView {
	const next = collapsed
		? [...new Set([...view.columns.collapsed, ...keys])]
		: view.columns.collapsed.filter((k) => !keys.includes(k));
	return { ...view, columns: { ...view.columns, collapsed: next } };
}

export function toggleColumnHidden(view: SavedView, key: string): SavedView {
	const hidden = view.columns.hidden.includes(key)
		? view.columns.hidden.filter((k) => k !== key)
		: [...view.columns.hidden, key];
	return { ...view, columns: { ...view.columns, hidden } };
}
