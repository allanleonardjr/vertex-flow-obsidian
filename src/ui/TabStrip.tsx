/**
 * The one tab strip — always visible, holding the pinned Board/List tab plus
 * whatever Initiatives/Projects/Cycles/Settings/task tabs are open. Nothing
 * closable can ever leave you without a way back to it.
 */

import { workspaceTaxonomies } from "../core/taxonomy";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { StatusDot } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs, type BrowseKind, type Tab } from "./tabs-context";

const BROWSE_ICON: Record<BrowseKind, string> = {
	initiatives: "◆",
	projects: "▣",
	cycles: "↻",
	settings: "⚙",
};

function browseLabel(kind: BrowseKind, snapshot: WorkspaceSnapshot): string {
	if (kind === "cycles") return `${snapshot.workspace.cycles.termLabel}s`;
	return kind[0].toUpperCase() + kind.slice(1);
}

export function TabStrip({
	snapshot,
	view,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
}) {
	const plugin = usePlugin();
	const { tabs, activeId, activate, close } = useTabs();

	return (
		<div className="vf-tabs" role="tablist">
			{tabs.map((tab) => (
				<TabRow
					key={tab.id}
					tab={tab}
					active={tab.id === activeId}
					snapshot={snapshot}
					view={view}
					onActivate={() => activate(tab.id)}
					onClose={tab.id === "workspace" ? null : () => close(tab.id)}
					plugin={plugin}
				/>
			))}
		</div>
	);
}

function TabRow({
	tab,
	active,
	snapshot,
	view,
	onActivate,
	onClose,
	plugin,
}: {
	tab: Tab;
	active: boolean;
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	onActivate: () => void;
	onClose: (() => void) | null;
	plugin: ReturnType<typeof usePlugin>;
}) {
	let icon: React.ReactNode;
	let label: string;

	if (tab.kind === "workspace") {
		icon = <span className="vf-view-icon">{view.viewType === "board" ? "▦" : "☰"}</span>;
		label = view.name;
	} else if (tab.kind === "task") {
		// Resolved fresh via the index, not the currently-active `snapshot` —
		// a task tab can outlive a workspace switch, so it has to find its own
		// owning workspace regardless of which one the app is showing right now.
		const owner = plugin.index.workspaceFor(tab.path);
		const task = plugin.index.taskAt(tab.path);
		if (!task || !owner) return null;
		icon = <StatusDot taxonomies={workspaceTaxonomies(owner.workspace)} status={task.status} />;
		label = task.title;
	} else {
		icon = <span className="vf-view-icon">{BROWSE_ICON[tab.kind]}</span>;
		label = browseLabel(tab.kind, snapshot);
	}

	return (
		<div
			role="tab"
			aria-selected={active}
			className={`vf-tab${active ? " is-active" : ""}${tab.id === "workspace" ? " is-pinned" : ""}`}
			onClick={onActivate}
		>
			{icon}
			<span className="vf-tab-title">{label}</span>
			{onClose && (
				<button
					className="vf-tab-close"
					title="Close tab"
					onClick={(event) => {
						event.stopPropagation();
						onClose();
					}}
				>
					✕
				</button>
			)}
		</div>
	);
}
