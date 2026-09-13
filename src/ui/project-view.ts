/**
 * Reconstructs the `SavedView` rendered for a Project's embedded task-list
 * viewport, from `project.view` (`ProjectViewSettings`, written by
 * `useViewWriter`). Pulled out of `App.tsx` — which imports the Obsidian API —
 * so this pure mapping stays unit-testable like the rest of `src/core/`.
 */
import { projectViewId } from "../core/views/defaults";
import type { Project, SavedView } from "../core/types";

export function projectView(project: Project): SavedView {
	const definition = project.view;
	return {
		type: "vertex-flow-view",
		path: "",
		id: projectViewId(project.path),
		name: project.title,
		viewType: definition?.viewType ?? "list",
		// The project filter is always forced, regardless of what's stored — a
		// safety net against a stale or missing value (e.g. after a rename).
		filters: { ...(definition?.filters ?? {}), project: [project.path] },
		groupBy: definition?.groupBy ?? "status",
		sortBy: definition?.sortBy ?? "rank",
		sortDirection: definition?.sortDirection ?? "asc",
		columns: definition?.columns ?? { collapsed: [], hidden: [] },
		emptyColumnBehavior: definition?.emptyColumnBehavior ?? "show-normal",
		hiddenFields: definition?.hiddenFields ?? [],
		subtaskDisplay: definition?.subtaskDisplay ?? "nested",
		calendarDateField: definition?.calendarDateField ?? "dueDate",
		canvasArrangement: definition?.canvasArrangement ?? "flow",
		canvasDirection: definition?.canvasDirection ?? "right",
		canvasHiddenRelationKinds: definition?.canvasHiddenRelationKinds ?? [],
		recurringPreview: definition?.recurringPreview ?? false,
	};
}
