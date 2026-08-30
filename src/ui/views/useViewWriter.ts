/**
 * Persist an edit to one Saved View back to its own `Views/<id>.md` note.
 *
 * Every runtime view change — layout toggle, group/sort, filters, column
 * collapse — goes through here, so there is exactly one place that knows how a
 * view edit becomes a file write. `updateView` reads the *live* snapshot and
 * writes only this view's file, so concurrent edits to sibling views can't
 * clobber each other.
 */

import { useCallback } from "react";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

export function useViewWriter(
	snapshot: WorkspaceSnapshot,
	// Kept for call-site stability (`useViewDraft` passes it). `updateView`
	// locates the target file by `next.id`, so the writer no longer needs it.
	_view: SavedView,
): (next: SavedView) => void {
	const plugin = usePlugin();
	return useCallback(
		(next: SavedView) => {
			void plugin.mutations.updateView(snapshot, next);
		},
		[plugin, snapshot],
	);
}
