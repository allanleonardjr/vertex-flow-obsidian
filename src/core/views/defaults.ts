/**
 * Built-in Saved Views (§8.3).
 *
 * V1 ships exactly one built-in view — "All Tasks". Everything else is user-created
 * from the sidebar: layout (list/board), grouping, sorting, and filters are all
 * live-editable per view and persisted to `_views.md`. The `self` filter value
 * is still available in the filter editor, so "Assigned to Me" / "Mentions Me"
 * are a two-click view the user builds themselves rather than something baked in.
 */

import type { SavedView, ViewDefinition } from "../types";

export const DEFAULT_SORT_DIRECTION = "asc" as const;

/**
 * What a view is before anyone configures it.
 *
 * Exported because the text query language needs the same defaults: a query
 * that omits `group:` means "no grouping", and both sides must agree on what
 * that is or the round-trip breaks.
 */
export const DEFAULT_DEFINITION: ViewDefinition = {
	filters: {},
	viewType: "list",
	groupBy: "none",
	sortBy: "rank",
	sortDirection: DEFAULT_SORT_DIRECTION,
	emptyColumnBehavior: "show-normal",
};

function view(partial: Partial<SavedView> & Pick<SavedView, "id" | "name">): SavedView {
	return {
		...DEFAULT_DEFINITION,
		columns: { collapsed: [], hidden: [] },
		...partial,
	};
}

/** The one built-in view id — protected from deletion in the sidebar. */
export const BUILT_IN_VIEW_ID = "tasks";

/** The built-in view's name. Everything hangs off Tasks, so it reads as the "all" view. */
export const BUILT_IN_VIEW_NAME = "All Tasks";

/**
 * The name the built-in view shipped with before it became "All Tasks".
 * Workspaces created back then have it written into their `_views.md`, so an
 * untouched one is renamed on read (see `index-store`).
 */
export const LEGACY_BUILT_IN_VIEW_NAME = "Tasks";

export function defaultViews(): SavedView[] {
	return [
		view({
			id: BUILT_IN_VIEW_ID,
			name: BUILT_IN_VIEW_NAME,
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
