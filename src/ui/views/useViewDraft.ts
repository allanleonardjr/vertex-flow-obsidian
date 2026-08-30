/**
 * Unsaved edits to the Saved View you're looking at.
 *
 * Changing a filter, grouping, or layout applies **immediately** to what's on
 * screen but is held here rather than written to the view's `Views/<id>.md`
 * note. That note is shared across a synced vault, so an exploratory filter
 * shouldn't silently rewrite the view everyone else opens — the save is explicit.
 *
 * Column collapse/hide, the timeline's zoom/scroll, and the calendar's visible
 * month are the deliberate exceptions: transient view chrome rather than part
 * of the view's definition, so they write through immediately and never count
 * as "unsaved changes". (The calendar's *date field* is definitional and does
 * go through the draft.)
 */

import { useCallback } from "react";
import type {
	SavedView,
	ViewCalendarState,
	ViewColumnState,
	ViewTimelineState,
	WorkspaceSnapshot,
} from "../../core/types";
import { canonicalizeDefinition, viewDefinition } from "../../core/views";
import { useTabs } from "../tabs-context";
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
	/** Persist the timeline's zoom/scroll straight to disk, bypassing the draft. */
	setTimeline: (timeline: ViewTimelineState) => void;
	/** Persist the calendar's visible month straight to disk, bypassing the draft. */
	setCalendar: (calendar: ViewCalendarState) => void;
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
	const { getViewDraft, setViewDraft } = useTabs();

	// The draft is keyed by `view.id` in the shared store owned by
	// `TabsProvider`, so it survives this component unmounting on a tab or
	// workspace switch. No reset-on-id-change effect: the store is already
	// per-id, so each view only ever sees its own draft.
	const draft = getViewDraft(view.id);

	// Columns and timeline chrome always come from disk, so collapsing a column
	// or zooming the timeline while a draft is pending isn't reverted when the
	// draft is saved or discarded.
	const effective = draft
		? {
				...draft,
				columns: view.columns,
				timeline: view.timeline,
				calendar: view.calendar,
			}
		: view;
	const dirty = draft != null && definitionOf(draft) !== definitionOf(view);

	const edit = useCallback(
		(next: SavedView) => setViewDraft(view.id, next),
		[setViewDraft, view.id],
	);

	const setColumns = useCallback(
		(columns: ViewColumnState) => writeView({ ...view, columns }),
		[writeView, view],
	);

	const setTimeline = useCallback(
		(timeline: ViewTimelineState) => writeView({ ...view, timeline }),
		[writeView, view],
	);

	const setCalendar = useCallback(
		(calendar: ViewCalendarState) => writeView({ ...view, calendar }),
		[writeView, view],
	);

	const save = useCallback(() => {
		if (!draft) return;
		writeView({
			...draft,
			columns: view.columns,
			timeline: view.timeline,
			calendar: view.calendar,
		});
		setViewDraft(view.id, null);
	}, [
		draft,
		writeView,
		view.id,
		view.columns,
		view.timeline,
		view.calendar,
		setViewDraft,
	]);

	const reset = useCallback(
		() => setViewDraft(view.id, null),
		[setViewDraft, view.id],
	);

	return {
		effective,
		dirty,
		edit,
		setColumns,
		setTimeline,
		setCalendar,
		save,
		reset,
	};
}
