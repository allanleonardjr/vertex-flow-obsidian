/**
 * The one tab strip — always visible, holding the pinned "Tasks" tab plus
 * whatever Saved View / Projects / Settings / task tabs are open. Nothing
 * closable can ever leave you without a way back to it.
 */

import { Fragment, useMemo } from "react";
import { createPortal } from "react-dom";
import { getValue, workspaceTaxonomies } from "../core/taxonomy";
import { layoutIcon } from "../core/views";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { Icon } from "./components/Icon";
import { StatusDot } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs, type BrowseKind, type Tab } from "./tabs-context";
import { useTabDrag } from "./useTabDrag";
import { PREVIEW_OFFSET_PX } from "./views/useTaskDrag";

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
	const { tabs, activeId, activate, close, reorder } = useTabs();
	const drag = useTabDrag(reorder);

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

	const dragging = drag.drag != null;
	const draggedTab = drag.drag
		? tabs.find((tab) => tab.id === drag.drag?.tabId)
		: undefined;
	const draggedContent = draggedTab
		? tabContent(draggedTab, snapshot, builtInView, duplicateTaskTitles, plugin)
		: null;

	return (
		<div className="vf-tabs" role="tablist">
			{tabs.map((tab, index) => (
				<Fragment key={tab.id}>
					{dragging && drag.dropIndex === index && (
						<span className="vf-tab-drop-line" aria-hidden />
					)}
					<TabRow
						tab={tab}
						active={tab.id === activeId}
						dragging={drag.isDragging(tab.id)}
						snapshot={snapshot}
						builtInView={builtInView}
						duplicateTaskTitles={duplicateTaskTitles}
						onPointerDown={
							tab.id === "workspace"
								? undefined
								: (event) => drag.onPointerDown(event, tab.id)
						}
						onActivate={() => {
							// A drag ends with a trailing click — don't let it also
							// switch tabs.
							if (drag.consumeDragClick()) return;
							void activate(tab.id);
						}}
						onClose={
							tab.id === "workspace" ? null : () => void close(tab.id)
						}
						plugin={plugin}
					/>
				</Fragment>
			))}
			{dragging && drag.dropIndex === tabs.length && (
				<span className="vf-tab-drop-line" aria-hidden />
			)}

			{drag.drag &&
				draggedContent &&
				createPortal(
					<div
						className="vf-drag-layer"
						style={{
							transform: `translate(${
								drag.drag.x + PREVIEW_OFFSET_PX
							}px, ${drag.drag.y + PREVIEW_OFFSET_PX}px)`,
							width: drag.drag.width,
						}}
						aria-hidden
					>
						<div className="vf-tab vf-tab-preview">
							{draggedContent.icon}
							<span className="vf-tab-title">{draggedContent.label}</span>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}

/**
 * The icon + label a tab shows, with no interactive wrapper — shared by the
 * rendered row and the drag preview. Returns `null` for a tab whose target has
 * gone (a just-deleted view, a task removed by sync); the row renders nothing.
 */
function tabContent(
	tab: Tab,
	snapshot: WorkspaceSnapshot,
	builtInView: SavedView,
	duplicateTaskTitles: Set<string>,
	plugin: ReturnType<typeof usePlugin>,
): { icon: React.ReactNode; label: React.ReactNode } | null {
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
	} else if (tab.kind === "dashboard") {
		const dashboard = snapshot.dashboards.find((d) => d.id === tab.dashboardId);
		if (!dashboard) return null;
		icon = (
			<span className="vf-tab-icon">
				<Icon id={dashboard.icon} fallback="layout-dashboard" size={13} />
			</span>
		);
		label = `${dashboard.name} - Dashboard`;
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

	return { icon, label };
}

function TabRow({
	tab,
	active,
	dragging,
	snapshot,
	builtInView,
	duplicateTaskTitles,
	onPointerDown,
	onActivate,
	onClose,
	plugin,
}: {
	tab: Tab;
	active: boolean;
	/** This tab is the one currently being dragged. */
	dragging: boolean;
	snapshot: WorkspaceSnapshot;
	builtInView: SavedView;
	duplicateTaskTitles: Set<string>;
	/** Absent for the pinned workspace tab, which can't be dragged. */
	onPointerDown?: (event: React.PointerEvent) => void;
	onActivate: () => void;
	onClose: (() => void) | null;
	plugin: ReturnType<typeof usePlugin>;
}) {
	const content = tabContent(
		tab,
		snapshot,
		builtInView,
		duplicateTaskTitles,
		plugin,
	);
	if (!content) return null;

	return (
		<div
			role="tab"
			aria-selected={active}
			data-tab-id={tab.id}
			className={`vf-tab${active ? " is-active" : ""}${
				tab.id === "workspace" ? " is-pinned" : ""
			}${dragging ? " is-dragging" : ""}`}
			onPointerDown={onPointerDown}
			onClick={onActivate}
		>
			{content.icon}
			<span className="vf-tab-title">{content.label}</span>
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
