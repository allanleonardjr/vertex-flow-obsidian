/**
 * List view (§8.1) — the Saved View rendered as dense, Linear-style rows.
 *
 * The rows, groups, and sections all come from the shared `TaskList` module,
 * so this file is now only what makes it a *view*: turning an evaluated Saved
 * View into groups, and layering on drag-and-drop, selection, and keyboard
 * focus. Reordering is the whole point of a manually-ranked backlog (§6), so
 * a list you can't drag in would be the wrong half of the feature.
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView, NestedRow } from "../../core/views";
import {
  layoutIcon,
  renderedHiddenFields,
  toggleColumnCollapsed,
} from "../../core/views";
import { planDeletion, scopeOf, type DeletionPlan } from "../../core/hierarchy";
import type {
  SavedView,
  Task,
  TaskField,
  ViewColumnState,
  WorkspaceSnapshot,
} from "../../core/types";
import { EmptyView } from "../components/EmptyView";
import {
  TaskList,
  type TaskListGroup,
  type TaskListInteraction,
} from "../components/TaskList";
import { TaskRowContent } from "../components/TaskRow";
import { DeleteEntityDialog } from "../DeleteEntityDialog";
import { useTabs } from "../tabs-context";
import { useSelection, useScrollFocusIntoView } from "../selection";
import { openOrSelect } from "./BoardView";
import { useTaskDropHandler } from "./useDropHandler";
import { PREVIEW_OFFSET_PX, useTaskDrag, type DragState } from "./useTaskDrag";

/** A rendered group plus its nested forest — built by `TaskViewport`. */
export interface NestedListGroup {
  key: string;
  label?: string;
  color?: string | null;
  collapsed?: boolean;
  hidden?: boolean;
  tasks: Task[];
  rows: NestedRow[];
}

export interface ListViewProps {
  snapshot: WorkspaceSnapshot;
  view: SavedView;
  evaluated: EvaluatedView;
  taxonomies: WorkspaceTaxonomies;
  /**
   * The nested forests, one per group, when `subtaskDisplay === "nested"`.
   * `null` for `flat`/`hidden` — those render plain, draggable rows.
   */
  nestedGroups: NestedListGroup[] | null;
  /** Nested mode: which parent rows have a collapsed subtree (transient). */
  collapsedSubtrees: ReadonlySet<string>;
  onToggleSubtree: (path: string) => void;
  /** Group collapse writes straight through to disk — see `useViewDraft`. */
  onColumnsChange: (columns: ViewColumnState) => void;
  /** Create a task seeded from this view's filters (see `TaskViewport`). */
  onNewTask: () => void;
  /** Discard unsaved view edits — the view bar's "Reset". */
  onClearFilters: () => void;
}

export function ListView({
  snapshot,
  view,
  evaluated,
  taxonomies,
  nestedGroups,
  collapsedSubtrees,
  onToggleSubtree,
  onColumnsChange,
  onNewTask,
  onClearFilters,
}: ListViewProps) {
  // Fields the view saved as hidden, plus any the filters make redundant.
  const shownFields = useMemo(() => renderedHiddenFields(view), [view]);

  const drag = useTaskDrag(useTaskDropHandler(view, evaluated));
  const selection = useSelection();
  const tabs = useTabs();
  const [deletePlan, setDeletePlan] = useState<DeletionPlan | null>(null);

  const draggedTask = drag.drag
    ? evaluated.tasks.find((task) => task.path === drag.drag?.taskPath)
    : undefined;

  const [list, setList] = useState<HTMLDivElement | null>(null);
  useScrollFocusIntoView(list);

  if (evaluated.total === 0) {
    const filtered = evaluated.filteredOut > 0;
    return (
      <EmptyView
        icon={view.icon}
        iconFallback={layoutIcon(view.viewType)}
        title={filtered ? "No tasks match this filter" : "Nothing here yet."}
        note={
          filtered ? undefined : (
            <>
              Press <kbd>c</kbd> to create a task.
            </>
          )
        }
        onNewTask={filtered ? undefined : onNewTask}
        action={
          filtered
            ? { label: "Clear filters", onClick: onClearFilters }
            : undefined
        }
      />
    );
  }

  // The nested forest is drag-free — a sub-task's order is a task-editor
  // concern (§7.2). Flat/hidden rows keep full drag-to-reorder.
  const nested = nestedGroups != null;

  const interaction: TaskListInteraction = {
    isFocused: (task) => selection.focusedPath === task.path,
    isSelected: (task) => selection.isSelected(task.path),
    isDragging: (task) => !nested && drag.isDragging(task.path),
    onRowPointerDown: nested
      ? undefined
      : (event, task, groupKey) =>
          drag.onPointerDown(event, task.path, groupKey),
    onRowClick: (event, task) =>
      openOrSelect(event, task.path, drag, selection, tabs),
    dropIndexFor: nested ? undefined : (groupKey) => drag.dropIndexFor(groupKey),
    onToggleGroupCollapse:
      evaluated.view.groupBy === "none"
        ? undefined
        : (groupKey) =>
            onColumnsChange(toggleColumnCollapsed(view, groupKey).columns),
  };

  const groups: TaskListGroup[] = nested
    ? nestedGroups!.filter((group) => !group.hidden)
    : evaluated.groups.filter((group) => !group.hidden);

  const rowAction = (task: Task) => (
    <button
      type="button"
      className="vf-icon-button vf-row-remove"
      title={`Delete ${task.title}`}
      onClick={(e) => {
        e.stopPropagation();
        setDeletePlan(planDeletion(scopeOf(snapshot), task));
      }}
    >
      <Trash2 size={13} />
    </button>
  );

  return (
    <>
      <TaskList
        groups={groups}
        snapshot={snapshot}
        taxonomies={taxonomies}
        grouped={evaluated.view.groupBy !== "none"}
        interaction={interaction}
        onOpenTask={tabs.openTask}
        hiddenFields={shownFields}
        emptyGroupLabel="Drop tasks here"
        collapsedSubtrees={collapsedSubtrees}
        onToggleSubtree={onToggleSubtree}
        containerRef={setList}
        rowAction={rowAction}
      >
        {!nested && drag.drag && draggedTask && (
          <RowPreview
            drag={drag.drag}
            task={draggedTask}
            snapshot={snapshot}
            taxonomies={taxonomies}
            hiddenFields={shownFields}
          />
        )}
      </TaskList>

      {deletePlan && (
        <DeleteEntityDialog
          snapshot={snapshot}
          plan={deletePlan}
          onClose={() => setDeletePlan(null)}
        />
      )}
    </>
  );
}

/** The row that follows the pointer while dragging. See `DragPreview`. */
function RowPreview({
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
      <div className="vf-row vf-row-preview">
        <TaskRowContent
          task={task}
          snapshot={snapshot}
          taxonomies={taxonomies}
          hiddenFields={hiddenFields}
        />
      </div>
    </div>,
    document.body,
  );
}
