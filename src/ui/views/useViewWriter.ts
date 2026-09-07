/**
 * Persist an edit to one Saved View. Most views are backed by their own
 * `Views/<id>.md` note; a Project's synthesised task-list view instead saves
 * to the `view:` frontmatter block on the Project's own note (see
 * `Project.view` / `projectView()` in `App.tsx`) — it has no file of its own,
 * and its id (`project:<path>`) isn't even a safe filename.
 *
 * Every runtime view change — layout toggle, group/sort, filters, column
 * collapse — goes through here, so there is exactly one place that knows how
 * a view edit becomes a write.
 */

import { useCallback } from "react";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
import {
	definitionsEqual,
	isProjectViewId,
	projectPathFromViewId,
	viewDefinition,
} from "../../core/views";
import { usePlugin } from "../context";

export function useViewWriter(
	snapshot: WorkspaceSnapshot,
	view: SavedView,
): (next: SavedView) => void {
	const plugin = usePlugin();
	return useCallback(
		(next: SavedView) => {
			if (isProjectViewId(next.id)) {
				// Column collapse / timeline zoom / calendar month funnel through
				// here too, unchanged in their definitional fields — that's
				// transient chrome for every other view, and a Project has nowhere
				// to persist it, so skip the write rather than bump the project's
				// `updatedAt` for a non-change.
				const definition = viewDefinition(next);
				if (definitionsEqual(definition, viewDefinition(view))) return;

				const project = snapshot.projects.find(
					(p) => p.path === projectPathFromViewId(next.id),
				);
				if (project) {
					void plugin.mutations.updateProject(project, { view: definition });
				}
				return;
			}
			void plugin.mutations.updateView(snapshot, next);
		},
		[plugin, snapshot, view],
	);
}
