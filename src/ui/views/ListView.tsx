/**
 * List view (§8.1) — the Saved View rendered as dense, Linear-style rows.
 *
 * The rows, groups, and sections all come from the shared `TaskList` module,
 * so this file is now only what makes it a *view*: turning an evaluated Saved
 * View into groups, and layering on drag-and-drop, selection, and keyboard
 * focus. Reordering is the whole point of a manually-ranked backlog (§6), so
 * a list you can't drag in would be the wrong half of the feature.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import type { SavedView, Task, WorkspaceSnapshot } from "../../core/types";
import { TaskList, type TaskListInteraction } from "../components/TaskList";
import { TaskRowContent } from "../components/TaskRow";
import { useTabs } from "../tabs-context";
import { useScrollFocusIntoView, useSelection } from "../selection";
import { openOrSelect } from "./BoardView";
import { useTaskDropHandler } from "./useDropHandler";
import { PREVIEW_OFFSET_PX, useTaskDrag, type DragState } from "./useTaskDrag";

export function ListView({
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
	const selection = useSelection();
	const tabs = useTabs();

	const draggedTask = drag.drag
		? evaluated.tasks.find((task) => task.path === drag.drag?.taskPath)
		: undefined;

	const [list, setList] = useState<HTMLDivElement | null>(null);
	useScrollFocusIntoView(list);

	if (evaluated.total === 0) {
		return (
			<div className="vf-empty-view">
				<p>Nothing here yet.</p>
				<p className="vf-empty-note">
					Press <kbd>c</kbd> to create a task.
				</p>
			</div>
		);
	}

	const interaction: TaskListInteraction = {
		isFocused: (task) => selection.focusedPath === task.path,
		isSelected: (task) => selection.isSelected(task.path),
		isDragging: (task) => drag.isDragging(task.path),
		onRowPointerDown: (event, task, groupKey) =>
			drag.onPointerDown(event, task.path, groupKey),
		onRowClick: (event, task) =>
			openOrSelect(event, task.path, drag, selection, tabs),
		dropIndexFor: (groupKey) => drag.dropIndexFor(groupKey),
	};

	return (
		<TaskList
			groups={evaluated.groups.filter((group) => !group.hidden)}
			snapshot={snapshot}
			taxonomies={taxonomies}
			grouped={evaluated.view.groupBy !== "none"}
			interaction={interaction}
			emptyGroupLabel="Drop tasks here"
			containerRef={setList}
		>
			{drag.drag && draggedTask && (
				<RowPreview
					drag={drag.drag}
					task={draggedTask}
					snapshot={snapshot}
					taxonomies={taxonomies}
				/>
			)}
		</TaskList>
	);
}

/** The row that follows the pointer while dragging. See `DragPreview`. */
function RowPreview({
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
			<div className="vf-row vf-row-preview">
				<TaskRowContent task={task} snapshot={snapshot} taxonomies={taxonomies} />
			</div>
		</div>,
		document.body,
	);
}
