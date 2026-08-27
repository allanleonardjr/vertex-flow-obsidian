/**
 * Board / Kanban view (§8.1, §8.2).
 *
 * Columns come from the Saved View's `groupBy`, so this is a board over any
 * grouping — status is just the default. Dropping a card writes two things at
 * most: a new rank, and (when the column represents a status) a new status.
 */

import { useCallback } from "react";
import { createPortal } from "react-dom";
import { childTasks, computeProgress, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { toggleColumnCollapsed } from "../../core/views";
import { NONE, type SavedView, type Task, type TaskGroup, type WorkspaceSnapshot } from "../../core/types";
import {
	Assignee,
	DueDate,
	Labels,
	ProgressBar,
	RelationBadge,
	TaxonomyChip,
} from "../components/TaskBits";
import { usePlugin } from "../context";
import { useSelection } from "../selection";
import { useBoardDrag, type DragState, type DropTarget } from "./useBoardDrag";

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
	const plugin = usePlugin();

	// A cycle board is the one context with its own order (§6).
	const rankField = view.sortBy === "cycleRank" ? "cycleRank" : "rank";

	const handleDrop = useCallback(
		(taskPath: string, target: DropTarget) => {
			const task = evaluated.tasks.find((candidate) => candidate.path === taskPath);
			const column = evaluated.groups.find((group) => group.key === target.columnKey);
			if (!task || !column) return;

			// Moving between columns only changes a field when the grouping maps
			// onto one. Grouping by label is many-to-many — a card can sit in two
			// columns at once — so dragging there would be ambiguous, and is
			// treated as a reorder only.
			const statusChange =
				view.groupBy === "status" && target.columnKey !== NONE
					? target.columnKey
					: undefined;

			void plugin.mutations.moveTask(
				task,
				column.tasks,
				target.index,
				rankField,
				statusChange,
			);
		},
		[evaluated, view.groupBy, plugin, rankField],
	);

	const drag = useBoardDrag(handleDrop);
	const visible = evaluated.groups.filter((group) => !group.hidden);

	const draggedTask = drag.drag
		? evaluated.tasks.find((task) => task.path === drag.drag?.taskPath)
		: undefined;

	return (
		<div className="vf-board">
			{visible.map((group) => (
				<Column
					key={group.key}
					group={group}
					view={view}
					snapshot={snapshot}
					taxonomies={taxonomies}
					drag={drag}
					isDropTarget={drag.drag?.target?.columnKey === group.key}
					dropIndex={
						drag.drag?.target?.columnKey === group.key
							? drag.drag.target.index
							: null
					}
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
function DragPreview({
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
				transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`,
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
	isDropTarget,
	dropIndex,
}: {
	group: TaskGroup;
	view: SavedView;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	drag: ReturnType<typeof useBoardDrag>;
	isDropTarget: boolean;
	dropIndex: number | null;
}) {
	const plugin = usePlugin();

	// Collapse state belongs to the Saved View (§8.2), so toggling it persists
	// to `_views.md` rather than living in component state.
	const toggle = () => {
		const next = toggleColumnCollapsed(view, group.key);
		void plugin.mutations.saveViews(
			snapshot,
			snapshot.views.map((candidate) => (candidate.id === view.id ? next : candidate)),
		);
	};

	if (group.collapsed) {
		// Collapsed to a rail, but still a live drop target (§8.2).
		return (
			<div
				className="vf-column is-collapsed"
				data-column-key={group.key}
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
			data-column-key={group.key}
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
							columnKey={group.key}
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
	columnKey,
	snapshot,
	taxonomies,
	drag,
}: {
	task: Task;
	columnKey: string;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	drag: ReturnType<typeof useBoardDrag>;
}) {
	const plugin = usePlugin();
	const selection = useSelection();

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
			onPointerDown={(event) => drag.onPointerDown(event, task.path, columnKey)}
			onClick={(event) =>
				selection.select(task.path, {
					toggle: event.metaKey || event.ctrlKey,
					range: event.shiftKey,
				})
			}
			onDoubleClick={() => void plugin.mutations.open(task.path)}
		>
			<CardContent task={task} snapshot={snapshot} taxonomies={taxonomies} />
		</article>
	);
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
