/**
 * Unsaved edits to the Saved View you're looking at.
 *
 * Changing a filter, grouping, or layout applies **immediately** to what's on
 * screen but is held here rather than written to `_views.md`. `_views.md` is
 * shared across a synced vault, so an exploratory filter shouldn't silently
 * rewrite the view everyone else opens — the save is explicit.
 *
 * Column collapse/hide is the deliberate exception: it's transient board chrome
 * rather than part of the view's definition, so it writes through immediately
 * and never counts as "unsaved changes".
 */

import { useCallback, useEffect, useState } from "react";
import type { SavedView, ViewColumnState, WorkspaceSnapshot } from "../../core/types";
import { canonicalizeDefinition, viewDefinition } from "../../core/views";
import { useViewWriter } from "./useViewWriter";

/**
 * The fields a user edits from the view bar — what "unsaved" is measured over.
 *
 * Canonicalised first, so this compares what a view *means* rather than the
 * order its keys happen to sit in. Without that, removing a filter clause and
 * re-adding it leaves the key at the end of the object and the view reads as
 * unsaved with an identical filter set — and the query bar, which rebuilds
 * `filters` in token order on every keystroke, would hit that constantly.
 */
function definitionOf(view: SavedView) {
	return JSON.stringify(canonicalizeDefinition(viewDefinition(view)));
}

export interface ViewDraft {
	/** The view to render: the draft when there is one, else the saved view. */
	effective: SavedView;
	/** True when the draft differs from what's on disk. */
	dirty: boolean;
	/** Apply an edit from the view bar (held, not persisted). */
	edit: (next: SavedView) => void;
	/** Persist column collapse/hide straight to disk, bypassing the draft. */
	setColumns: (columns: ViewColumnState) => void;
	/** Write the draft over the saved view. */
	save: () => void;
	/** Throw the draft away. */
	reset: () => void;
}

export function useViewDraft(
	snapshot: WorkspaceSnapshot,
	view: SavedView,
): ViewDraft {
	const writeView = useViewWriter(snapshot, view);
	const [draft, setDraft] = useState<SavedView | null>(null);

	// Switching views abandons the draft — a draft belongs to the view it was
	// started on. Keyed on the id, not the object: `view` gets a fresh identity
	// on every index rebuild.
	useEffect(() => setDraft(null), [view.id, snapshot.workspace.root]);

	// Columns always come from disk, so collapsing a column while a draft is
	// pending doesn't get reverted when the draft is saved or discarded.
	const effective = draft ? { ...draft, columns: view.columns } : view;
	const dirty = draft != null && definitionOf(draft) !== definitionOf(view);

	const edit = useCallback((next: SavedView) => setDraft(next), []);

	const setColumns = useCallback(
		(columns: ViewColumnState) => writeView({ ...view, columns }),
		[writeView, view],
	);

	const save = useCallback(() => {
		if (!draft) return;
		writeView({ ...draft, columns: view.columns });
		setDraft(null);
	}, [draft, writeView, view.columns]);

	const reset = useCallback(() => setDraft(null), []);

	return { effective, dirty, edit, setColumns, save, reset };
}
