/**
 * Sidebar (§9.5): a minimizable, drag-resizable rail of three collapsible
 * sections — Workspaces, Views, Projects — each showing an item count and a
 * "new" button, plus Settings pinned at the bottom.
 *
 * Every row is flat hoverable text with an editable icon. The active view row
 * shows accent text; the current workspace row is filled with the accent, since
 * the workspace is the primary selection.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BUILT_IN_VIEW_ID, layoutIcon, newView } from "../core/views";
import { newDashboard, newDashboardId } from "../core/dashboards";
import { isProjectTitleTaken } from "../core/serialization";
import {
	describeUsage,
	findTaxonomyUsage,
	planTaxonomyDeletion,
	workspaceTaxonomies,
	type TaxonomyDeletionPlan,
	type TaxonomyUsage,
} from "../core/taxonomy";
import type {
	DashboardConfig,
	Project,
	SavedView,
	WorkspaceSnapshot,
} from "../core/types";
import { Icon } from "./components/Icon";
import { LabelChip } from "./components/TaskBits";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { LabelDialog } from "./modals/LabelDialog";
import { ReplaceValueDialog } from "./settings/ReplaceValueDialog";
import { usePlugin, useSettingsWriter, useWorkspaces } from "./context";
import { NamedIconDialog } from "./modals/NamedIconDialog";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { useTabs } from "./tabs-context";

const MIN_WIDTH = 170;
const SLIVER_WIDTH = 44;
/** No fixed upper bound — only keep this much room for the content area. */
const MIN_CONTENT_WIDTH = 240;

/** The widest the sidebar may get right now, given the window. */
function maxSidebarWidth(): number {
	return Math.max(MIN_WIDTH, window.innerWidth - MIN_CONTENT_WIDTH);
}

export function Sidebar({
	snapshot,
	activeViewId,
	onSelectView,
}: {
	snapshot: WorkspaceSnapshot;
	activeViewId: string;
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const { activeId, openScreen } = useTabs();
	const onWorkspaceTab = activeId === "workspace";

	const minimized = plugin.settings.sidebarMinimized;
	const width = minimized
		? SLIVER_WIDTH
		: clamp(plugin.settings.sidebarWidth, MIN_WIDTH, maxSidebarWidth());

	return (
		<aside
			className={`vf-sidebar${minimized ? " is-minimized" : ""}`}
			style={{ width, flexBasis: width }}
		>
			<div className="vf-sidebar-top">
				<button
					className="vf-sidebar-minimize"
					title={minimized ? "Expand sidebar" : "Minimize sidebar"}
					aria-label={minimized ? "Expand sidebar" : "Minimize sidebar"}
					onClick={() => writeSettings({ sidebarMinimized: !minimized })}
				>
					{minimized ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
				</button>
			</div>

			{!minimized && (
				<>
					<WorkspacesSection snapshot={snapshot} />

					<ViewsSection
						snapshot={snapshot}
						activeViewId={activeViewId}
						onWorkspaceTab={onWorkspaceTab}
						onSelectView={onSelectView}
					/>

					<DashboardsSection snapshot={snapshot} />

					<ProjectsSection snapshot={snapshot} />

					<LabelsSection snapshot={snapshot} />

					<div className="vf-sidebar-spacer" />

					<div className="vf-sidebar-sep" aria-hidden />

					<NavRow
						icon="circle-help"
						label="Help"
						active={activeId === "help"}
						onClick={() => openScreen("help")}
					/>

					<NavRow
						icon="settings-glyph"
						label="Settings"
						active={activeId === "settings"}
						onClick={() => openScreen("settings")}
					/>

					<ResizeHandle
						width={width}
						onResize={(w) => writeSettings({ sidebarWidth: w })}
					/>
				</>
			)}
		</aside>
	);
}

function clamp(n: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, n));
}

function ResizeHandle({
	width,
	onResize,
}: {
	width: number;
	onResize: (width: number) => void;
}) {
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);

	return (
		<div
			className="vf-sidebar-resize"
			role="separator"
			aria-orientation="vertical"
			aria-valuenow={width}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				drag.current = { startX: event.clientX, startWidth: width };
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				if (!drag.current) return;
				const next = clamp(
					drag.current.startWidth + (event.clientX - drag.current.startX),
					MIN_WIDTH,
					maxSidebarWidth(),
				);
				onResize(next);
			}}
			onPointerUp={(event) => {
				if (!drag.current) return;
				drag.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onDoubleClick={() => onResize(220)}
			title="Drag to resize — double-click to reset"
		/>
	);
}

/* ---------------------------------------------------------------- section -- */

function Section({
	id,
	title,
	count,
	action,
	children,
}: {
	id: string;
	title: string;
	count: number;
	action?: ReactNode;
	children: ReactNode;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const collapsed = plugin.settings.sidebarCollapsed[id] === true;

	const toggle = () =>
		writeSettings({
			sidebarCollapsed: {
				...plugin.settings.sidebarCollapsed,
				[id]: !collapsed,
			},
		});

	return (
		<div className="vf-section">
			<div className="vf-section-head">
				<button
					className="vf-section-toggle"
					aria-expanded={!collapsed}
					onClick={toggle}
				>
					<span
						className={`vf-section-chevron${collapsed ? "" : " is-open"}`}
						aria-hidden
					>
						›
					</span>
					<span className="vf-section-title">{title}</span>
					<span className="vf-section-count">({count})</span>
				</button>
				{action && <div className="vf-section-action">{action}</div>}
			</div>
			{!collapsed && <div className="vf-section-body">{children}</div>}
		</div>
	);
}

function AddButton({
	title,
	onClick,
}: {
	title: string;
	onClick: (event: React.MouseEvent) => void;
}) {
	return (
		<button
			className="vf-section-add"
			title={title}
			aria-label={title}
			onClick={(event) => {
				event.stopPropagation();
				onClick(event);
			}}
		>
			+
		</button>
	);
}

/* -------------------------------------------------------------------- row -- */

function NavRow({
	label,
	icon,
	iconFallback,
	chipColor,
	active,
	variant,
	onClick,
	trailing,
}: {
	label: string;
	/** Curated icon id, or the sentinel "settings-glyph". */
	icon?: string;
	iconFallback?: string;
	/** Render the label text as a tinted pill in this colour — labels use this. */
	chipColor?: string;
	active?: boolean;
	variant?: "view" | "workspace";
	onClick: () => void;
	trailing?: ReactNode;
}) {
	const cls = [
		"vf-nav-row",
		active && variant === "workspace" ? "is-current" : "",
		active && variant !== "workspace" ? "is-active" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div className="vf-nav-row-wrap">
			<button
				className={cls}
				onClick={onClick}
				aria-current={active ? "page" : undefined}
			>
				{chipColor !== undefined ? (
					<LabelChip name={label} color={chipColor} className="vf-nav-chip" />
				) : (
					<>
						<span className="vf-nav-icon" aria-hidden>
							{icon === "settings-glyph" ? (
								"⚙"
							) : (
								<Icon id={icon} fallback={iconFallback} size={14} />
							)}
						</span>
						<span className="vf-nav-label">{label}</span>
					</>
				)}
			</button>
			{trailing}
		</div>
	);
}

function RowMenu({
	open,
	onToggle,
	onClose,
	children,
}: {
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
	children: ReactNode;
}) {
	useEffect(() => {
		if (!open) return;
		window.addEventListener("click", onClose);
		return () => window.removeEventListener("click", onClose);
	}, [open, onClose]);

	return (
		<>
			<button
				className="vf-nav-row-menu"
				title="Options"
				aria-label="Options"
				onClick={(event) => {
					event.stopPropagation();
					onToggle();
				}}
			>
				⋯
			</button>
			{open && (
				<div className="vf-menu" onClick={(event) => event.stopPropagation()}>
					{children}
				</div>
			)}
		</>
	);
}

/* ------------------------------------------------------------- workspaces -- */

function WorkspacesSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const workspaces = useWorkspaces();
	const writeSettings = useSettingsWriter();
	const tabs = useTabs();
	const [menuRoot, setMenuRoot] = useState<string | null>(null);
	const [editRoot, setEditRoot] = useState<string | null>(null);
	const [deleteRoot, setDeleteRoot] = useState<string | null>(null);

	const editing = workspaces.find((w) => w.workspace.root === editRoot);
	const deleting = workspaces.find((w) => w.workspace.root === deleteRoot);

	return (
		<Section
			id="workspaces"
			title="Workspaces"
			count={workspaces.length}
			action={
				<AddButton
					title="New workspace"
					onClick={() => tabs.openScreen("new-workspace")}
				/>
			}
		>
			{workspaces.map((entry) => (
				<NavRow
					key={entry.workspace.root}
					label={entry.workspace.name}
					icon={entry.workspace.icon}
					iconFallback="layers"
					variant="workspace"
					active={entry.workspace.root === snapshot.workspace.root}
					onClick={() =>
						writeSettings({ activeWorkspaceRoot: entry.workspace.root })
					}
					trailing={
						<RowMenu
							open={menuRoot === entry.workspace.root}
							onToggle={() =>
								setMenuRoot((r) =>
									r === entry.workspace.root ? null : entry.workspace.root,
								)
							}
							onClose={() => setMenuRoot(null)}
						>
							<button
								className="vf-menu-item"
								onClick={() => {
									setMenuRoot(null);
									setEditRoot(entry.workspace.root);
								}}
							>
								Edit
							</button>
							<button
								className="vf-menu-item"
								onClick={() => {
									setMenuRoot(null);
									writeSettings({
										activeWorkspaceRoot: entry.workspace.root,
									});
									tabs.openScreen("settings");
								}}
							>
								Settings
							</button>
							<div className="vf-menu-divider" aria-hidden />
							<button
								className="vf-menu-item vf-menu-item-danger"
								onClick={() => {
									setMenuRoot(null);
									setDeleteRoot(entry.workspace.root);
								}}
							>
								Delete
							</button>
						</RowMenu>
					}
				/>
			))}

			{editing && (
				<NamedIconDialog
					title="Edit workspace"
					initialName={editing.workspace.name}
					initialIcon={editing.workspace.icon}
					iconFallback="layers"
					confirmLabel="Save"
					onConfirm={(name, icon) =>
						void plugin.mutations.saveWorkspaceConfig({
							...editing.workspace,
							name,
							icon,
						})
					}
					onClose={() => setEditRoot(null)}
				/>
			)}

			{deleting && (
				<DeleteWorkspaceDialog
					snapshot={deleting}
					onClose={() => setDeleteRoot(null)}
				/>
			)}
		</Section>
	);
}

/* ------------------------------------------------------------------ views -- */

type ViewDialogState =
	| { mode: "create"; view: SavedView }
	| { mode: "edit"; view: SavedView }
	| null;

function ViewsSection({
	snapshot,
	activeViewId,
	onWorkspaceTab,
	onSelectView,
}: {
	snapshot: WorkspaceSnapshot;
	activeViewId: string;
	onWorkspaceTab: boolean;
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
	const [dialog, setDialog] = useState<ViewDialogState>(null);
	const [deleting, setDeleting] = useState<SavedView | null>(null);

	const newId = () => `view-${Date.now().toString(36)}`;

	const create = () => {
		const view = newView(newId(), "New view", "list");
		void plugin.mutations.addView(snapshot, view).then(() => {
			onSelectView(view.id);
			setDialog({ mode: "create", view });
		});
	};

	const duplicate = (view: SavedView) => {
		const copy: SavedView = { ...view, id: newId(), name: `${view.name} copy` };
		void plugin.mutations
			.addView(snapshot, copy)
			.then(() => onSelectView(copy.id));
	};

	const remove = (view: SavedView) => {
		if (view.id === BUILT_IN_VIEW_ID) return;
		// The view's tab (if open) is closed by App's `pruneViews` once the view
		// leaves `snapshot.views` — which also drops you back to the pinned tab.
		void plugin.mutations.deleteView(snapshot, view.id);
	};

	return (
		<Section
			id="views"
			title="Views"
			count={snapshot.views.length}
			action={<AddButton title="New view" onClick={create} />}
		>
			{snapshot.views.map((view) => (
				<NavRow
					key={view.id}
					label={view.name}
					icon={view.icon}
					iconFallback={layoutIcon(view.viewType)}
					variant="view"
					active={onWorkspaceTab && view.id === activeViewId}
					onClick={() => onSelectView(view.id)}
					trailing={
						<RowMenu
							open={menuOpenId === view.id}
							onToggle={() =>
								setMenuOpenId((current) =>
									current === view.id ? null : view.id,
								)
							}
							onClose={() => setMenuOpenId(null)}
						>
							<button
								className="vf-menu-item"
								onClick={() => {
									setMenuOpenId(null);
									setDialog({ mode: "edit", view });
								}}
							>
								Edit
							</button>
							<button
								className="vf-menu-item"
								onClick={() => {
									setMenuOpenId(null);
									duplicate(view);
								}}
							>
								Duplicate
							</button>
							{view.id !== BUILT_IN_VIEW_ID && (
								<button
									className="vf-menu-item vf-menu-item-danger"
									onClick={() => {
										setMenuOpenId(null);
										setDeleting(view);
									}}
								>
									Delete
								</button>
							)}
						</RowMenu>
					}
				/>
			))}

			{deleting && (
				<ConfirmDeleteDialog
					title={`Delete view "${deleting.name}"?`}
					body="The view definition is removed. Tasks are not affected."
					onCancel={() => setDeleting(null)}
					onConfirm={() => {
						remove(deleting);
						setDeleting(null);
					}}
				/>
			)}

			{dialog && (
				<NamedIconDialog
					title={dialog.mode === "create" ? "Name your view" : "Edit view"}
					initialName={dialog.view.name}
					initialIcon={dialog.view.icon}
					iconFallback={layoutIcon(dialog.view.viewType)}
					confirmLabel={dialog.mode === "create" ? "Create" : "Save"}
					onConfirm={(name, icon) =>
						void plugin.mutations.updateView(snapshot, {
							...dialog.view,
							name,
							icon,
						})
					}
					onClose={() => setDialog(null)}
				/>
			)}
		</Section>
	);
}

/* ------------------------------------------------------------- dashboards -- */

type DashboardDialogState =
	| { mode: "create"; dashboard: DashboardConfig }
	| { mode: "edit"; dashboard: DashboardConfig }
	| null;

function DashboardsSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { activeTab, openDashboard } = useTabs();
	const [menuId, setMenuId] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DashboardDialogState>(null);
	const [deleting, setDeleting] = useState<DashboardConfig | null>(null);

	const dashboards = [...snapshot.dashboards].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const activeDashboardId =
		activeTab.kind === "dashboard" ? activeTab.dashboardId : null;

	// Mirror the "new view" flow: create with a default name, then open the
	// name + icon modal to finish it.
	const create = () => {
		const dashboard = newDashboard(newDashboardId(), "New dashboard");
		void plugin.mutations.addDashboard(snapshot, dashboard).then(() => {
			openDashboard(dashboard.id);
			setDialog({ mode: "create", dashboard });
		});
	};

	const duplicate = (id: string) => {
		const source = snapshot.dashboards.find((d) => d.id === id);
		if (!source) return;
		const copy: DashboardConfig = {
			...source,
			id: newDashboardId(),
			name: `${source.name} copy`,
			widgets: source.widgets.map((w) => ({ ...w })),
		};
		void plugin.mutations
			.addDashboard(snapshot, copy)
			.then(() => openDashboard(copy.id));
	};

	return (
		<Section
			id="dashboards"
			title="Dashboards"
			count={dashboards.length}
			action={<AddButton title="New dashboard" onClick={create} />}
		>
			{dashboards.length === 0 ? (
				<p className="vf-section-empty">No dashboards yet</p>
			) : (
				dashboards.map((dashboard) => (
					<NavRow
						key={dashboard.id}
						label={dashboard.name}
						icon={dashboard.icon}
						iconFallback="layout-dashboard"
						variant="view"
						active={activeDashboardId === dashboard.id}
						onClick={() => openDashboard(dashboard.id)}
						trailing={
							<RowMenu
								open={menuId === dashboard.id}
								onToggle={() =>
									setMenuId((m) => (m === dashboard.id ? null : dashboard.id))
								}
								onClose={() => setMenuId(null)}
							>
								<button
									className="vf-menu-item"
									onClick={() => {
										setMenuId(null);
										setDialog({ mode: "edit", dashboard });
									}}
								>
									Edit
								</button>
								<button
									className="vf-menu-item"
									onClick={() => {
										setMenuId(null);
										duplicate(dashboard.id);
									}}
								>
									Duplicate
								</button>
								<button
									className="vf-menu-item vf-menu-item-danger"
									onClick={() => {
										setMenuId(null);
										setDeleting(dashboard);
									}}
								>
									Delete
								</button>
							</RowMenu>
						}
					/>
				))
			)}

			{dialog && (
				<NamedIconDialog
					title={
						dialog.mode === "create" ? "Name your dashboard" : "Edit dashboard"
					}
					initialName={dialog.dashboard.name}
					initialIcon={dialog.dashboard.icon}
					iconFallback="layout-dashboard"
					confirmLabel={dialog.mode === "create" ? "Create" : "Save"}
					onConfirm={(name, icon) =>
						void plugin.mutations.updateDashboard(snapshot, {
							...dialog.dashboard,
							name,
							icon,
						})
					}
					onClose={() => setDialog(null)}
				/>
			)}

			{deleting && (
				<ConfirmDeleteDialog
					title={`Delete dashboard "${deleting.name}"?`}
					body={`Removes the dashboard and its ${deleting.widgets.length} chart${deleting.widgets.length === 1 ? "" : "s"}. Tasks are not affected.`}
					onCancel={() => setDeleting(null)}
					onConfirm={() => {
						void plugin.mutations.deleteDashboard(snapshot, deleting.id);
						setDeleting(null);
					}}
				/>
			)}
		</Section>
	);
}

/* --------------------------------------------------------------- projects -- */

function ProjectsSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const tabs = useTabs();
	const [menuPath, setMenuPath] = useState<string | null>(null);
	const [editing, setEditing] = useState<Project | null>(null);
	const [creating, setCreating] = useState(false);

	const projects = [...snapshot.projects].sort((a, b) =>
		a.title.localeCompare(b.title),
	);

	return (
		<Section
			id="projects"
			title="Projects"
			count={projects.length}
			action={
				<AddButton title="New project" onClick={() => setCreating(true)} />
			}
		>
			{projects.length === 0 ? (
				<p className="vf-section-empty">No projects yet</p>
			) : (
				projects.map((project) => (
					<NavRow
						key={project.path}
						label={project.title}
						icon={project.icon}
						iconFallback="folder"
						onClick={() => tabs.openProject(project.path)}
						trailing={
							<RowMenu
								open={menuPath === project.path}
								onToggle={() =>
									setMenuPath((p) =>
										p === project.path ? null : project.path,
									)
								}
								onClose={() => setMenuPath(null)}
							>
								<button
									className="vf-menu-item"
									onClick={() => {
										setMenuPath(null);
										setEditing(project);
									}}
								>
									Edit
								</button>
							</RowMenu>
						}
					/>
				))
			)}

			{creating && (
				<NamedIconDialog
					title="New project"
					initialName="New project"
					initialIcon="folder"
					confirmLabel="Create"
					validateName={(name) =>
						isProjectTitleTaken(snapshot.projects, name)
							? `A project named "${name.trim()}" already exists`
							: null
					}
					onConfirm={(name, icon) =>
						void plugin.mutations.createProject(snapshot, name, icon)
					}
					onClose={() => setCreating(false)}
				/>
			)}

			{editing && (
				<NamedIconDialog
					title="Edit project"
					initialName={editing.title}
					initialIcon={editing.icon}
					iconFallback="folder"
					confirmLabel="Save"
					validateName={(name) =>
						isProjectTitleTaken(snapshot.projects, name, editing.path)
							? `A project named "${name.trim()}" already exists`
							: null
					}
					onConfirm={(name, icon) =>
						void plugin.mutations.updateProject(editing, {
							title: name,
							icon,
						})
					}
					onClose={() => setEditing(null)}
				/>
			)}
		</Section>
	);
}

/* ----------------------------------------------------------------- labels -- */

function LabelsSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { activeTab, openLabel } = useTabs();
	const labels = workspaceTaxonomies(snapshot.workspace).label;
	const ordered = [...labels.values].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	const [menuId, setMenuId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [deletion, setDeletion] = useState<{
		plan: TaxonomyDeletionPlan;
		usage: TaxonomyUsage;
	} | null>(null);
	// Plain "are you sure?" gate, shown before the reassign / remove-from-all modal.
	const [confirming, setConfirming] = useState<{
		plan: TaxonomyDeletionPlan;
		usage: TaxonomyUsage;
	} | null>(null);

	const editLabel = ordered.find((l) => l.id === editing);
	const activeLabelId = activeTab.kind === "label" ? activeTab.labelId : null;

	const requestDelete = (id: string) => {
		const usage = findTaxonomyUsage("label", id, {
			tasks: snapshot.tasks,
			projects: snapshot.projects,
		});
		const plan = planTaxonomyDeletion(labels, id, usage.count);
		setConfirming({ plan, usage });
	};

	const performDelete = (plan: TaxonomyDeletionPlan, usage: TaxonomyUsage) => {
		setConfirming(null);
		if (!plan.blocked) {
			void plugin.mutations.applyTaxonomyDeletionPlan(
				snapshot,
				labels,
				plan,
				null,
			);
			return;
		}
		setDeletion({ plan, usage });
	};

	return (
		<Section
			id="labels"
			title="Labels"
			count={ordered.length}
			action={<AddButton title="New label" onClick={() => setCreating(true)} />}
		>
			{ordered.length === 0 ? (
				<p className="vf-section-empty">No labels yet</p>
			) : (
				ordered.map((label) => (
					<NavRow
						key={label.id}
						label={label.name}
						chipColor={label.color}
						active={activeLabelId === label.id}
						variant="view"
						onClick={() => openLabel(label.id)}
						trailing={
							<RowMenu
								open={menuId === label.id}
								onToggle={() =>
									setMenuId((m) => (m === label.id ? null : label.id))
								}
								onClose={() => setMenuId(null)}
							>
								<button
									className="vf-menu-item"
									onClick={() => {
										setMenuId(null);
										setEditing(label.id);
									}}
								>
									Edit
								</button>
								<button
									className="vf-menu-item"
									onClick={() => {
										setMenuId(null);
										requestDelete(label.id);
									}}
								>
									Delete
								</button>
							</RowMenu>
						}
					/>
				))
			)}

			{creating && (
				<LabelDialog
					title="New label"
					initialName="New label"
					confirmLabel="Create"
					onConfirm={(name, color) =>
						plugin.mutations.createLabel(snapshot, name, color).then(() => {})
					}
					onClose={() => setCreating(false)}
				/>
			)}

			{editLabel && (
				<LabelDialog
					title="Edit label"
					initialName={editLabel.name}
					initialColor={editLabel.color}
					confirmLabel="Save"
					onConfirm={(name, color) =>
						plugin.mutations.updateLabel(snapshot, editLabel.id, { name, color })
					}
					onClose={() => setEditing(null)}
				/>
			)}

			{confirming && (
				<ConfirmDeleteDialog
					title={`Delete label "${confirming.plan.valueName}"?`}
					body={
						confirming.plan.blocked
							? `It's on ${describeUsage(confirming.usage)} — you'll choose what happens to ${confirming.usage.count === 1 ? "it" : "them"} next.`
							: "This can't be undone."
					}
					onCancel={() => setConfirming(null)}
					onConfirm={() => performDelete(confirming.plan, confirming.usage)}
				/>
			)}

			{deletion && (
				<ReplaceValueDialog
					plan={deletion.plan}
					usage={deletion.usage}
					allowRemoveAll
					onCancel={() => setDeletion(null)}
					onConfirm={(replacementId) => {
						void plugin.mutations.applyTaxonomyDeletionPlan(
							snapshot,
							labels,
							deletion.plan,
							replacementId,
						);
						setDeletion(null);
					}}
				/>
			)}
		</Section>
	);
}
