import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { basename } from "../../core/links";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import { PREVIEW_OFFSET_PX, useTaskDrag } from "../views/useTaskDrag";
import { TaskList, type TaskListInteraction } from "./TaskList";
import { MissingTaskRow, TaskRowContent } from "./TaskRow";

/** Single-group list, so the drop target's group key is a constant. */
const GROUP_KEY = "embedded-items";

export interface EmbeddedTaskListProps {
  tasks: Task[];
  missingPaths?: string[];
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onOpenTask: (path: string) => void;
  onRemove: (path: string) => void;
  removeTitle?: (title: string) => string;
  /** Optional callback to render the bottom "+ Add..." trigger or selector */
  renderAddTrigger?: () => React.ReactNode;
  /**
   * When set, rows become drag-reorderable (mouse: small move; touch:
   * long-press, via the shared `useTaskDrag`). Called with the dropped task's
   * path and its target index within `tasks`. Used for Sub-tasks; Relations
   * omit it since they carry no order.
   */
  onReorder?: (path: string, toIndex: number) => void;
}

/**
 * Shared wrapper for embedded task lists (Sub-tasks and Relations).
 * Unifies TaskList configuration, missing row handling, and linear action buttons across views.
 */
export function EmbeddedTaskList({
  tasks,
  missingPaths = [],
  snapshot,
  taxonomies,
  onOpenTask,
  onRemove,
  removeTitle = (title) => `Remove ${title}`,
  renderAddTrigger,
  onReorder,
}: EmbeddedTaskListProps) {
  const drag = useTaskDrag((path, target) => {
    if (target.groupKey === GROUP_KEY) onReorder?.(path, target.index);
  });

  const isEmpty = tasks.length === 0 && missingPaths.length === 0;

  if (isEmpty && !renderAddTrigger) return null;

  const interaction: TaskListInteraction | undefined = onReorder
    ? {
        isDragging: (task) => drag.isDragging(task.path),
        onRowPointerDown: (event, task, groupKey) =>
          drag.onPointerDown(event, task.path, groupKey),
        onRowClick: (_event, task) => {
          // A drag ends with a trailing click; swallow it so a reorder
          // doesn't also open the task.
          if (drag.consumeDragClick()) return;
          onOpenTask(task.path);
        },
        dropIndexFor: (groupKey) => drag.dropIndexFor(groupKey),
      }
    : undefined;

  const draggedTask = drag.drag
    ? tasks.find((task) => task.path === drag.drag?.taskPath)
    : undefined;

  return (
    <div className="vf-list-embedded-container">
      {!isEmpty && (
        <TaskList
          className="vf-list-embedded"
          groups={[{ key: GROUP_KEY, tasks }]}
          snapshot={snapshot}
          taxonomies={taxonomies}
          onOpenTask={onOpenTask}
          interaction={interaction}
          rowAction={(item) => (
            <button
              type="button"
              className="vf-icon-button vf-row-remove"
              title={removeTitle(item.title)}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.path);
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        >
          {missingPaths.map((path) => (
            <MissingTaskRow
              key={path}
              label={basename(path)}
              onRemove={() => onRemove(path)}
              removeTitle={removeTitle(basename(path))}
            />
          ))}
        </TaskList>
      )}

      {drag.drag &&
        draggedTask &&
        createPortal(
          <div
            className="vf-drag-layer"
            style={{
              transform: `translate(${drag.drag.x + PREVIEW_OFFSET_PX}px, ${
                drag.drag.y + PREVIEW_OFFSET_PX
              }px)`,
              width: drag.drag.width,
            }}
            aria-hidden
          >
            <div className="vf-row vf-row-preview">
              <TaskRowContent
                task={draggedTask}
                snapshot={snapshot}
                taxonomies={taxonomies}
              />
            </div>
          </div>,
          document.body,
        )}

      {renderAddTrigger && (
        <div className="vf-embedded-list-footer">{renderAddTrigger()}</div>
      )}
    </div>
  );
}
