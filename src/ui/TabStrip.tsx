/**
 * The one tab strip — always visible, holding the pinned "Tasks" tab plus
 * whatever Saved View / Projects / Settings / task tabs are open. Nothing
 * closable can ever leave you without a way back to it.
 */

import { getValue, workspaceTaxonomies } from "../core/taxonomy";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { Icon } from "./components/Icon";
import { StatusDot } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs, type BrowseKind, type Tab } from "./tabs-context";

const BROWSE_ICON: Record<BrowseKind, string> = {
	projects: "▣",
	settings: "⚙",
	"new-workspace": "＋",
};

const BROWSE_LABEL: Record<BrowseKind, string> = {
	projects: "Projects",
	settings: "Settings",
	"new-workspace": "New workspace",
};

function browseLabel(kind: BrowseKind): string {
	return BROWSE_LABEL[kind];
}

export function TabStrip({
	snapshot,
	builtInView,
}: {
	snapshot: WorkspaceSnapshot;
	builtInView: SavedView;
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
					builtInView={builtInView}
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
	builtInView,
	onActivate,
	onClose,
	plugin,
}: {
	tab: Tab;
	active: boolean;
	snapshot: WorkspaceSnapshot;
	builtInView: SavedView;
	onActivate: () => void;
	onClose: (() => void) | null;
	plugin: ReturnType<typeof usePlugin>;
}) {
	let icon: React.ReactNode;
	let label: string;

	if (tab.kind === "workspace") {
		icon = (
			<span className="vf-tab-icon">
				<Icon id={builtInView.icon} fallback="list" size={13} />
			</span>
		);
		label = builtInView.name;
	} else if (tab.kind === "view") {
		const view = snapshot.views.find((v) => v.id === tab.viewId);
		if (!view) return null;
		icon = (
			<span className="vf-tab-icon">
				<Icon
					id={view.icon}
					fallback={view.viewType === "board" ? "columns-3" : "list"}
					size={13}
				/>
			</span>
		);
		label = `${view.name} - View`;
	} else if (tab.kind === "label") {
		const labelValue = getValue(
			workspaceTaxonomies(snapshot.workspace).label,
			tab.labelId,
		);
		if (!labelValue) return null;
		icon = (
			<span
				className="vf-label-dot vf-tab-icon"
				style={{ backgroundColor: labelValue.color }}
			/>
		);
		label = `${labelValue.name} - Label`;
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
		label = browseLabel(tab.kind);
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
