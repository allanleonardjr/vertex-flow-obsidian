/**
 * Built-in Saved Views (§8.3).
 *
 * V1 ships exactly one built-in view — "All Tasks". Everything else is user-created
 * from the sidebar: layout (list/board), grouping, sorting, and filters are all
 * live-editable per view and persisted to `_views.md`. The `self` filter value
 * is still available in the filter editor, so "Assigned to Me" / "Mentions Me"
 * are a two-click view the user builds themselves rather than something baked in.
 */

import { NONE, type SavedView, type ViewDefinition, type ViewType } from "../types";

/** The default curated icon for a view of each layout. */
export function layoutIcon(viewType: ViewType): string {
	if (viewType === "board") return "columns-3";
	if (viewType === "timeline") return "chart-gantt";
	if (viewType === "calendar") return "calendar";
	return "list";
}

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
	hiddenFields: [],
	subtaskDisplay: "flat",
	calendarDateField: "dueDate",
};

function view(partial: Partial<SavedView> & Pick<SavedView, "id" | "name">): SavedView {
	return {
		...DEFAULT_DEFINITION,
		// Fresh mutable copies, not the shared `DEFAULT_DEFINITION` references.
		columns: { collapsed: [], hidden: [] },
		hiddenFields: [],
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

/**
 * The second permanent view: a queue of genuinely untriaged captures. Like the
 * built-in "All Tasks" it can't be deleted from the sidebar and doesn't appear
 * in the Views section — it renders as its own bare row.
 *
 * "Untriaged" means all four of: no Project (`project: [NONE]`), top-level
 * (`parent: [NONE]` — a project-less sub-task is still anchored to its parent),
 * still outstanding (`openOnly` — not Completed/Canceled), and not yet scheduled
 * (`unscheduled` — a date is itself a triage decision). The link sentinels lean
 * on the existing filter-engine `matchesLink` handling; `openOnly`/`unscheduled`
 * are plain `ViewFilters` flags, also typeable as `is:open` / `is:unscheduled`.
 */
export const INBOX_VIEW_ID = "inbox";
export const INBOX_VIEW_NAME = "Inbox";

export function defaultViews(): SavedView[] {
	return [
		view({
			id: BUILT_IN_VIEW_ID,
			name: BUILT_IN_VIEW_NAME,
			icon: "list",
			viewType: "list",
			groupBy: "status",
			// Ships as `flat` (the default): sub-tasks visible as loose rows, and
			// drag-to-reorder still works. `nested` is one click away on the bar.
			subtaskDisplay: "flat",
		}),
		view({
			id: INBOX_VIEW_ID,
			name: INBOX_VIEW_NAME,
			icon: "inbox",
			viewType: "list",
			groupBy: "status",
			subtaskDisplay: "flat",
			filters: {
				project: [NONE],
				parent: [NONE],
				openOnly: true,
				unscheduled: true,
			},
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
		icon: icon ?? layoutIcon(viewType),
		viewType,
		groupBy: viewType === "board" ? "status" : "none",
	});
}

/** The view to fall back on when a workspace has none saved yet. */
export function fallbackView(): SavedView {
	return defaultViews()[0];
}
