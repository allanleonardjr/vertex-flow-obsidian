/**
 * Sidebar (§9.5): workspace switcher, Saved Views (create / rename / duplicate /
 * delete), and navigation to the Projects browse tab and workspace Settings.
 */

import { useEffect, useState } from "react";
import { BUILT_IN_VIEW_ID, newView } from "../core/views";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { usePlugin, useSettingsWriter, useWorkspaces } from "./context";
import { FEATURES } from "./features";
import { ViewDialog } from "./modals/ViewDialog";
import { WorkspaceDialog, type WorkspaceDialogMode } from "./modals/WorkspaceDialog";
import { useTabs } from "./tabs-context";

export function Sidebar({
	snapshot,
	activeViewId,
	onSelectView,
}: {
	snapshot: WorkspaceSnapshot;
	activeViewId: string;
	onSelectView: (id: string) => void;
}) {
	const { activeId, openScreen } = useTabs();
	const onWorkspaceTab = activeId === "workspace";

	return (
		<aside className="vf-sidebar">
			<WorkspaceSwitcher snapshot={snapshot} />

			<ViewsSection
				snapshot={snapshot}
				activeViewId={activeViewId}
				onWorkspaceTab={onWorkspaceTab}
				onSelectView={onSelectView}
			/>

			<Section title="Workspace">
				{FEATURES.initiatives && (
					<ScreenRow
						label="Initiatives"
						icon="◆"
						active={activeId === "initiatives"}
						onClick={() => openScreen("initiatives")}
					/>
				)}
				<ScreenRow
					label="Projects"
					icon="▣"
					active={activeId === "projects"}
					onClick={() => openScreen("projects")}
				/>
				{/* Cycles are opt-in (§7.5) — the nav entry only exists once a
				    workspace has turned them on, and not before v1 surfaces the
				    feature at all (see features.ts). */}
				{FEATURES.cycles && snapshot.workspace.cycles.enabled && (
					<ScreenRow
						label={`${snapshot.workspace.cycles.termLabel}s`}
						icon="↻"
						active={activeId === "cycles"}
						onClick={() => openScreen("cycles")}
					/>
				)}
			</Section>

			<div className="vf-sidebar-spacer" />

			<Section title="">
				<ScreenRow
					label="Settings"
					icon="⚙"
					active={activeId === "settings"}
					onClick={() => openScreen("settings")}
				/>
			</Section>
		</aside>
	);
}

/**
 * Workspace switcher, and the only route to creating another one.
 *
 * Always rendered, even with a single workspace: without it, a vault that
 * already has one workspace offers no way to make a second, and the onboarding
 * screen that used to offer that is unreachable once any workspace exists.
 */
function WorkspaceSwitcher({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const workspaces = useWorkspaces();
	const writeSettings = useSettingsWriter();
	const [open, setOpen] = useState(false);
	const [dialog, setDialog] = useState<WorkspaceDialogMode | null>(null);

	// Any click outside closes the menu.
	useEffect(() => {
		if (!open) return;
		const close = () => setOpen(false);
		window.addEventListener("click", close);
		return () => window.removeEventListener("click", close);
	}, [open]);

	return (
		<div className="vf-workspace">
			<button
				className="vf-workspace-button"
				aria-expanded={open}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				<span className="vf-nav-label">{snapshot.workspace.name}</span>
				<span className="vf-caret">⌄</span>
			</button>

			{open && (
				<div className="vf-menu" onClick={(event) => event.stopPropagation()}>
					{workspaces.map((entry) => (
						<button
							key={entry.workspace.root}
							className={`vf-menu-item${
								entry.workspace.root === snapshot.workspace.root
									? " is-active"
									: ""
							}`}
							onClick={() => {
								writeSettings({ activeWorkspaceRoot: entry.workspace.root });
								setOpen(false);
							}}
						>
							<span className="vf-nav-label">{entry.workspace.name}</span>
							<span className="vf-menu-hint">{entry.workspace.idPrefix}</span>
						</button>
					))}

					<div className="vf-menu-separator" />

					<button
						className="vf-menu-item"
						onClick={() => {
							setDialog("create");
							setOpen(false);
						}}
					>
						New workspace…
					</button>
					<button
						className="vf-menu-item"
						onClick={() => {
							setDialog("sample");
							setOpen(false);
						}}
					>
						Sample workspace…
					</button>
				</div>
			)}

			{dialog && (
				<WorkspaceDialog mode={dialog} onClose={() => setDialog(null)} />
			)}
		</div>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="vf-sidebar-section">
			{title && <div className="vf-sidebar-heading">{title}</div>}
			{children}
		</div>
	);
}

type ViewDialogState =
	| { mode: "create"; view: SavedView }
	| { mode: "rename"; view: SavedView }
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
		void plugin.mutations.addView(snapshot, copy).then(() => onSelectView(copy.id));
	};

	const remove = (view: SavedView) => {
		if (view.id === BUILT_IN_VIEW_ID) return;
		const fallback =
			snapshot.views.find((v) => v.id !== view.id)?.id ?? BUILT_IN_VIEW_ID;
		void plugin.mutations.deleteView(snapshot, view.id).then(() => {
			if (view.id === activeViewId) onSelectView(fallback);
		});
	};

	return (
		<div className="vf-sidebar-section">
			<div className="vf-sidebar-heading">
				<span>Views</span>
				<button
					className="vf-sidebar-heading-action"
					title="New view"
					onClick={create}
				>
					+
				</button>
			</div>

			{snapshot.views.map((view) => (
				<ViewRow
					key={view.id}
					view={view}
					active={onWorkspaceTab && view.id === activeViewId}
					menuOpen={menuOpenId === view.id}
					onClick={() => onSelectView(view.id)}
					onOpenMenu={() =>
						setMenuOpenId((current) => (current === view.id ? null : view.id))
					}
					onCloseMenu={() => setMenuOpenId(null)}
					onRename={() => setDialog({ mode: "rename", view })}
					onDuplicate={() => duplicate(view)}
					onDelete={() => remove(view)}
				/>
			))}

			{dialog && (
				<ViewDialog
					title={dialog.mode === "create" ? "Name your view" : "Rename view"}
					initialName={dialog.view.name}
					confirmLabel={dialog.mode === "create" ? "Create" : "Rename"}
					onConfirm={(name) =>
						void plugin.mutations.updateView(snapshot, {
							...dialog.view,
							name,
						})
					}
					onClose={() => setDialog(null)}
				/>
			)}
		</div>
	);
}

function ViewRow({
	view,
	active,
	menuOpen,
	onClick,
	onOpenMenu,
	onCloseMenu,
	onRename,
	onDuplicate,
	onDelete,
}: {
	view: SavedView;
	active: boolean;
	menuOpen: boolean;
	onClick: () => void;
	onOpenMenu: () => void;
	onCloseMenu: () => void;
	onRename: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}) {
	// Any click outside closes the menu.
	useEffect(() => {
		if (!menuOpen) return;
		window.addEventListener("click", onCloseMenu);
		return () => window.removeEventListener("click", onCloseMenu);
	}, [menuOpen, onCloseMenu]);

	return (
		<div className="vf-view-row">
			<button
				className={`vf-nav-row${active ? " is-active" : ""}`}
				onClick={onClick}
				aria-current={active ? "page" : undefined}
			>
				<span className="vf-view-icon">
					{view.viewType === "board" ? "▦" : "☰"}
				</span>
				<span className="vf-nav-label">{view.name}</span>
			</button>

			<button
				className="vf-view-row-menu"
				title="View options"
				aria-label="View options"
				onClick={(event) => {
					event.stopPropagation();
					onOpenMenu();
				}}
			>
				⋯
			</button>

			{menuOpen && (
				<div className="vf-menu" onClick={(event) => event.stopPropagation()}>
					<button
						className="vf-menu-item"
						onClick={() => {
							onCloseMenu();
							onRename();
						}}
					>
						Rename
					</button>
					<button
						className="vf-menu-item"
						onClick={() => {
							onCloseMenu();
							onDuplicate();
						}}
					>
						Duplicate
					</button>
					{view.id !== BUILT_IN_VIEW_ID && (
						<button
							className="vf-menu-item"
							onClick={() => {
								onCloseMenu();
								onDelete();
							}}
						>
							Delete
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function ScreenRow({
	label,
	icon,
	active,
	onClick,
}: {
	label: string;
	icon: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			className={`vf-nav-row${active ? " is-active" : ""}`}
			onClick={onClick}
			aria-current={active ? "page" : undefined}
		>
			<span className="vf-view-icon">{icon}</span>
			<span className="vf-nav-label">{label}</span>
		</button>
	);
}
