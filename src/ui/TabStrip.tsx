/**
 * The one tab strip — always visible, holding the pinned "Tasks" tab plus
 * whatever Saved View / Projects / Settings / task tabs are open. Nothing
 * closable can ever leave you without a way back to it.
 */

import { useMemo } from "react";
import { getValue, workspaceTaxonomies } from "../core/taxonomy";
import { layoutIcon } from "../core/views";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { Icon } from "./components/Icon";
import { StatusDot } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs, type BrowseKind, type Tab } from "./tabs-context";

const BROWSE_ICON: Record<BrowseKind, string> = {
	projects: "▣",
	settings: "⚙",
	help: "?",
	"new-workspace": "＋",
};

const BROWSE_LABEL: Record<BrowseKind, string> = {
	projects: "Projects",
	settings: "Settings",
	help: "Help",
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

	// Task tabs show a bare title by default. Titles aren't unique across a
	// vault though — two tasks in different projects can share a name — so
	// once two *currently open* task tabs collide, both get their id
	// prefixed until one closes. Resolved fresh off the live index on every
	// render, same as `TabRow` resolves each task tab's own title.
	const duplicateTaskTitles = useMemo(() => {
		const seen = new Set<string>();
		const duplicates = new Set<string>();
		for (const tab of tabs) {
			if (tab.kind !== "task") continue;
			const task = plugin.index.taskAt(tab.path);
			if (!task) continue;
			if (seen.has(task.title)) duplicates.add(task.title);
			seen.add(task.title);
		}
		return duplicates;
	}, [tabs, plugin]);

	return (
		<div className="vf-tabs" role="tablist">
			{tabs.map((tab) => (
				<TabRow
					key={tab.id}
					tab={tab}
					active={tab.id === activeId}
					snapshot={snapshot}
					builtInView={builtInView}
					duplicateTaskTitles={duplicateTaskTitles}
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
	duplicateTaskTitles,
	onActivate,
	onClose,
	plugin,
}: {
	tab: Tab;
	active: boolean;
	snapshot: WorkspaceSnapshot;
	builtInView: SavedView;
	duplicateTaskTitles: Set<string>;
	onActivate: () => void;
	onClose: (() => void) | null;
	plugin: ReturnType<typeof usePlugin>;
}) {
	let icon: React.ReactNode;
	let label: React.ReactNode;

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
					fallback={layoutIcon(view.viewType)}
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
		label = duplicateTaskTitles.has(task.title) ? (
			<>
				<span className="vf-tab-id">{task.id}</span> {task.title}
			</>
		) : (
			task.title
		);
	} else if (tab.kind === "project") {
		// Resolved fresh via the index, not the passed `snapshot` — right after a
		// workspace switch this tab renders once more before App's prune effect
		// drops it, and `snapshot` is already the new workspace by then.
		const owner = plugin.index.workspaceFor(tab.path);
		const project = owner?.projects.find((p) => p.path === tab.path);
		if (!project) return null;
		icon = (
			<span className="vf-tab-icon">
				<Icon id={project.icon} fallback="folder" size={13} />
			</span>
		);
		label = project.title;
	} else {
		icon = <span className="vf-view-icon">{BROWSE_ICON[tab.kind]}</span>;
		label =
			tab.kind === "settings"
				? `Settings - ${snapshot.workspace.name}`
				: browseLabel(tab.kind);
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
