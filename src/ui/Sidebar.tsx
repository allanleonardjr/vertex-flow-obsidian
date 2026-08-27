/**
 * Sidebar (§9.5): workspace switcher, Saved Views, and quick hierarchy nav.
 */

import { computeProgress, projectTasks, scopeOf } from "../core/hierarchy";
import { workspaceTaxonomies } from "../core/taxonomy";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { usePlugin, useSettingsWriter, useWorkspaces } from "./context";

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
	const workspaces = useWorkspaces();
	const writeSettings = useSettingsWriter();

	const scope = scopeOf(snapshot);
	const statuses = workspaceTaxonomies(snapshot.workspace).status;

	return (
		<aside className="vf-sidebar">
			{workspaces.length > 1 ? (
				<select
					className="vf-workspace-switcher"
					value={snapshot.workspace.root}
					onChange={(event) =>
						writeSettings({ activeWorkspaceRoot: event.target.value })
					}
				>
					{workspaces.map((entry) => (
						<option key={entry.workspace.root} value={entry.workspace.root}>
							{entry.workspace.name}
						</option>
					))}
				</select>
			) : (
				<div className="vf-workspace-name">{snapshot.workspace.name}</div>
			)}

			<Section title="Views">
				{snapshot.views.map((view) => (
					<ViewRow
						key={view.id}
						view={view}
						active={view.id === activeViewId}
						onClick={() => onSelectView(view.id)}
					/>
				))}
			</Section>

			{snapshot.initiatives.length > 0 && (
				<Section title="Initiatives">
					{snapshot.initiatives.map((initiative) => (
						<button
							key={initiative.path}
							className="vf-nav-row"
							onClick={() => void plugin.mutations.open(initiative.path)}
						>
							<span className="vf-nav-label">{initiative.title}</span>
						</button>
					))}
				</Section>
			)}

			{snapshot.projects.length > 0 && (
				<Section title="Projects">
					{snapshot.projects.map((project) => {
						// Progress is computed at render time, never stored, and
						// never synced with the project's own status (§7.1).
						const progress = computeProgress(
							projectTasks(scope, project.path),
							statuses,
						);
						return (
							<button
								key={project.path}
								className="vf-nav-row"
								onClick={() => void plugin.mutations.open(project.path)}
							>
								<span className="vf-nav-label">{project.title}</span>
								<span className="vf-progress" title={`${progress.percent}% complete`}>
									<span
										className="vf-progress-fill"
										style={{ width: `${progress.percent}%` }}
									/>
								</span>
							</button>
						);
					})}
				</Section>
			)}

			{snapshot.workspace.cycles.enabled && snapshot.cycles.length > 0 && (
				<Section title={`${snapshot.workspace.cycles.termLabel}s`}>
					{snapshot.cycles.map((cycle) => (
						<button
							key={cycle.path}
							className="vf-nav-row"
							onClick={() => void plugin.mutations.open(cycle.path)}
						>
							<span className="vf-nav-label">{cycle.title}</span>
						</button>
					))}
				</Section>
			)}
		</aside>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="vf-sidebar-section">
			<div className="vf-sidebar-heading">{title}</div>
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
