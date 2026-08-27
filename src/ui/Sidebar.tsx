/**
 * Sidebar (§9.5): workspace switcher, Saved Views, and navigation to the
 * Initiatives/Projects/Cycles browse tabs and workspace Settings.
 */

import { useEffect, useState } from "react";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { usePlugin, useSettingsWriter, useWorkspaces } from "./context";
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

			<Section title="Views">
				{snapshot.views.map((view) => (
					<ViewRow
						key={view.id}
						view={view}
						active={onWorkspaceTab && view.id === activeViewId}
						onClick={() => onSelectView(view.id)}
					/>
				))}
			</Section>

			<Section title="Workspace">
				<ScreenRow
					label="Initiatives"
					icon="◆"
					active={activeId === "initiatives"}
					onClick={() => openScreen("initiatives")}
				/>
				<ScreenRow
					label="Projects"
					icon="▣"
					active={activeId === "projects"}
					onClick={() => openScreen("projects")}
				/>
				{/* Cycles are opt-in (§7.5) — the nav entry only exists once a
				    workspace has actually turned them on. */}
				{snapshot.workspace.cycles.enabled && (
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

function ViewRow({
	view,
	active,
	onClick,
}: {
	view: SavedView;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			className={`vf-nav-row${active ? " is-active" : ""}`}
			onClick={onClick}
			aria-current={active ? "page" : undefined}
		>
			<span className="vf-view-icon">{view.viewType === "board" ? "▦" : "☰"}</span>
			<span className="vf-nav-label">{view.name}</span>
		</button>
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
