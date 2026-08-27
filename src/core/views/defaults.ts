/**
 * Built-in Saved Views (§8.3, §7.6).
 *
 * "Assigned to Me" and "Mentions Me" are not special-cased features — they are
 * ordinary Saved Views using the `self` filter value. That is precisely the
 * argument for deferring a dedicated notification panel: the inbox use case
 * falls out of the view engine for free.
 */

import type { SavedView } from "../types";
import { SELF } from "../types";

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

export function defaultViews(): SavedView[] {
	return [
		view({
			id: "all-tasks",
			name: "All Tasks",
			viewType: "list",
			groupBy: "status",
			// Sub-tasks show nested under their parent in the List view rather
			// than as loose top-level rows.
			filters: { topLevelOnly: true },
		}),
		view({
			id: "board",
			name: "Board",
			viewType: "board",
			groupBy: "status",
		}),
		view({
			id: "assigned-to-me",
			name: "Assigned to Me",
			viewType: "list",
			filters: { assignee: [SELF] },
			groupBy: "status",
		}),
		view({
			id: "mentions-me",
			name: "Mentions Me",
			viewType: "list",
			filters: { mentions: [SELF] },
			groupBy: "none",
			sortBy: "updatedAt",
			sortDirection: "desc",
		}),
	];
}

/** A blank view for the "new view" flow in the sidebar. */
export function newView(id: string, name: string, viewType: SavedView["viewType"]): SavedView {
	return view({
		id,
		name,
		viewType,
		groupBy: viewType === "board" ? "status" : "none",
	});
}

/** The view to fall back on when a workspace has none saved yet. */
export function fallbackView(): SavedView {
	return defaultViews()[0];
}
