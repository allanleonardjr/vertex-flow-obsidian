/**
 * The Task viewport — one Saved View, rendered as either a List or a Board and
 * switchable between them live, with Group / Sort / Filter controls in its
 * header (§8). Every Saved View (the built-in "Tasks" and every user-created
 * one) renders through this single component, so a view is only ever a filter +
 * a display config over the same machinery.
 *
 * Lifted wholesale out of `App.tsx`: this owns view evaluation, the keyboard
 * focus layout, the quick-capture pickup, and the list-scoped shortcuts. `App`
 * keeps only the shell, the tab strip, and Escape/tab handling.
 */

import { useEffect, useMemo } from "react";
import { evaluateView } from "../../core/views";
import type { ViewContext } from "../../core/views";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
import { useCreateTask } from "../actions";
import { usePlugin } from "../context";
import {
	useSelection,
	useShortcuts,
	useVisualLayout,
	type FocusLayout,
} from "../selection";
import { useTabs } from "../tabs-context";
import { BoardView } from "./BoardView";
import { ListView } from "./ListView";
import { ViewControls } from "./ViewControls";
import { useViewDraft } from "./useViewDraft";

export function TaskViewport({
	snapshot,
	view,
	taxonomies,
	context,
	containerRef,
	active,
	onSelectView,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
	/** The shell element list shortcuts bind to. */
	containerRef: HTMLElement | null;
	/** True while this viewport's tab is the one on screen. */
	active: boolean;
	/** Switch the sidebar/tab to another Saved View, after "Save as…". */
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const selection = useSelection();
	const createTask = useCreateTask();
	const tabs = useTabs();

	const showArchived = plugin.settings.showArchived;

	// Bar edits are held as an unsaved draft (see `useViewDraft`) — everything
	// below renders `draft.effective`, never the on-disk view directly.
	const draft = useViewDraft(snapshot, view);
	const effective = draft.effective;

	const evaluated = useMemo(() => {
		// "Show archived" is a session preference layered over the saved view,
		// not an edit to it (§7.7).
		const filters = showArchived
			? { ...effective.filters, includeArchived: true }
			: effective.filters;
		return evaluateView(snapshot, { ...effective, filters }, context);
	}, [snapshot, context, effective, showArchived]);

	/**
	 * The layout keyboard navigation walks.
	 *
	 * Derived from the rendered groups, never from `evaluated.tasks` — the flat
	 * task list is in *sort* order, which on a grouped view interleaves columns.
	 * Walking that with ↑/↓ makes focus appear to jump between columns on every
	 * press.
	 *
	 * Board: one entry per column. List: one column, groups concatenated in
	 * render order. Collapsed groups contribute nothing, because you can't focus
	 * what you can't see.
	 */
	const layout = useMemo<FocusLayout>(() => {
		const visible = evaluated.groups.filter((group) => !group.hidden);
		const paths = (group: (typeof visible)[number]) =>
			group.collapsed ? [] : group.tasks.map((task) => task.path);

		return effective.viewType === "board"
			? visible.map(paths)
			: [visible.flatMap(paths)];
	}, [evaluated.groups, effective.viewType]);

	useVisualLayout(layout);

	// Pick up a task queued by something outside React — the quick-capture
	// command, which can fire while this view isn't even mounted, and the
	// task-note redirect (`file-open` in main.ts), which runs before React
	// exists at all on a cold start.
	useEffect(() => {
		const pending = plugin.pendingEditPath;
		if (!pending) return;
		plugin.pendingEditPath = null;
		tabs.openTask(pending);
	}, [plugin, tabs, evaluated]);

	useShortcuts(
		containerRef,
		[
			// Vim-style and arrow keys, both walking the visual layout: j/k within
			// a column, h/l across columns.
			{ key: "ArrowDown", run: () => selection.moveFocus(1) },
			{ key: "ArrowUp", run: () => selection.moveFocus(-1) },
			{ key: "j", run: () => selection.moveFocus(1) },
			{ key: "k", run: () => selection.moveFocus(-1) },
			{ key: "ArrowLeft", run: () => selection.moveColumn(-1) },
			{ key: "ArrowRight", run: () => selection.moveColumn(1) },
			{ key: "h", run: () => selection.moveColumn(-1) },
			{ key: "l", run: () => selection.moveColumn(1) },

			{ key: "a", mod: true, run: () => selection.selectAll() },
			{
				key: "x",
				run: () => {
					if (selection.focusedPath) {
						selection.select(selection.focusedPath, { toggle: true });
					}
				},
			},
			// Enter opens the task's own tab — the thing you almost always want.
			// Opening the raw Markdown note is the rarer, deliberate act, so it
			// gets its own key.
			{
				key: "Enter",
				run: () => {
					if (selection.focusedPath) tabs.openTask(selection.focusedPath);
				},
			},
			{
				key: "o",
				run: () => {
					if (selection.focusedPath) void plugin.mutations.open(selection.focusedPath);
				},
			},
			{ key: "c", run: () => void createTask(snapshot) },
			{
				key: "e",
				run: () => {
					const targets = selection.targets(evaluated.tasks);
					if (targets.length === 0) return;
					const archiving = !targets[0].archived;
					void plugin.mutations.bulkUpdate(targets, {
						archived: archiving,
						archivedAt: archiving ? new Date().toISOString() : null,
					});
				},
			},
		],
		// These act on the task list, so they're only live while this viewport's
		// tab is the one you're looking at. Escape is handled by App's unified
		// capture-phase listener instead, since it must work on every tab.
		active,
	);

	return (
		<>
			<ViewControls
				snapshot={snapshot}
				view={effective}
				savedView={view}
				draft={draft}
				taxonomies={taxonomies}
				evaluated={evaluated}
				onSelectView={onSelectView}
			/>
			{effective.viewType === "board" ? (
				<BoardView
					snapshot={snapshot}
					view={effective}
					evaluated={evaluated}
					taxonomies={taxonomies}
					onColumnsChange={draft.setColumns}
				/>
			) : (
				<ListView
					snapshot={snapshot}
					view={effective}
					evaluated={evaluated}
					taxonomies={taxonomies}
				/>
			)}
		</>
	);
}
