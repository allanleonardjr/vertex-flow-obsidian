/**
 * Persist an edit to one Saved View back to `_views.md`.
 *
 * Every runtime view change — layout toggle, group/sort, filters, column
 * collapse — goes through here, so there is exactly one place that knows how a
 * view edit becomes a file write. Reads the *live* snapshot rather than the one
 * captured in a render, so concurrent edits to sibling views aren't clobbered.
 */

import { useCallback } from "react";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

export function useViewWriter(
	snapshot: WorkspaceSnapshot,
	view: SavedView,
): (next: SavedView) => void {
	const plugin = usePlugin();
	return useCallback(
		(next: SavedView) => {
			const live = plugin.index.get(snapshot.workspace.root) ?? snapshot;
			void plugin.mutations.saveViews(
				live,
				live.views.map((candidate) =>
					candidate.id === view.id ? next : candidate,
				),
			);
		},
		[plugin, snapshot, view.id],
	);
}
