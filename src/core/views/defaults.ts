/**
 * Built-in Saved Views (§8.3).
 *
 * V1 ships exactly one built-in view — "Tasks". Everything else is user-created
 * from the sidebar: layout (list/board), grouping, sorting, and filters are all
 * live-editable per view and persisted to `_views.md`. The `self` filter value
 * is still available in the filter editor, so "Assigned to Me" / "Mentions Me"
 * are a two-click view the user builds themselves rather than something baked in.
 */

import type { SavedView } from "../types";

export const DEFAULT_SORT_DIRECTION = "asc" as const;

function view(partial: Partial<SavedView> & Pick<SavedView, "id" | "name">): SavedView {
	return {
		viewType: "list",
		filters: {},
		groupBy: "none",
		sortBy: "rank",
		sortDirection: DEFAULT_SORT_DIRECTION,
		columns: { collapsed: [], hidden: [] },
		emptyColumnBehavior: "show-normal",
		...partial,
	};
}

/** The one built-in view id — protected from deletion in the sidebar. */
export const BUILT_IN_VIEW_ID = "tasks";

export function defaultViews(): SavedView[] {
	return [
		view({
			id: BUILT_IN_VIEW_ID,
			name: "Tasks",
			icon: "list",
			viewType: "list",
			groupBy: "status",
			// Sub-tasks show nested under their parent in the List view rather
			// than as loose top-level rows.
			filters: { topLevelOnly: true },
		}),
	];
}

/** A blank view for the "new view" flow in the sidebar. */
export function newView(
	id: string,
	name: string,
	viewType: SavedView["viewType"],
	icon?: string,
): SavedView {
	return view({
		id,
		name,
		icon: icon ?? (viewType === "board" ? "columns-3" : "list"),
		viewType,
		groupBy: viewType === "board" ? "status" : "none",
	});
}

/** The view to fall back on when a workspace has none saved yet. */
export function fallbackView(): SavedView {
	return defaultViews()[0];
}
