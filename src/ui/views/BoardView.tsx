/**
 * Board / Kanban view (§8.1, §8.2).
 *
 * Columns come from the Saved View's `groupBy`, so this is a board over any
 * grouping — status is just the default. What a drop *means* lives in
 * `useDropHandler`, shared with the List view.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { childTasks, computeProgress, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { toggleColumnCollapsed } from "../../core/views";
import type {
	SavedView,
	Task,
	TaskGroup,
	WorkspaceSnapshot,
} from "../../core/types";
import {
	Assignee,
	DueDate,
	Labels,
	ProgressBar,
	RelationBadge,
	TaxonomyChip,
} from "../components/TaskBits";
import { usePlugin } from "../context";
import { useTabs, type TabsApi } from "../tabs-context";
import { useScrollFocusIntoView, useSelection } from "../selection";
import { useTaskDropHandler } from "./useDropHandler";
import {
	PREVIEW_OFFSET_PX,
	useTaskDrag,
	type DragState,
	type TaskDragApi,
} from "./useTaskDrag";

export function BoardView({
	snapshot,
	view,
	evaluated,
	taxonomies,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	evaluated: EvaluatedView;
	taxonomies: WorkspaceTaxonomies;
}) {
	const drag = useTaskDrag(useTaskDropHandler(view, evaluated));
	const visible = evaluated.groups.filter((group) => !group.hidden);

	const draggedTask = drag.drag
		? evaluated.tasks.find((task) => task.path === drag.drag?.taskPath)
		: undefined;

	const [board, setBoard] = useState<HTMLDivElement | null>(null);
	useScrollFocusIntoView(board);

	return (
		<div className="vf-board" ref={setBoard}>
			{visible.map((group) => (
				<Column
					key={group.key}
					group={group}
					view={view}
					snapshot={snapshot}
					taxonomies={taxonomies}
					drag={drag}
				/>
			))}

			{drag.drag && draggedTask && (
				<DragPreview
					drag={drag.drag}
					task={draggedTask}
					snapshot={snapshot}
					taxonomies={taxonomies}
				/>
			)}
		</div>
	);
}

/**
 * The card that follows the pointer while dragging.
 *
 * Rendered into `document.body` rather than inside the board: the board is a
 * horizontally scrolling container, and any ancestor with a transform would
 * otherwise become the containing block for `position: fixed` and pin the
 * preview to the wrong origin.
 *
 * It is strictly `pointer-events: none` — `resolveTarget` locates the drop
 * column with `elementFromPoint`, and a preview sitting under the cursor would
 * be the only thing it ever found.
 */
export function DragPreview({
	drag,
	task,
	snapshot,
	taxonomies,
}: {
	drag: DragState;
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	return createPortal(
		<div
			className="vf-drag-layer"
			style={{
				transform: `translate(${drag.x + PREVIEW_OFFSET_PX}px, ${
					drag.y + PREVIEW_OFFSET_PX
				}px)`,
				width: drag.width,
			}}
			aria-hidden
		>
			<article className="vf-card vf-card-preview">
				<CardContent task={task} snapshot={snapshot} taxonomies={taxonomies} />
			</article>
		</div>,
		document.body,
	);
}

function Column({
	group,
	view,
	snapshot,
	taxonomies,
	drag,
}: {
	group: TaskGroup;
	view: SavedView;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	drag: TaskDragApi;
}) {
	const plugin = usePlugin();
	const dropIndex = drag.dropIndexFor(group.key);
	const isDropTarget = dropIndex !== null;

	const toggle = () => {
		const live = plugin.index.get(snapshot.workspace.root) ?? snapshot;
		const next = toggleColumnCollapsed(view, group.key);
		void plugin.mutations.saveViews(
			live,
			live.views.map((candidate) => (candidate.id === view.id ? next : candidate)),
		);
	};

	if (group.collapsed) {
		// Collapsed to a rail, but still a live drop target (§8.2).
		return (
			<div
				className={`vf-column is-collapsed${isDropTarget ? " is-drop-target" : ""}`}
				data-group-key={group.key}
				onClick={toggle}
			>
				<div className="vf-column-rail">
					<span className="vf-count">{group.tasks.length}</span>
					<span className="vf-rail-label">{group.label}</span>
				</div>
			</div>
		);
	}

	return (
		<div
			className={`vf-column${isDropTarget ? " is-drop-target" : ""}`}
			data-group-key={group.key}
		>
			<header className="vf-column-header">
				{group.color && (
					<span className="vf-status-dot" style={{ backgroundColor: group.color }} />
				)}
				<span className="vf-column-title">{group.label}</span>
				<span className="vf-count">{group.tasks.length}</span>
				<button className="vf-collapse" onClick={toggle} aria-label="Collapse column">
					–
				</button>
			</header>

			<div className="vf-column-body">
				{group.tasks.map((task, index) => (
					<div key={task.path}>
						{dropIndex === index && <div className="vf-drop-indicator" />}
						<Card
							task={task}
							groupKey={group.key}
							snapshot={snapshot}
							taxonomies={taxonomies}
							drag={drag}
						/>
					</div>
				))}
				{dropIndex === group.tasks.length && <div className="vf-drop-indicator" />}

				{group.tasks.length === 0 && (
					<div className="vf-column-empty">Drop tasks here</div>
				)}
			</div>
		</div>
	);
}

function Card({
	task,
	groupKey,
	snapshot,
	taxonomies,
	drag,
}: {
	task: Task;
	groupKey: string;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	drag: TaskDragApi;
}) {
	const selection = useSelection();
	const tabs = useTabs();

	const focused = selection.focusedPath === task.path;
	const selected = selection.isSelected(task.path);

	return (
		<article
			className={[
				"vf-card",
				focused ? "is-focused" : "",
				selected ? "is-selected" : "",
				drag.isDragging(task.path) ? "is-dragging" : "",
				task.archived ? "is-archived" : "",
			]
				.filter(Boolean)
				.join(" ")}
			data-task-path={task.path}
			onPointerDown={(event) => drag.onPointerDown(event, task.path, groupKey)}
			onClick={(event) => openOrSelect(event, task.path, drag, selection, tabs)}
		>
			<CardContent task={task} snapshot={snapshot} taxonomies={taxonomies} />
		</article>
	);
}

/**
 * Shared click behaviour for cards and rows.
 *
 * A plain click opens the task in its own tab, the way Linear behaves;
 * modifier clicks build a multi-selection instead. The drag guard matters
 * because every drag ends with a trailing click — without it, dropping a
 * card would also open its tab.
 */
export function openOrSelect(
	event: React.MouseEvent,
	path: string,
	drag: TaskDragApi,
	selection: ReturnType<typeof useSelection>,
	tabs: TabsApi,
): void {
	if (drag.consumeDragClick()) return;

	const toggle = event.metaKey || event.ctrlKey;
	const range = event.shiftKey;

	selection.select(path, { toggle, range });
	if (!toggle && !range) tabs.openTask(path);
}

/**
 * A card's contents, with no interaction of its own — shared by the real card
 * and the drag preview so the thing under your cursor is the thing you picked
 * up, not a lookalike that drifts out of sync the next time a field is added.
 */
function CardContent({
	task,
	snapshot,
	taxonomies,
}: {
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	const scope = scopeOf(snapshot);
	const progress = computeProgress(childTasks(scope, task.path), taxonomies.status);

	return (
		<>
			<div className="vf-card-top">
				<span className="vf-id">{task.id}</span>
				<TaxonomyChip taxonomies={taxonomies} kind="taskType" id={task.taskType} />
				<RelationBadge task={task} />
			</div>

			<div className="vf-card-title">{task.title}</div>

			<ProgressBar progress={progress} />
			<Labels taxonomies={taxonomies} labels={task.labels} />

			<div className="vf-card-bottom">
				<TaxonomyChip taxonomies={taxonomies} kind="priority" id={task.priority} />
				<DueDate task={task} />
				<Assignee people={snapshot.workspace.people} assignee={task.assignee} />
			</div>
		</>
	);
}
