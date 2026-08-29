/**
 * One project's tab: a detail header (status, progress, overview prose,
 * actions) above the project's tasks in the normal List/Board viewport.
 *
 * Mirrors the "synthesised, never-persisted view scoped to one entity" pattern
 * used for labels — `projectView()` in `App.tsx` builds the filter, this
 * component adds the header. A Project has no editable fields beyond status
 * (§4.2: the note body is hand-written prose), so the Overview is read-only
 * here and "Open note" drops to the real Obsidian editor for the rest.
 */

import { useEffect, useState } from "react";
import { projectProgress, projectTasks, scopeOf } from "../core/hierarchy";
import type { ViewContext } from "../core/views";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import type { Project, WorkspaceSnapshot } from "../core/types";
import { withExtension } from "../obsidian/note-io";
import { useCreateTask } from "./actions";
import { StatusSelect } from "./components/fields";
import { Icon } from "./components/Icon";
import { MarkdownContent } from "./components/Markdown";
import { ProgressBar } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { formatFullDate } from "./browse/shared";
import { projectView } from "./App";
import { TaskViewport } from "./views/TaskViewport";

export function ProjectDetailView({
	path,
	snapshot,
	taxonomies,
	context,
	containerRef,
	active,
	onSelectView,
}: {
	path: string;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
	containerRef: HTMLElement | null;
	active: boolean;
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const { closeActive } = useTabs();
	const createTask = useCreateTask();

	const project = snapshot.projects.find((p) => p.path === path) ?? null;

	// Unresolvable (deleted since the last rebuild — App's prune effect normally
	// catches this first). Closing has to happen in an effect, not inline: a
	// state setter fired mid-render is unsafe in React. Same guard as `TaskPane`.
	useEffect(() => {
		if (!project) closeActive();
	}, [project, closeActive]);

	if (!project) return null;

	return (
		<>
			<ProjectHeader
				project={project}
				snapshot={snapshot}
				taxonomies={taxonomies}
				onNewTask={() => void createTask(snapshot, { project: project.path })}
				onOpenNote={() => {
					plugin.suppressNextRedirect();
					void plugin.mutations.open(project.path);
				}}
			/>

			<TaskViewport
				snapshot={snapshot}
				view={projectView(project)}
				taxonomies={taxonomies}
				context={context}
				containerRef={containerRef}
				active={active}
				onSelectView={onSelectView}
			/>
		</>
	);
}

function ProjectHeader({
	project,
	snapshot,
	taxonomies,
	onNewTask,
	onOpenNote,
}: {
	project: Project;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	onNewTask: () => void;
	onOpenNote: () => void;
}) {
	const plugin = usePlugin();

	const scope = scopeOf(snapshot);
	const tasks = projectTasks(scope, project.path);
	// §7.1: progress is computed independently of the project's own status.
	const progress = projectProgress(scope, project.path, taxonomies.status);

	return (
		<header className="vf-project-head">
			<div className="vf-project-head-top">
				<span className="vf-project-head-icon" aria-hidden>
					<Icon id={project.icon} fallback="folder" size={16} />
				</span>
				<h2 className="vf-project-head-title">{project.title}</h2>
				<span className="vf-project-head-spacer" />
				<button className="mod-cta" onClick={onNewTask}>
					New task
				</button>
				<button
					type="button"
					className="vf-icon-button"
					title="Open the raw note in Obsidian"
					onClick={onOpenNote}
				>
					↗
				</button>
			</div>

			<div className="vf-project-head-meta">
				<StatusSelect
					taxonomy={taxonomies.status}
					value={project.status}
					onChange={(status) =>
						status &&
						void plugin.mutations.updateProject(project, { status })
					}
				/>
				{project.archived && <span className="vf-chip">Archived</span>}
				{progress.total > 0 && <ProgressBar progress={progress} />}
				<span className="vf-project-head-fact">
					{tasks.length} task{tasks.length === 1 ? "" : "s"}
				</span>
				<span className="vf-project-head-fact">
					Created {formatFullDate(project.createdAt)}
				</span>
			</div>

			<Overview project={project} />
		</header>
	);
}

/** Drop the leading "## Overview" heading so it isn't shown twice. */
function overviewProse(body: string): string {
	return body.replace(/^\s*##\s+overview\s*\r?\n?/i, "").trim();
}

function Overview({ project }: { project: Project }) {
	const plugin = usePlugin();
	const [prose, setProse] = useState<string | null>(null);

	// The Overview lives in the note body, which the index deliberately doesn't
	// hold — read it on demand, re-reading when the note changes.
	useEffect(() => {
		let live = true;
		const file = plugin.io.getFile(project.path);
		if (!file) {
			setProse("");
			return;
		}
		void plugin.io.readBody(file).then((body) => {
			if (live) setProse(overviewProse(body));
		});
		return () => {
			live = false;
		};
	}, [plugin, project.path, project.updatedAt]);

	if (!prose) return null;

	return (
		<MarkdownContent
			className="vf-project-head-overview"
			text={prose}
			sourcePath={withExtension(project.path)}
		/>
	);
}
