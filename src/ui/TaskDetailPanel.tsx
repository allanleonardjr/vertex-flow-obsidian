/**
 * The task detail panel — a Linear-style editor for one task.
 *
 * Hosted inside one tab of the single, unified tab strip (`TabStrip.tsx`
 * renders the strip itself; `TaskPane.tsx` resolves this task and its owning
 * workspace before handing off to this component) — this only renders what's
 * inside one tab, and knows nothing about its siblings, including the pinned
 * Board/List tab that's never more than a click away.
 *
 * There is no Save button, deliberately. The note on disk is the source of
 * truth (§3); an editor holding unsaved state would be a second, competing copy
 * of the task that a file change from Sync or the editor pane could silently
 * contradict. Selects write through immediately, text fields debounce and flush
 * on unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { descendantTasks, childTasks, computeProgress, scopeOf } from "../core/hierarchy";
import { basename } from "../core/links";
import { withExtension } from "../obsidian/note-io";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import type { Comment, Task, WorkspaceSnapshot } from "../core/types";
import { NEW_TASK_TITLE } from "./actions";
import {
	DateField,
	LabelPicker,
	NumberField,
	OptionSelect,
	PersonSelect,
	PropertyRow,
	TaxonomySelect,
	useDebouncedSave,
	type Option,
} from "./components/fields";
import { MarkdownContent, MarkdownField } from "./components/Markdown";
import { TaskList } from "./components/TaskList";
import { MissingTaskRow } from "./components/TaskRow";
import { ProgressBar, StatusDot } from "./components/TaskBits";
import { usePlugin } from "./context";

export interface TaskDetailPanelProps {
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	/** Follow a sub-task, relation, or parent — opens (or reveals) its own tab. */
	onOpenTask: (path: string) => void;
	/** Close just this tab. The pinned Board/List tab is always still there. */
	onClose: () => void;
	/** Bulk-close every open task tab (shift-click on the close button). */
	onCloseAllTasks: () => void;
}

export function TaskDetailPanel({
	task,
	snapshot,
	taxonomies,
	onOpenTask,
	onClose,
	onCloseAllTasks,
}: TaskDetailPanelProps) {
	const plugin = usePlugin();
	const [comments, setComments] = useState<Comment[]>([]);
	const [description, setDescription] = useState<string | null>(null);
	const [railWidth, setRailWidth] = useState(plugin.settings.editorRailWidth);

	const scope = scopeOf(snapshot);
	const children = childTasks(scope, task.path);
	const progress = computeProgress(children, taxonomies.status);

	const update = (patch: Partial<Task>) => void plugin.mutations.updateTask(task, patch);

	// Body content isn't in the index, so it loads on open.
	useEffect(() => {
		let cancelled = false;
		void plugin.mutations.readDocument(task).then((doc) => {
			if (cancelled) return;
			setDescription(doc.description);
			setComments(doc.comments);
		});
		return () => {
			cancelled = true;
		};
	}, [plugin, task.path]);

	return (
		<>
			<header className="vf-editor-header">
				<StatusDot taxonomies={taxonomies} status={task.status} />
				<span className="vf-id">{task.id}</span>
				{task.archived && <span className="vf-chip">Archived</span>}
				<span className="vf-editor-spacer" />
				<button
					className="vf-icon-button"
					title="Open the raw note in Obsidian"
					onClick={() => {
						// Opening the raw note fires the same `file-open` event that
						// normally redirects a task note straight back into this
						// panel — without this, the button would just bounce.
						plugin.suppressNextRedirect();
						void plugin.mutations.open(task.path);
					}}
				>
					↗
				</button>
				<button
					className="vf-icon-button"
					title="Close tab (Esc) — shift-click to close every task tab"
					onClick={(event) => (event.shiftKey ? onCloseAllTasks() : onClose())}
				>
					✕
				</button>
			</header>

			<div className="vf-editor-body">
				<main className="vf-editor-main">
					<TitleField task={task} />

					{description === null ? (
						<div className="vf-editor-loading">Loading…</div>
					) : (
						<DescriptionField task={task} initial={description} />
					)}

					{children.length > 0 && (
						<section className="vf-editor-section">
							<h4>
								Sub-tasks <ProgressBar progress={progress} />
							</h4>
							<SubtaskList
								tasks={children}
								snapshot={snapshot}
								taxonomies={taxonomies}
								onOpenTask={onOpenTask}
							/>
						</section>
					)}

					<section className="vf-editor-section">
						<h4>Relations</h4>
						<RelationsEditor
							task={task}
							snapshot={snapshot}
							taxonomies={taxonomies}
							onChange={update}
							onOpenTask={onOpenTask}
						/>
					</section>

					<section className="vf-editor-section">
						<h4>Comments</h4>
						<CommentList
							task={task}
							comments={comments}
							onChanged={(next) => setComments(next)}
						/>
					</section>
				</main>

				<RailResizeHandle
					width={railWidth}
					onResize={setRailWidth}
					onResizeEnd={(width) => {
						plugin.settings.editorRailWidth = width;
						void plugin.saveSettings();
					}}
				/>

				<aside className="vf-editor-rail" style={{ width: railWidth }}>
					<PropertyRow label="Status">
						<TaxonomySelect
							taxonomy={taxonomies.status}
							value={task.status}
							allowNone={false}
							onChange={(value) => value && update({ status: value })}
						/>
					</PropertyRow>

					<PropertyRow label="Priority">
						<TaxonomySelect
							taxonomy={taxonomies.priority}
							value={task.priority}
							allowNone
							onChange={(priority) => update({ priority })}
						/>
					</PropertyRow>

					<PropertyRow label="Type">
						<TaxonomySelect
							taxonomy={taxonomies.taskType}
							value={task.taskType}
							allowNone
							onChange={(taskType) => update({ taskType })}
						/>
					</PropertyRow>

					<PropertyRow label="Assignee">
						<PersonSelect
							people={snapshot.workspace.people}
							value={task.assignee}
							onChange={(assignee) => update({ assignee })}
						/>
					</PropertyRow>

					<PropertyRow label="Labels">
						<LabelPicker
							taxonomy={taxonomies.label}
							value={task.labels}
							onChange={(labels) => update({ labels })}
						/>
					</PropertyRow>

					<ParentPicker task={task} snapshot={snapshot} onChange={update} />

					{snapshot.workspace.cycles.enabled && (
						<PropertyRow label={snapshot.workspace.cycles.termLabel}>
							<OptionSelect
								noneLabel={`No ${snapshot.workspace.cycles.termLabel.toLowerCase()}`}
								value={task.cycle}
								options={snapshot.cycles.map((cycle) => ({
									value: cycle.path,
									label: cycle.title,
								}))}
								onChange={(cycle) => update({ cycle })}
							/>
						</PropertyRow>
					)}

					<PropertyRow label="Estimate">
						<NumberField
							value={task.estimate}
							placeholder={snapshot.workspace.estimateUnitLabel ?? "—"}
							onChange={(estimate) => update({ estimate })}
						/>
					</PropertyRow>

					<PropertyRow label="Start">
						<DateField
							value={task.startDate}
							onChange={(startDate) => update({ startDate })}
						/>
					</PropertyRow>

					<PropertyRow label="Due">
						<DateField
							value={task.dueDate}
							onChange={(dueDate) => update({ dueDate })}
						/>
					</PropertyRow>

					<PropertyRow label="Archived">
						<label className="vf-toggle">
							<input
								type="checkbox"
								checked={task.archived}
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
				</aside>
			</div>
		</>
	);
}

function TitleField({ task }: { task: Task }) {
	const plugin = usePlugin();
	const [title, setTitle] = useDebouncedSave(task.title, (value) => {
		// Renaming a task never renames its file (§3) — the title lives only in
		// frontmatter, so there's no wikilink cascade to worry about here.
		void plugin.mutations.updateTask(task, { title: value.trim() || task.id });
	});

	// A task that still carries the placeholder title was just created, so put
	// the cursor in it with the text selected: typing replaces it outright.
	const isPlaceholder = task.title === NEW_TASK_TITLE;
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
			placeholder="Task title"
			onChange={(event) => setTitle(event.target.value)}
			onInput={(event) => {
				const el = event.currentTarget;
				el.style.height = "auto";
				el.style.height = `${el.scrollHeight}px`;
			}}
		/>
	);
}

function DescriptionField({ task, initial }: { task: Task; initial: string }) {
	const plugin = usePlugin();
	// `useDebouncedSave` is what turns every keystroke `MarkdownField` reports
	// into an occasional disk write, and flushes on unmount so closing the tab
	// mid-edit never drops the last few characters.
	const [text, setText] = useDebouncedSave(initial, (value) => {
		void plugin.mutations.setDescription(task, value);
	});

	return (
		<MarkdownField
			className="vf-editor-description"
			value={text}
			onChange={setText}
			sourcePath={withExtension(task.path)}
			placeholder="Add a description… start typing Markdown — [[wikilinks]], #tags, and ![[embeds]] all work, with live preview and link suggestions as you go"
		/>
	);
}

const RAIL_MIN_WIDTH = 200;
const RAIL_MAX_WIDTH = 520;

/**
 * The drag handle between the description column and the property rail.
 *
 * Uses pointer capture on the handle itself rather than a window listener:
 * once captured, the handle keeps receiving `pointermove`/`pointerup` even
 * when the cursor moves off it mid-drag, with no manual event wiring needed.
 *
 * `onResize` fires on every frame so the layout tracks the cursor live;
 * `onResizeEnd` fires once, on release, and is where the width actually gets
 * persisted — writing to `data.json` on every pixel of drag would be wasteful.
 */
function RailResizeHandle({
	width,
	onResize,
	onResizeEnd,
}: {
	width: number;
	onResize: (width: number) => void;
	onResizeEnd: (width: number) => void;
}) {
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);

	return (
		<div
			className="vf-editor-resize-handle"
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
				// The rail sits to the right of the handle, so dragging left
				// (negative delta) has to *widen* it.
				const delta = event.clientX - drag.current.startX;
				const next = Math.min(
					RAIL_MAX_WIDTH,
					Math.max(RAIL_MIN_WIDTH, drag.current.startWidth - delta),
				);
				onResize(next);
			}}
			onPointerUp={(event) => {
				if (!drag.current) return;
				drag.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
				onResizeEnd(width);
			}}
			onDoubleClick={() => onResizeEnd(264)}
			title="Drag to resize — double-click to reset"
		/>
	);
}

/**
 * Sub-tasks, rendered with the same list module as everything else — a
 * sub-task shows its status, priority, due date and assignee here exactly as
 * it would in the List view.
 */
function SubtaskList({
	tasks,
	snapshot,
	taxonomies,
	onOpenTask,
}: {
	tasks: Task[];
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	onOpenTask: (path: string) => void;
}) {
	return (
		<TaskList
			className="vf-list-embedded"
			groups={[{ key: "subtasks", tasks }]}
			snapshot={snapshot}
			taxonomies={taxonomies}
			onOpenTask={onOpenTask}
		/>
	);
}

/**
 * The single primary parent (Golden Rule). One control, not three, because
 * offering separate project/initiative/parent fields would invite exactly the
 * multi-parent state the data model forbids.
 */
function ParentPicker({
	task,
	snapshot,
	onChange,
}: {
	task: Task;
	snapshot: WorkspaceSnapshot;
	onChange: (patch: Partial<Task>) => void;
}) {
	const value = task.parent
		? `task:${task.parent}`
		: task.project
			? `project:${task.project}`
			: task.initiative
				? `initiative:${task.initiative}`
				: null;

	const options: Option[] = [
		...snapshot.projects.map((project) => ({
			value: `project:${project.path}`,
			label: `Project · ${project.title}`,
		})),
		...snapshot.initiatives.map((initiative) => ({
			value: `initiative:${initiative.path}`,
			label: `Initiative · ${initiative.title}`,
		})),
		...snapshot.tasks
			// A task can't be its own parent, nor a descendant's child — that
			// would make an unreachable loop in the hierarchy.
			.filter(
				(candidate) =>
					candidate.path !== task.path &&
					!descendantTasks(scopeOf(snapshot), task.path).some(
						(descendant) => descendant.path === candidate.path,
					),
			)
			.map((candidate) => ({
				value: `task:${candidate.path}`,
				label: `Sub-task of · ${candidate.id} ${candidate.title}`,
			})),
	];

	return (
		<PropertyRow label="Parent">
			<OptionSelect
				noneLabel="No parent"
				value={value}
				options={options}
				onChange={(next) => {
					if (!next) {
						onChange({ parent: null, project: null, initiative: null });
						return;
					}
					const [kind, ...rest] = next.split(":");
					const path = rest.join(":");
					onChange({
						parent: kind === "task" ? path : null,
						project: kind === "project" ? path : null,
						initiative: kind === "initiative" ? path : null,
					});
				}}
			/>
		</PropertyRow>
	);
}

const RELATION_KINDS = [
	{ key: "blockedBy", label: "Blocked by" },
	{ key: "blocks", label: "Blocks" },
	{ key: "related", label: "Related" },
] as const;

/**
 * Relations (§7.3), each kind rendered with the same `TaskList` module the
 * List view uses — so a blocking task shows its real status, priority, due
 * date and assignee here, which is exactly the context you need to judge
 * whether it's actually blocking you.
 */
function RelationsEditor({
	task,
	snapshot,
	taxonomies,
	onChange,
	onOpenTask,
}: {
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	onChange: (patch: Partial<Task>) => void;
	onOpenTask: (path: string) => void;
}) {
	const others = snapshot.tasks.filter((candidate) => candidate.path !== task.path);
	const titleOf = (path: string) =>
		snapshot.tasks.find((candidate) => candidate.path === path)?.title ?? basename(path);

	const picker = (
		exclude: string[],
		noneLabel: string,
		value: string | null,
		onPick: (path: string | null) => void,
	) => (
		<OptionSelect
			noneLabel={noneLabel}
			value={value}
			options={others
				.filter((candidate) => !exclude.includes(candidate.path))
				.map((candidate) => ({
					value: candidate.path,
					label: `${candidate.id} ${candidate.title}`,
				}))}
			onChange={onPick}
		/>
	);

	/**
	 * Split stored paths into tasks the index resolved and ones it couldn't.
	 * Unresolvable relations are shown rather than hidden: a dangling link the
	 * user can see and remove beats one that vanishes from the UI but stays in
	 * the file.
	 */
	const partition = (paths: string[]) => {
		const found: Task[] = [];
		const missing: string[] = [];
		for (const path of paths) {
			const related = snapshot.tasks.find((candidate) => candidate.path === path);
			if (related) found.push(related);
			else missing.push(path);
		}
		return { found, missing };
	};

	/**
	 * One `TaskList` per relation kind — the same call sub-tasks make, so the
	 * rows render identically. Unresolvable relations ride along as extra
	 * children *inside* that list rather than in a wrapper around it, which is
	 * what keeps the whole group inside a single bordered box.
	 */
	const relationList = (paths: string[], remove: (path: string) => void) => {
		const { found, missing } = partition(paths);
		if (found.length === 0 && missing.length === 0) return null;

		return (
			<TaskList
				className="vf-list-embedded"
				groups={[{ key: "relations", tasks: found }]}
				snapshot={snapshot}
				taxonomies={taxonomies}
				onOpenTask={onOpenTask}
				rowAction={(related) => (
					<button
						className="vf-icon-button vf-row-remove"
						title={`Remove ${titleOf(related.path)}`}
						onClick={() => remove(related.path)}
					>
						✕
					</button>
				)}
			>
				{missing.map((path) => (
					<MissingTaskRow
						key={path}
						label={basename(path)}
						onRemove={() => remove(path)}
						removeTitle={`Remove ${basename(path)}`}
					/>
				))}
			</TaskList>
		);
	};

	return (
		<div className="vf-relation-groups">
			{RELATION_KINDS.map(({ key, label }) => {
				const current = task.relations[key];
				return (
					<div key={key} className="vf-relation-group">
						<div className="vf-relation-group-header">
							<span className="vf-relation-group-label">{label}</span>
							{picker(current, "Add…", null, (path) => {
								if (!path) return;
								onChange({
									relations: { ...task.relations, [key]: [...current, path] },
								});
							})}
						</div>

						{relationList(current, (path) =>
							onChange({
								relations: {
									...task.relations,
									[key]: current.filter((entry) => entry !== path),
								},
							}),
						)}
					</div>
				);
			})}

			<div className="vf-relation-group">
				<div className="vf-relation-group-header">
					<span className="vf-relation-group-label">Duplicate of</span>
					{/* Single-valued (§7.3), so the picker doubles as the current
					    value rather than only ever adding to a list. */}
					{picker([], "Not a duplicate", task.relations.duplicateOf, (duplicateOf) =>
						onChange({ relations: { ...task.relations, duplicateOf } }),
					)}
				</div>

				{task.relations.duplicateOf &&
					relationList([task.relations.duplicateOf], () =>
						onChange({ relations: { ...task.relations, duplicateOf: null } }),
					)}
			</div>
		</div>
	);
}

function CommentList({
	task,
	comments,
	onChanged,
}: {
	task: Task;
	comments: Comment[];
	onChanged: (comments: Comment[]) => void;
}) {
	const plugin = usePlugin();
	const [draft, setDraft] = useState("");
	const self = plugin
		.activeWorkspace()
		?.workspace.people.find((person) => person.isSelf);

	const reload = async () => {
		const doc = await plugin.mutations.readDocument(task);
		onChanged(doc.comments);
	};

	return (
		<div className="vf-comments">
			{comments.map((comment) => (
				<article key={comment.id} className="vf-comment">
					<header>
						<strong>{comment.author}</strong>
						<span className="vf-comment-date">{comment.date.slice(0, 10)}</span>
						<button
							className="vf-icon-button"
							title="Delete comment"
							onClick={() =>
								void plugin.mutations.deleteComment(task, comment.id).then(reload)
							}
						>
							✕
						</button>
					</header>
					<MarkdownContent
						className="vf-comment-body"
						text={comment.body}
						sourcePath={withExtension(task.path)}
					/>
					{Object.entries(comment.reactions).length > 0 && (
						<div className="vf-reactions">
							{Object.entries(comment.reactions).map(([emoji, count]) => (
								<span key={emoji} className="vf-reaction">
									{emoji} {count}
								</span>
							))}
						</div>
					)}
				</article>
			))}

			<CommentDraftField
				placeholder={
					self ? `Comment as ${self.name}… (@mention to notify)` : "Add a comment…"
				}
				value={draft}
				onChange={setDraft}
				sourcePath={withExtension(task.path)}
			/>
			<button
				className="mod-cta"
				disabled={!draft.trim()}
				onClick={() =>
					void plugin.mutations.addComment(task, self?.id ?? "me", draft).then(() => {
						setDraft("");
						return reload();
					})
				}
			>
				Comment
			</button>
		</div>
	);
}

/**
 * The comment composer needs live preview + link autocomplete too — it's the
 * exact same Markdown a description is, just shorter-lived. No debounced save
 * here: a draft has nowhere to persist until "Comment" is clicked, so it's
 * just `MarkdownField` wired straight to `CommentList`'s own local state.
 */
function CommentDraftField({
	value,
	onChange,
	placeholder,
	sourcePath,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	sourcePath: string;
}) {
	return (
		<MarkdownField
			className="vf-comment-draft"
			value={value}
			onChange={onChange}
			sourcePath={sourcePath}
			placeholder={placeholder}
		/>
	);
}
