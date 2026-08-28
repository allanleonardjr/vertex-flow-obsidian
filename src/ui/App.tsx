/**
 * Root component: onboarding when the vault has no workspaces, otherwise the
 * sidebar + one tab strip holding the Board/List plus every other open tab.
 */

import { useEffect, useState } from "react";
import {
	useActiveView,
	useActiveWorkspace,
	usePlugin,
	useSettingsWriter,
	type ActiveWorkspace,
} from "./context";
import { EmptyState } from "./EmptyState";
import { SelectionProvider, useSelection } from "./selection";
import { CyclesBrowseView } from "./browse/CyclesBrowseView";
import { InitiativesBrowseView } from "./browse/InitiativesBrowseView";
import { ProjectsBrowseView } from "./browse/ProjectsBrowseView";
import { Sidebar } from "./Sidebar";
import { WorkspaceSettingsView } from "./settings/WorkspaceSettingsView";
import { TabsProvider, useTabs } from "./tabs-context";
import { TabStrip } from "./TabStrip";
import { TaskPane } from "./TaskPane";
import { TaskViewport } from "./views/TaskViewport";

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
	const tabs = useTabs();
	// A state-backed ref, not `useRef`: attaching a plain ref doesn't re-render,
	// so the shortcut effect below would keep seeing `null` and bind nothing
	// until some unrelated update happened to re-run it.
	const [container, setContainer] = useState<HTMLDivElement | null>(null);

	const { snapshot } = active;
	const view = useActiveView(snapshot);
	const onWorkspaceTab = tabs.activeTab.kind === "workspace";

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
					<TaskViewport
						snapshot={snapshot}
						view={view}
						taxonomies={active.taxonomies}
						context={active.context}
						containerRef={container}
						active={onWorkspaceTab}
					/>
				)}
			</main>
		</div>
	);
}
