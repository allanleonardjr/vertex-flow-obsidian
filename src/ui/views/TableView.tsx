/**
 * Table view — the Saved View rendered as a spreadsheet-style grid.
 *
 * The rows and columns come from the shared `TaskTable` module, so this file
 * is only what makes it a *view*: turning an evaluated Saved View into groups
 * and layering on open-task and selection — the same seam `ListView` has over
 * `TaskList` — plus column drag-to-reorder (`useColumnDrag`). Unlike List/
 * Board, Table rows never drag — its ordering mechanism is `tableSort`, full
 * stop — so row selection uses a stub `TaskDragApi` satisfying `openOrSelect`'s
 * signature rather than a real row-drag hook.
 */
import { useMemo } from "react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { layoutIcon, toggleColumnCollapsed } from "../../core/views";
import type {
  SavedView,
  TableSortKey,
  TaskField,
  ViewColumnState,
  WorkspaceSnapshot,
} from "../../core/types";
import { EmptyView } from "../components/EmptyView";
import { MANDATORY_COLUMNS, orderedTaskFields, TaskTable } from "../components/TaskTable";
import type { TaskListGroup, TaskListInteraction } from "../components/TaskList";
import { useTabs } from "../tabs-context";
import { useSelection } from "../selection";
import { openOrSelect } from "./BoardView";
import { useColumnDrag } from "./useColumnDrag";
import type { TaskDragApi } from "./useTaskDrag";
import { layoutHiddenFields } from "./viewOptions";

/** Table rows never drag — a stub satisfying `openOrSelect`'s signature. */
const NO_DRAG: TaskDragApi = {
  drag: null,
  onPointerDown: () => {},
  isDragging: () => false,
  consumeDragClick: () => false,
  dropIndexFor: () => null,
};

export interface TableViewProps {
  snapshot: WorkspaceSnapshot;
  view: SavedView;
  evaluated: EvaluatedView;
  taxonomies: WorkspaceTaxonomies;
  /** Group collapse writes straight through to disk — see `useViewDraft`. */
  onColumnsChange: (columns: ViewColumnState) => void;
  /** Table-column sort is definitional — held in the draft until Save, like every other display control. */
  onChange: (next: SavedView) => void;
  /** Column order is furniture — writes straight through on drop. */
  onColumnOrderChange: (order: TaskField[]) => void;
  /** Column widths are furniture — writes straight through on resize-end. */
  onColumnWidthsChange: (widths: Record<string, number>) => void;
  /** Frozen-column count is furniture — writes straight through. */
  onFrozenColumnCountChange: (frozenColumnCount: number) => void;
  /** Create a task seeded from this view's filters (see `TaskViewport`). */
  onNewTask: () => void;
  /** Discard unsaved view edits — the view bar's "Reset". */
  onClearFilters: () => void;
}

export function TableView({
  snapshot,
  view,
  evaluated,
  taxonomies,
  onColumnsChange,
  onChange,
  onColumnOrderChange,
  onColumnWidthsChange,
  onFrozenColumnCountChange,
  onNewTask,
  onClearFilters,
}: TableViewProps) {
  // Fields the view saved as hidden, plus any the filters make redundant.
  const shownFields = useMemo(() => layoutHiddenFields(view), [view]);
  // The reorderable (non-mandatory) column set, in display order — the exact
  // same list `TaskTable` renders, so a drag's insertion index means the same
  // thing on both sides.
  const fieldColumns = useMemo(
    () => orderedTaskFields(shownFields, view.columnOrder),
    [shownFields, view.columnOrder],
  );
  // Wraps `onColumnOrderChange` so a drop that crosses the freeze boundary
  // also adjusts `frozenColumnCount` by exactly 1 — the same calculation
  // `TaskTable.tsx` runs live during the drag (see its own comment), run
  // once more here to decide what actually gets persisted. The two must
  // stay in agreement, or the table would render one thing mid-drag and
  // save something else at drop.
  const handleColumnDrop = (
    nextOrder: TaskField[],
    droppedColumn: TaskField,
    targetIndex: number,
  ) => {
    onColumnOrderChange(nextOrder);

    const frozenCount = view.frozenColumnCount ?? 3;
    const originalIndex =
      MANDATORY_COLUMNS.length + fieldColumns.indexOf(droppedColumn);
    const finalIndex = MANDATORY_COLUMNS.length + targetIndex;
    const wasFrozen = originalIndex < frozenCount;
    const willBeFrozen = finalIndex < frozenCount;
    if (!wasFrozen && willBeFrozen) {
      onFrozenColumnCountChange(frozenCount + 1);
    } else if (wasFrozen && !willBeFrozen) {
      onFrozenColumnCountChange(Math.max(0, frozenCount - 1));
    }
  };
  const columnDrag = useColumnDrag(fieldColumns, handleColumnDrop);

  const selection = useSelection();
  const tabs = useTabs();

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
              Press <kbd>c</kbd> <kbd>t</kbd> to create a task.
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

  const interaction: TaskListInteraction = {
    isFocused: (task) => selection.focusedPath === task.path,
    isSelected: (task) => selection.isSelected(task.path),
    onRowClick: (event, task) =>
      openOrSelect(event, task.path, NO_DRAG, selection, tabs),
    onToggleGroupCollapse:
      evaluated.view.groupBy === "none"
        ? undefined
        : (groupKey) =>
            onColumnsChange(toggleColumnCollapsed(view, groupKey).columns),
  };

  const groups: TaskListGroup[] = evaluated.groups.filter(
    (group) => !group.hidden,
  );

  const setTableSort = (tableSort: TableSortKey[]) =>
    onChange({ ...view, tableSort });

  return (
    <TaskTable
      groups={groups}
      snapshot={snapshot}
      taxonomies={taxonomies}
      grouped={evaluated.view.groupBy !== "none"}
      interaction={interaction}
      onOpenTask={tabs.openTask}
      hiddenFields={shownFields}
      columnOrder={view.columnOrder}
      tableSort={view.tableSort}
      onSortChange={setTableSort}
      tableStripe={view.tableStripe}
      emptyGroupLabel="No tasks"
      reorder={columnDrag}
      columnWidths={view.columnWidths}
      onColumnWidthsChange={onColumnWidthsChange}
      frozenColumnCount={view.frozenColumnCount}
      onFrozenColumnCountChange={onFrozenColumnCountChange}
    />
  );
}
