/**
 * System Views.
 *
 * V1 ships two permanent System Views — "All Tasks" and "Untriaged". Neither is
 * a file: they're injected into every workspace by the index. Everything else is
 * a user-created `Views/<id>.md` note: layout (list/board), grouping, sorting,
 * and filters are all live-editable per view and persisted to that one file. The
 * `self` filter value is still available in the filter editor, so "Assigned to
 * Me" / "Mentions Me" are a two-click view the user builds themselves rather
 * than something baked in.
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
		type: "view",
		// A real vault path is assigned by the glue layer — on write for a user
		// view, or on injection for a System View. Core constructors don't know
		// the workspace root, exactly as a brand-new Project's path is filled in
		// by `createProject`.
		path: "",
		...DEFAULT_DEFINITION,
		// Fresh mutable copies, not the shared `DEFAULT_DEFINITION` references.
		columns: { collapsed: [], hidden: [] },
		hiddenFields: [],
		...partial,
	};
}

/** The "All Tasks" System View id — protected from deletion in the sidebar. */
export const SYSTEM_VIEW_ALL_TASKS_ID = "tasks";

/** Its name. Everything hangs off Tasks, so it reads as the "all" view. */
export const SYSTEM_VIEW_ALL_TASKS_NAME = "All Tasks";

/**
 * The name this System View shipped with before it became "All Tasks".
 * Workspaces created back then still carry it, so an untouched one is renamed in
 * memory on read (see `index-store`).
 */
export const LEGACY_SYSTEM_VIEW_ALL_TASKS_NAME = "Tasks";

/**
 * The second permanent System View: a queue of genuinely untriaged captures.
 * Like "All Tasks" it can't be deleted from the sidebar and doesn't appear in
 * the Views section — it renders as its own bare row.
 *
 * "Untriaged" means all four of: no Project (`project: [NONE]`), top-level
 * (`parent: [NONE]` — a project-less sub-task is still anchored to its parent),
 * still outstanding (`openOnly` — not Completed/Canceled), and not yet scheduled
 * (`unscheduled` — a date is itself a triage decision). The link sentinels lean
 * on the existing filter-engine `matchesLink` handling; `openOnly`/`unscheduled`
 * are plain `ViewFilters` flags, also typeable as `is:open` / `is:unscheduled`.
 */
export const SYSTEM_VIEW_UNTRIAGED_ID = "untriaged";
export const SYSTEM_VIEW_UNTRIAGED_NAME = "Untriaged";

/**
 * This View was called "Inbox" until "Inbox" was reserved for a future,
 * unrelated feature. Only for recognizing pre-rename data during migration —
 * not used elsewhere.
 */
export const LEGACY_SYSTEM_VIEW_UNTRIAGED_ID = "inbox";
export const LEGACY_SYSTEM_VIEW_UNTRIAGED_NAME = "Inbox";

/** Whether `id` is one of the two permanent, undeletable System Views. */
export function isSystemViewId(id: string): boolean {
	return (
		id === SYSTEM_VIEW_ALL_TASKS_ID || id === SYSTEM_VIEW_UNTRIAGED_ID
	);
}

export function defaultViews(): SavedView[] {
	return [
		view({
			id: SYSTEM_VIEW_ALL_TASKS_ID,
			name: SYSTEM_VIEW_ALL_TASKS_NAME,
			icon: "list",
			viewType: "list",
			groupBy: "status",
			// Ships as `flat` (the default): sub-tasks visible as loose rows, and
			// drag-to-reorder still works. `nested` is one click away on the bar.
			subtaskDisplay: "flat",
		}),
		view({
			id: SYSTEM_VIEW_UNTRIAGED_ID,
			name: SYSTEM_VIEW_UNTRIAGED_NAME,
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
