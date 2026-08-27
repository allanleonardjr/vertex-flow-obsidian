/**
 * Root component: onboarding when the vault has no workspaces, otherwise the
 * sidebar + one tab strip holding the Board/List plus every other open tab.
 */

import { useEffect, useMemo, useState } from "react";
import { evaluateView } from "../core/views";
import { useCreateTask } from "./actions";
import {
	useActiveView,
	useActiveWorkspace,
	usePlugin,
	useSettingsWriter,
	type ActiveWorkspace,
} from "./context";
import { EmptyState } from "./EmptyState";
import {
	SelectionProvider,
	useSelection,
	useShortcuts,
	useVisualLayout,
	type FocusLayout,
} from "./selection";
import { CyclesBrowseView } from "./browse/CyclesBrowseView";
import { InitiativesBrowseView } from "./browse/InitiativesBrowseView";
import { ProjectsBrowseView } from "./browse/ProjectsBrowseView";
import { Sidebar } from "./Sidebar";
import { WorkspaceSettingsView } from "./settings/WorkspaceSettingsView";
import { TabsProvider, useTabs } from "./tabs-context";
import { TabStrip } from "./TabStrip";
import { TaskPane } from "./TaskPane";
import { Toolbar } from "./Toolbar";
import { BoardView } from "./views/BoardView";
import { ListView } from "./views/ListView";

export function App() {
	const active = useActiveWorkspace();

	if (!active) return <EmptyState />;

	return (
		<SelectionProvider>
			<TabsProvider>
				{/* Remounting on workspace switch resets focus/selection/tabs, which
				    is the behaviour you want — a tab set built against the old
				    workspace is meaningless once you've switched away from it. */}
				<Workspace key={active.snapshot.workspace.root} active={active} />
			</TabsProvider>
		</SelectionProvider>
	);
}

function Workspace({ active }: { active: ActiveWorkspace }) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const selection = useSelection();
	const createTask = useCreateTask();
	const tabs = useTabs();
	// A state-backed ref, not `useRef`: attaching a plain ref doesn't re-render,
	// so the shortcut effect below would keep seeing `null` and bind nothing
	// until some unrelated update happened to re-run it.
	const [container, setContainer] = useState<HTMLDivElement | null>(null);

	const { snapshot } = active;
	const view = useActiveView(snapshot);
	const showArchived = plugin.settings.showArchived;
	const onWorkspaceTab = tabs.activeTab.kind === "workspace";

	const evaluated = useMemo(() => {
		// "Show archived" is a session preference layered over the saved view,
		// not an edit to it (§7.7).
		const filters = showArchived
			? { ...view.filters, includeArchived: true }
			: view.filters;
		return evaluateView(snapshot, { ...view, filters }, active.context);
	}, [snapshot, active.context, view, showArchived]);

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

		return view.viewType === "board"
			? visible.map(paths)
			: [visible.flatMap(paths)];
	}, [evaluated.groups, view.viewType]);

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

	// Escape closes whatever tab you're on (falling back to the pinned
	// Board/List tab, which can never itself be closed); on that pinned tab,
	// Escape does its ordinary job of clearing the selection instead.
	// Bound with `capture: true` on `window` — Obsidian registers its own
	// global Escape handling (closing suggest popups, blurring the active
	// editor) on `document`, and capture-phase listeners fire top-down
	// starting at `window`, so this has to sit above `document` in that chain
	// to see the key first.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;

			// The `[[`-link autocomplete popup wants Escape for itself first —
			// dismiss the popup, not the tab. It's portaled to `document.body`
			// as `.vf-autocomplete`, so its presence is a reliable, cheap check;
			// its own bubble-phase handler closes it once this steps aside.
			if (document.querySelector(".vf-autocomplete")) return;

			if (tabs.activeTab.kind === "workspace") {
				selection.clearSelection();
				return;
			}

			event.stopPropagation();
			if (event.shiftKey) tabs.closeAllTasks();
			else tabs.closeActive();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [tabs, selection]);

	useShortcuts(
		container,
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
		// These act on the task list, so they're only live while the pinned
		// Board/List tab is the one you're looking at. Escape is handled by the
		// unified capture-phase listener above instead of here, since it needs
		// to work identically no matter which tab is focused.
		onWorkspaceTab,
	);

	return (
		<div className="vf-shell" ref={setContainer} tabIndex={-1}>
			<Sidebar
				snapshot={snapshot}
				activeViewId={view.id}
				onSelectView={(id) => {
					tabs.activateWorkspace();
					writeSettings({
						activeViewByWorkspace: {
							...plugin.settings.activeViewByWorkspace,
							[snapshot.workspace.root]: id,
						},
					});
				}}
			/>

			<main className="vf-main">
				<TabStrip snapshot={snapshot} view={view} />

				{tabs.activeTab.kind === "task" ? (
					<TaskPane path={tabs.activeTab.path} />
				) : tabs.activeTab.kind === "initiatives" ? (
					<InitiativesBrowseView snapshot={snapshot} taxonomies={active.taxonomies} />
				) : tabs.activeTab.kind === "projects" ? (
					<ProjectsBrowseView snapshot={snapshot} taxonomies={active.taxonomies} />
				) : tabs.activeTab.kind === "cycles" ? (
					<CyclesBrowseView snapshot={snapshot} taxonomies={active.taxonomies} />
				) : tabs.activeTab.kind === "settings" ? (
					<WorkspaceSettingsView snapshot={snapshot} />
				) : (
					<>
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
								view={view}
								evaluated={evaluated}
								taxonomies={active.taxonomies}
							/>
						)}
					</>
				)}
			</main>
		</div>
	);
}
