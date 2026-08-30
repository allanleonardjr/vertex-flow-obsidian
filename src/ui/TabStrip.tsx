/**
 * The one tab strip — holding whatever Saved View / Projects / Settings / task
 * tabs are open. Every tab is closable and freely reorderable; when the strip
 * empties the shell shows its empty-tabs pane instead.
 */

import { Fragment, useMemo } from "react";
import { createPortal } from "react-dom";
import { getValue, workspaceTaxonomies } from "../core/taxonomy";
import { isSystemViewId, layoutIcon } from "../core/views";
import type { WorkspaceSnapshot } from "../core/types";
import { Icon } from "./components/Icon";
import { StatusDot } from "./components/TaskBits";
import { usePlugin } from "./context";
import {
	tabWorkspaceRoot,
	useTabs,
	type BrowseKind,
	type Tab,
} from "./tabs-context";
import { workspaceAccentColor } from "../core/workspace-color";
import { useTabDrag } from "./useTabDrag";
import { PREVIEW_OFFSET_PX } from "./views/useTaskDrag";

const BROWSE_ICON: Record<BrowseKind, string> = {
	projects: "▣",
	settings: "⚙",
	help: "?",
	"new-workspace": "＋",
	dashboards: "▦",
	views: "▤",
	trash: "🗑",
};

const BROWSE_LABEL: Record<BrowseKind, string> = {
	projects: "Projects",
	settings: "Settings",
	help: "Help",
	"new-workspace": "New workspace",
	dashboards: "Dashboards",
	views: "Views",
	trash: "Trash",
};

function browseLabel(kind: BrowseKind): string {
	return BROWSE_LABEL[kind];
}

/** The two System Views read as their bare name — "All Tasks - View" is noise. */
function isPermanentView(viewId: string): boolean {
	return isSystemViewId(viewId);
}

export function TabStrip({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { tabs, activeId, activate, close, reorder, getViewDraft, getDashboardDraft } =
		useTabs();
	const drag = useTabDrag(reorder);

	// A View/Dashboard tab holding a transient draft (the only unsaved state in
	// the app) shows a dot in place of its close button — see `TabRow`.
	const isTabDirty = (tab: Tab): boolean =>
		tab.kind === "view"
			? getViewDraft(tab.viewId) != null
			: tab.kind === "dashboard"
				? getDashboardDraft(tab.dashboardId) != null
				: false;

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

	// Each tab's owning workspace root (null only for the browse screens now —
	// System View tabs carry their own root). Resolved fresh off the live index,
	// same convention as `duplicateTaskTitles`.
	const tabRoots = useMemo(() => {
		const map = new Map<string, string | null>();
		for (const tab of tabs) map.set(tab.id, tabWorkspaceRoot(plugin, tab));
		return map;
	}, [tabs, plugin]);

	// A System View (All Tasks / Untriaged) open for more than one workspace at
	// once — both tabs would otherwise read the same bare name, so each gets its
	// workspace appended. Same self-disambiguating pattern as `duplicateTaskTitles`.
	const duplicateSystemViews = useMemo(() => {
		const seen = new Set<string>();
		const duplicates = new Set<string>();
		for (const tab of tabs) {
			if (tab.kind !== "view" || !isSystemViewId(tab.viewId)) continue;
			if (seen.has(tab.viewId)) duplicates.add(tab.viewId);
			seen.add(tab.viewId);
		}
		return duplicates;
	}, [tabs]);

	// Accents appear the moment an open tab points at a workspace *other than*
	// the one on screen — whether that's a second workspace's tab sitting
	// alongside this one's, or the lone tab left behind after switching the
	// active workspace out from under it. Pure derived state, never toggled.
	const activeRoot = snapshot.workspace.root;
	const showWorkspaceAccents = useMemo(() => {
		for (const root of tabRoots.values())
			if (root && root !== activeRoot) return true;
		return false;
	}, [tabRoots, activeRoot]);

	const dragging = drag.drag != null;
	const draggedTab = drag.drag
		? tabs.find((tab) => tab.id === drag.drag?.tabId)
		: undefined;
	const draggedContent = draggedTab
		? tabContent(
				draggedTab,
				snapshot,
				duplicateTaskTitles,
				duplicateSystemViews,
				plugin,
			)
		: null;

	return (
		<div className="vf-tabs" role="tablist">
			{tabs.map((tab, index) => {
				const root = tabRoots.get(tab.id) ?? null;
				const accentColor =
					showWorkspaceAccents && root
						? workspaceAccentColor(root)
						: undefined;
				return (
					<Fragment key={tab.id}>
						{dragging && drag.dropIndex === index && (
							<span className="vf-tab-drop-line" aria-hidden />
						)}
						<TabRow
							tab={tab}
							active={tab.id === activeId}
							dirty={isTabDirty(tab)}
							dragging={drag.isDragging(tab.id)}
							snapshot={snapshot}
							duplicateTaskTitles={duplicateTaskTitles}
							duplicateSystemViews={duplicateSystemViews}
							accentColor={accentColor}
							showWorkspaceAccents={showWorkspaceAccents}
							onPointerDown={(event) =>
								drag.onPointerDown(event, tab.id)
							}
							onActivate={() => {
								// A drag ends with a trailing click — don't let it also
								// switch tabs.
								if (drag.consumeDragClick()) return;
								void activate(tab.id);
							}}
							onClose={() => void close(tab.id)}
							plugin={plugin}
						/>
					</Fragment>
				);
			})}
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
	duplicateTaskTitles: Set<string>,
	duplicateSystemViews: Set<string>,
	plugin: ReturnType<typeof usePlugin>,
): {
	icon: React.ReactNode;
	label: React.ReactNode;
	ownerName?: string;
} | null {
	let icon: React.ReactNode;
	let label: React.ReactNode;
	let ownerName: string | undefined;

	if (tab.kind === "view") {
		// Resolved to the tab's own workspace, not the active `snapshot` — a view
		// tab can outlive a workspace switch (Tabs live above that boundary). A
		// System View tab carries its `root`; a user view is found by its
		// vault-unique id.
		const owner =
			(tab.root
				? plugin.index.get(tab.root)
				: plugin.index.snapshotWithView(tab.viewId)) ?? snapshot;
		const view = owner.views.find((v) => v.id === tab.viewId);
		if (!view) return null;
		ownerName = owner.workspace.name;
		icon = (
			<span className="vf-tab-icon">
				<Icon
					id={view.icon}
					fallback={layoutIcon(view.viewType)}
					size={13}
				/>
			</span>
		);
		label = !isPermanentView(view.id)
			? `${view.name} - View`
			: duplicateSystemViews.has(view.id)
				? `${view.name} - ${owner.workspace.name}`
				: view.name;
	} else if (tab.kind === "dashboard") {
		const owner =
			plugin.index.snapshotWithDashboard(tab.dashboardId) ?? snapshot;
		const dashboard = owner.dashboards.find((d) => d.id === tab.dashboardId);
		if (!dashboard) return null;
		ownerName = owner.workspace.name;
		icon = (
			<span className="vf-tab-icon">
				<Icon id={dashboard.icon} fallback="layout-dashboard" size={13} />
			</span>
		);
		label = `${dashboard.name} - Dashboard`;
	} else if (tab.kind === "label") {
		const owner = plugin.index.snapshotWithLabel(tab.labelId) ?? snapshot;
		const labelValue = getValue(
			workspaceTaxonomies(owner.workspace).label,
			tab.labelId,
		);
		if (!labelValue) return null;
		ownerName = owner.workspace.name;
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
		ownerName = owner.workspace.name;
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
		ownerName = owner?.workspace.name;
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

	return { icon, label, ownerName };
}

function TabRow({
	tab,
	active,
	dirty,
	dragging,
	snapshot,
	duplicateTaskTitles,
	duplicateSystemViews,
	accentColor,
	showWorkspaceAccents,
	onPointerDown,
	onActivate,
	onClose,
	plugin,
}: {
	tab: Tab;
	active: boolean;
	/** Holds a transient draft (view/dashboard only) — shows a dot, not ✕. */
	dirty: boolean;
	/** This tab is the one currently being dragged. */
	dragging: boolean;
	snapshot: WorkspaceSnapshot;
	duplicateTaskTitles: Set<string>;
	/** System View ids open for >1 workspace — those tabs get their workspace appended. */
	duplicateSystemViews: Set<string>;
	/** Owning-workspace accent, set only while tabs from >1 workspace are open. */
	accentColor?: string;
	/** True while tabs from more than one workspace are open — gates the tooltip. */
	showWorkspaceAccents: boolean;
	onPointerDown: (event: React.PointerEvent) => void;
	onActivate: () => void;
	onClose: () => void;
	plugin: ReturnType<typeof usePlugin>;
}) {
	const content = tabContent(
		tab,
		snapshot,
		duplicateTaskTitles,
		duplicateSystemViews,
		plugin,
	);
	if (!content) return null;

	return (
		<div
			role="tab"
			aria-selected={active}
			data-tab-id={tab.id}
			className={`vf-tab${active ? " is-active" : ""}${
				dragging ? " is-dragging" : ""
			}${accentColor ? " vf-tab-has-accent" : ""}`}
			style={
				accentColor
					? ({ "--vf-tab-accent": accentColor } as React.CSSProperties)
					: undefined
			}
			title={
				showWorkspaceAccents && accentColor
					? content.ownerName
					: undefined
			}
			onPointerDown={onPointerDown}
			onClick={onActivate}
		>
			{content.icon}
			<span className="vf-tab-title">{content.label}</span>
			<button
				className={`vf-tab-close${dirty ? " is-dirty" : ""}`}
				title={dirty ? "Unsaved changes — close tab" : "Close tab"}
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
			>
				{dirty ? (
					<>
						<span className="vf-tab-close-dot" aria-hidden />
						<span className="vf-tab-close-x" aria-hidden>
							✕
						</span>
					</>
				) : (
					"✕"
				)}
			</button>
		</div>
	);
}
