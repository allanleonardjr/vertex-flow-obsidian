/**
 * Board / Kanban view (§8.1, §8.2).
 *
 * Columns come from the Saved View's `groupBy`, so this is a board over any
 * grouping — status is just the default. What a drop *means* lives in
 * `useDropHandler`, shared with the List view.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { scopeOf, subtaskProgress } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { toggleColumnCollapsed } from "../../core/views";
import {
  emptyProgress,
  type SavedView,
  type Task,
  type TaskField,
  type TaskGroup,
  type ViewColumnState,
  type WorkspaceSnapshot,
} from "../../core/types";
import {
  Assignee,
  DueDate,
  Labels,
  ProgressBar,
  RelationBadge,
  TaxonomyChip,
} from "../components/TaskBits";
import { useTabs, type TabsApi } from "../tabs-context";
import { useScrollFocusIntoView, useSelection } from "../selection";
import { useTaskDropHandler } from "./useDropHandler";
import {
  PREVIEW_OFFSET_PX,
  useTaskDrag,
  type DragState,
  type TaskDragApi,
} from "./useTaskDrag";

export interface BoardViewProps {
  snapshot: WorkspaceSnapshot;
  view: SavedView;
  evaluated: EvaluatedView;
  taxonomies: WorkspaceTaxonomies;
  /** Collapse/hide writes straight through to disk — see `useViewDraft`. */
  onColumnsChange: (columns: ViewColumnState) => void;
}

export function BoardView({
  snapshot,
  view,
  evaluated,
  taxonomies,
  onColumnsChange,
}: BoardViewProps) {
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
          snapshot={snapshot}
          taxonomies={taxonomies}
          drag={drag}
          hiddenFields={view.hiddenFields}
          onToggleCollapse={() =>
            onColumnsChange(toggleColumnCollapsed(view, group.key).columns)
          }
        />
      ))}

      {drag.drag && draggedTask && (
        <DragPreview
          drag={drag.drag}
          task={draggedTask}
          snapshot={snapshot}
          taxonomies={taxonomies}
          hiddenFields={view.hiddenFields}
        />
      )}
    </div>
  );
}

/**
 * The card that follows the pointer while dragging.
 */
export function DragPreview({
  drag,
  task,
  snapshot,
  taxonomies,
  hiddenFields,
}: {
  drag: DragState;
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  hiddenFields?: readonly TaskField[];
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
        <CardContent
          task={task}
          snapshot={snapshot}
          taxonomies={taxonomies}
          hiddenFields={hiddenFields}
        />
      </article>
    </div>,
    document.body,
  );
}

function Column({
  group,
  snapshot,
  taxonomies,
  drag,
  hiddenFields,
  onToggleCollapse,
}: {
  group: TaskGroup;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  drag: TaskDragApi;
  hiddenFields?: readonly TaskField[];
  onToggleCollapse: () => void;
}) {
  const dropIndex = drag.dropIndexFor(group.key);
  const isDropTarget = dropIndex !== null;

  const toggle = onToggleCollapse;

  if (group.collapsed) {
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
          <span
            className="vf-status-dot"
            style={{ backgroundColor: group.color }}
          />
        )}
        <span className="vf-column-title">{group.label}</span>
        <span className="vf-count">{group.tasks.length}</span>
        <button
          type="button"
          className="vf-collapse"
          onClick={toggle}
          aria-label="Collapse column"
        >
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
              hiddenFields={hiddenFields}
            />
          </div>
        ))}
        {dropIndex === group.tasks.length && (
          <div className="vf-drop-indicator" />
        )}

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
  hiddenFields,
}: {
  task: Task;
  groupKey: string;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  drag: TaskDragApi;
  hiddenFields?: readonly TaskField[];
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
      <CardContent
        task={task}
        snapshot={snapshot}
        taxonomies={taxonomies}
        hiddenFields={hiddenFields}
      />
    </article>
  );
}

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
 * Linear-style CardContent layout separating ID, Title, Labels, and Meta controls.
 */
function CardContent({
  task,
  snapshot,
  taxonomies,
  hiddenFields,
}: {
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  /** Fields this view hides (§8.4). Omitted = show all. */
  hiddenFields?: readonly TaskField[];
}) {
  const off = (field: TaskField) => hiddenFields?.includes(field) ?? false;

  const scope = scopeOf(snapshot);
  const progress = off("progress")
    ? emptyProgress()
    : subtaskProgress(scope, task, taxonomies.status);

  const showPriority = !off("priority");
  const showDue = !off("dueDate");
  const showAssignee = !off("assignee");

  return (
    <>
      {/* Top Header: ID + Type + Relation */}
      <div className="vf-card-top">
        <span className="vf-id">{task.id}</span>
        {!off("type") && (
          <TaxonomyChip
            taxonomies={taxonomies}
            kind="taskType"
            id={task.taskType}
          />
        )}
        {!off("relations") && <RelationBadge task={task} />}
      </div>

      {/* Prominent Task Title */}
      <div className="vf-card-title">{task.title}</div>

      {/* Sub-task Progress Bar (Wrapped for block spacing) */}
      {!off("progress") && progress.total > 0 && (
        <div className="vf-card-progress">
          <ProgressBar progress={progress} />
        </div>
      )}

      {/* Tinted Label Badges */}
      {!off("labels") && task.labels && task.labels.length > 0 && (
        <div className="vf-card-labels">
          <Labels taxonomies={taxonomies} labels={task.labels} />
        </div>
      )}

      {/* Bottom Meta Row: Priority Icon + Due Date + Assignee Avatar */}
      {(showPriority || showDue || showAssignee) && (
        <div className="vf-card-bottom">
          <div className="vf-card-meta-group">
            {showPriority && (
              <TaxonomyChip
                taxonomies={taxonomies}
                kind="priority"
                id={task.priority}
              />
            )}
            {showDue && <DueDate task={task} />}
          </div>
          {showAssignee && (
            <Assignee people={snapshot.workspace.people} assignee={task.assignee} />
          )}
        </div>
      )}
    </>
  );
}
