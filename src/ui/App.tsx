/**
 * Root component: onboarding when the vault has no workspaces, otherwise the
 * sidebar + the active Saved View.
 */

import { useMemo, useRef } from "react";
import { evaluateView } from "../core/views";
import {
	useActiveView,
	useActiveWorkspace,
	usePlugin,
	useSettingsWriter,
	type ActiveWorkspace,
} from "./context";
import { EmptyState } from "./EmptyState";
import { QuickCaptureModal } from "./modals/QuickCaptureModal";
import {
	SelectionProvider,
	useSelection,
	useShortcuts,
	useVisualOrder,
} from "./selection";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { BoardView } from "./views/BoardView";
import { ListView } from "./views/ListView";

export function App() {
	const active = useActiveWorkspace();

	if (!active) return <EmptyState />;

	return (
		<SelectionProvider>
			{/* Remounting on workspace switch resets focus/selection, which is
			    the behaviour you want — a focused task from the old workspace is
			    meaningless in the new one. */}
			<Workspace key={active.snapshot.workspace.root} active={active} />
		</SelectionProvider>
	);
}

function Workspace({ active }: { active: ActiveWorkspace }) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const selection = useSelection();
	const containerRef = useRef<HTMLDivElement>(null);

	const { snapshot } = active;
	const view = useActiveView(snapshot);
	const showArchived = plugin.settings.showArchived;

	const evaluated = useMemo(() => {
		// "Show archived" is a session preference layered over the saved view,
		// not an edit to it (§7.7).
		const filters = showArchived
			? { ...view.filters, includeArchived: true }
			: view.filters;
		return evaluateView(snapshot, { ...view, filters }, active.context);
	}, [snapshot, active.context, view, showArchived]);

	useVisualOrder(evaluated.tasks);

	useShortcuts(containerRef.current, [
		{ key: "ArrowDown", run: () => selection.moveFocus(1) },
		{ key: "ArrowUp", run: () => selection.moveFocus(-1) },
		{ key: "j", run: () => selection.moveFocus(1) },
		{ key: "k", run: () => selection.moveFocus(-1) },
		{ key: "Escape", run: () => selection.clearSelection() },
		{ key: "a", mod: true, run: () => selection.selectAll() },
		{
			key: "x",
			run: () => {
				if (selection.focusedPath) {
					selection.select(selection.focusedPath, { toggle: true });
				}
			},
		},
		{
			key: "Enter",
			run: () => {
				if (selection.focusedPath) void plugin.mutations.open(selection.focusedPath);
			},
		},
		{
			key: "c",
			run: () => new QuickCaptureModal(plugin.app, plugin, snapshot).open(),
		},
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
	]);

	return (
		<div className="vf-shell" ref={containerRef} tabIndex={-1}>
			<Sidebar
				snapshot={snapshot}
				activeViewId={view.id}
				onSelectView={(id) =>
					writeSettings({
						activeViewByWorkspace: {
							...plugin.settings.activeViewByWorkspace,
							[snapshot.workspace.root]: id,
						},
					})
				}
			/>

			<main className="vf-main">
				<Toolbar snapshot={snapshot} view={view} evaluated={evaluated} />
				{view.viewType === "board" ? (
					<BoardView
						snapshot={snapshot}
						view={view}
						evaluated={evaluated}
						taxonomies={active.taxonomies}
					/>
				) : (
					<ListView
						snapshot={snapshot}
						evaluated={evaluated}
						taxonomies={active.taxonomies}
					/>
				)}
			</main>
		</div>
	);
}
