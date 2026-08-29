/**
 * One project's tab: an in-plugin editor with the same two-column body as the
 * Task editor. A full-height, resizable, collapsible `PropertyRow` rail on the
 * right (shared `EditorRail`); on the left, the project info (title +
 * description) stacked above the project's task viewport.
 *
 * `projectView()` in `App.tsx` builds the filter for that viewport. A Project's
 * editable fields — status, priority, labels, dates, owner, archived, and the
 * description (the note body) — are all edited here rather than in the raw
 * Obsidian note, the same shift Tasks made. "Open note" and the raw-source
 * section keep the escape hatch to the file.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { projectProgress, projectTasks, scopeOf } from "../core/hierarchy";
import type { ViewContext } from "../core/views";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import type { Project, WorkspaceSnapshot } from "../core/types";
import { withExtension } from "../obsidian/note-io";
import { NEW_PROJECT_TITLE, useCreateTask } from "./actions";
import {
	DateField,
	PersonSelect,
	PrioritySelect,
	PropertyRow,
	StatusSelect,
	useDebouncedSave,
} from "./components/fields";
import { EditorRail } from "./components/EditorRail";
import { Icon, IconField } from "./components/Icon";
import { LabelEditor } from "./components/LabelEditor";
import { MarkdownField } from "./components/Markdown";
import { ProgressBar } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
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
		<ProjectEditor
			project={project}
			snapshot={snapshot}
			taxonomies={taxonomies}
			onNewTask={() => void createTask(snapshot, { project: project.path })}
			onOpenNote={() => {
				plugin.suppressNextRedirect();
				void plugin.mutations.open(project.path);
			}}
			tasks={
				<TaskViewport
					snapshot={snapshot}
					view={projectView(project)}
					taxonomies={taxonomies}
					context={context}
					containerRef={containerRef}
					active={active}
					onSelectView={onSelectView}
					hideViewTitle
				/>
			}
		/>
	);
}

function ProjectEditor({
	project,
	snapshot,
	taxonomies,
	tasks,
	onNewTask,
	onOpenNote,
}: {
	project: Project;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	/** The project's task viewport, rendered under the project info. */
	tasks: ReactNode;
	onNewTask: () => void;
	onOpenNote: () => void;
}) {
	const plugin = usePlugin();
	const [description, setDescription] = useState<string | null>(null);

	const scope = scopeOf(snapshot);
	const taskCount = projectTasks(scope, project.path).length;
	// §7.1: progress is computed independently of the project's own status, and
	// never fed back into it.
	const progress = projectProgress(scope, project.path, taxonomies.status);

	const update = (patch: Partial<Project>) =>
		void plugin.mutations.updateProject(project, patch);

	useEffect(() => {
		let cancelled = false;
		void plugin.mutations.readProjectDocument(project).then((doc) => {
			if (!cancelled) setDescription(doc.description);
		});
		return () => {
			cancelled = true;
		};
	}, [plugin, project.path]);

	return (
		<>
			<header className="vf-editor-header">
				<span className="vf-project-head-icon" aria-hidden>
					<Icon id={project.icon} fallback="folder" size={16} />
				</span>
				<span className="vf-id">{snapshot.workspace.idPrefix}</span>
				{project.archived && <span className="vf-chip">Archived</span>}
				<span className="vf-editor-spacer" />
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
			</header>

			<div className="vf-editor-body vf-project-editor">
				<div className="vf-editor-main-col">
					<main className="vf-editor-main vf-project-editor-info">
						<ProjectTitleField project={project} />

						{description === null ? (
							<div className="vf-editor-loading">Loading…</div>
						) : (
							<ProjectDescriptionField
								project={project}
								initial={description}
							/>
						)}
					</main>

					<div className="vf-project-editor-tasks">{tasks}</div>
				</div>

				<EditorRail>
					<PropertyRow label="Icon">
						<IconField
							value={project.icon}
							fallback="folder"
							onChange={(icon) => update({ icon })}
						/>
					</PropertyRow>

					<PropertyRow label="Status">
						<StatusSelect
							taxonomy={taxonomies.status}
							value={project.status}
							onChange={(status) => status && update({ status })}
						/>
					</PropertyRow>

					<PropertyRow label="Priority">
						<PrioritySelect
							taxonomy={taxonomies.priority}
							value={project.priority}
							onChange={(priority) => update({ priority })}
						/>
					</PropertyRow>

					<PropertyRow label="Labels">
						<LabelEditor
							snapshot={snapshot}
							taxonomy={taxonomies.label}
							value={project.labels}
							onChange={(labels) => update({ labels })}
						/>
					</PropertyRow>

					<PropertyRow label="Start">
						<DateField
							value={project.startDate}
							onChange={(startDate) => update({ startDate })}
						/>
					</PropertyRow>

					<PropertyRow label="Due">
						<DateField
							value={project.dueDate}
							onChange={(dueDate) => update({ dueDate })}
						/>
					</PropertyRow>

					<PropertyRow label="Owner">
						<PersonSelect
							people={snapshot.workspace.people}
							value={project.owner}
							onChange={(owner) => update({ owner })}
						/>
					</PropertyRow>

					<PropertyRow label="Archived">
						<label className="vf-toggle">
							<input
								type="checkbox"
								checked={project.archived}
								onChange={(event) =>
									update({
										archived: event.target.checked,
										archivedAt: event.target.checked
											? new Date().toISOString()
											: null,
									})
								}
							/>
							<span>Hide from views</span>
						</label>
					</PropertyRow>

					<PropertyRow label="Progress">
						{progress.total > 0 ? (
							<ProgressBar progress={progress} />
						) : (
							<span className="vf-prop-empty">
								{taskCount === 0 ? "No tasks yet" : "—"}
							</span>
						)}
					</PropertyRow>

					<ProjectRawSourceSection project={project} />
				</EditorRail>
			</div>
		</>
	);
}

/**
 * A read-only look at the project note exactly as it sits on disk — frontmatter
 * and body. Collapsed by default; the open state is remembered (shared with the
 * Task editor's Source section). Re-reads whenever the project changes while
 * open, so it tracks edits made above.
 */
function ProjectRawSourceSection({ project }: { project: Project }) {
	const plugin = usePlugin();
	const [open, setOpen] = useState(plugin.settings.editorSourceOpen);
	const [raw, setRaw] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		let live = true;
		setRaw(null);
		void plugin.mutations.readProjectRaw(project).then((text) => {
			if (live) setRaw(text);
		});
		return () => {
			live = false;
		};
	}, [open, plugin, project.path, project.updatedAt]);

	const toggle = () => {
		const next = !open;
		setOpen(next);
		plugin.settings.editorSourceOpen = next;
		void plugin.saveSettings();
	};

	return (
		<div className="vf-editor-rail-section">
			<button
				type="button"
				className="vf-rail-section-toggle"
				aria-expanded={open}
				onClick={toggle}
			>
				<span
					className={`vf-section-chevron${open ? " is-open" : ""}`}
					aria-hidden
				>
					›
				</span>
				Source
			</button>
			{open && (
				<pre className="vf-source-view">
					<code>{raw ?? "Loading…"}</code>
				</pre>
			)}
		</div>
	);
}

function ProjectTitleField({ project }: { project: Project }) {
	const plugin = usePlugin();
	const [title, setTitle] = useDebouncedSave(project.title, (value) => {
		void plugin.mutations.updateProject(project, {
			title: value.trim() || NEW_PROJECT_TITLE,
		});
	});

	const isPlaceholder = project.title === NEW_PROJECT_TITLE;
	const focusRef = useCallback(
		(element: HTMLTextAreaElement | null) => {
			if (!element) return;
			element.style.height = "auto";
			element.style.height = `${element.scrollHeight}px`;
			if (isPlaceholder) {
				element.focus();
				element.select();
			}
		},
		[isPlaceholder],
	);

	return (
		<textarea
			ref={focusRef}
			className="vf-editor-title"
			value={title}
			rows={1}
			placeholder="Project title"
			onChange={(event) => setTitle(event.target.value)}
			onInput={(event) => {
				const el = event.currentTarget;
				el.style.height = "auto";
				el.style.height = `${el.scrollHeight}px`;
			}}
		/>
	);
}

function ProjectDescriptionField({
	project,
	initial,
}: {
	project: Project;
	initial: string;
}) {
	const plugin = usePlugin();
	const [text, setText] = useDebouncedSave(initial, (value) => {
		void plugin.mutations.setProjectDescription(project, value);
	});

	return (
		<MarkdownField
			className="vf-editor-description"
			value={text}
			onChange={setText}
			sourcePath={withExtension(project.path)}
			placeholder="Add a description… start typing Markdown — [[wikilinks]], #tags, and ![[embeds]] all work, with live preview and link suggestions as you go"
		/>
	);
}
