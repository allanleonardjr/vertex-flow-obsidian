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
				// A Project has no `Views/<id>.md`; its view settings ride in the
				// project note's `view:` block. Group collapse/hide *is* persisted
				// there (the one bit of per-session chrome the note can hold) —
				// timeline zoom / calendar month still aren't, and land as a no-op.
				const definition = viewDefinition(next);
				const columnsUnchanged =
					JSON.stringify(next.columns) === JSON.stringify(view.columns);
				if (
					definitionsEqual(definition, viewDefinition(view)) &&
					columnsUnchanged
				)
					return;

				const project = snapshot.projects.find(
					(p) => p.path === projectPathFromViewId(next.id),
				);
				if (project) {
					const hasColumns =
						next.columns.collapsed.length > 0 ||
						next.columns.hidden.length > 0;
					void plugin.mutations.updateProject(project, {
						view: hasColumns
							? { ...definition, columns: next.columns }
							: definition,
					});
				}
				return;
			}
			void plugin.mutations.updateView(snapshot, next);
		},
		[plugin, snapshot, view],
	);
}
