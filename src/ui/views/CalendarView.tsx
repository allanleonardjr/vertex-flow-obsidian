/**
 * Calendar (month grid) view (phase 2).
 *
 * A plain 7-column CSS grid — no calendar library, because FullCalendar and
 * react-big-calendar both assume time-of-day scheduling, which a day-bucketing
 * view has no use for.
 *
 * Task-only: Projects stay off the Calendar (a Project's authoritative date
 * *range* has nowhere to sit on a day grid — that's Timeline's job).
 *
 * Dragging reuses the Timeline machinery wholesale: `useScheduleDrag` for the
 * pointer gesture, and `taskBar` / `shiftBar` / `barDates` for the date math.
 * Moving a placed chip is a Timeline body-drag with a whole-day delta — a task
 * with both dates keeps its gap; dropping an unscheduled task just sets the one
 * field. The only Calendar-specific bit is the pixel→cell hit-test (a discrete
 * `data-date` lookup instead of Timeline's continuous pixel-to-day scale).
 */

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { layoutIcon, renderedHiddenFields } from "../../core/views";
import {
  bucketByDay,
  calendarAnchor,
  monthGrid,
  startOfMonth,
  unscheduledForCalendar,
} from "../../core/views/calendar";
import {
  addDays,
  barDates,
  dayNumber,
  shiftBar,
  taskBar,
} from "../../core/views/timeline";
import type {
  IsoDate,
  SavedView,
  Task,
  ViewCalendarState,
  WorkspaceSnapshot,
} from "../../core/types";
import { EmptyView } from "../components/EmptyView";
import { ResizeHandle } from "../components/ResizeHandle";
import { TaskRowContent } from "../components/TaskRow";
import { Popover } from "../components/Popover";
import { useCreateTask } from "../actions";
import { usePlugin } from "../context";
import { useSelection, useScrollFocusIntoView } from "../selection";
import { useTabs } from "../tabs-context";
import { useScheduleDrag } from "./useScheduleDrag";

/** How many chips a day cell shows before the rest fold into "+N more". */
const MAX_CHIPS_PER_DAY = 3;

/* Unscheduled-drawer resize bounds — matched to Timeline's lower pane so the
   two drawers feel identical. */
const UNSCHEDULED_MIN_HEIGHT = 64; // = Timeline's LOWER_MIN_HEIGHT
const UNSCHEDULED_DEFAULT_HEIGHT = 200; // = Timeline's LOWER_DEFAULT_HEIGHT
const GRID_MIN_HEIGHT = 140; // keeps some month grid visible, = Timeline's CHART_MIN_HEIGHT

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DATE_FIELDS: { id: SavedView["calendarDateField"]; label: string }[] = [
  { id: "dueDate", label: "Due" },
  { id: "startDate", label: "Start" },
];

export interface CalendarViewProps {
  snapshot: WorkspaceSnapshot;
  view: SavedView;
  evaluated: EvaluatedView;
  taxonomies: WorkspaceTaxonomies;
  /** Visible-month writes straight through to disk — see `useViewDraft`. */
  onCalendarChange: (calendar: ViewCalendarState) => void;
  /** The date-field toggle is definitional — it goes through the draft. */
  onChange: (next: SavedView) => void;
}

function monthLabel(iso: IsoDate): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function CalendarView({
  snapshot,
  view,
  evaluated,
  taxonomies,
  onCalendarChange,
  onChange,
}: CalendarViewProps) {
  // Fields the view saved as hidden, plus any the filters make redundant.
  const shownFields = useMemo(() => renderedHiddenFields(view), [view]);

  const plugin = usePlugin();
  const selection = useSelection();
  const tabs = useTabs();
  const createTask = useCreateTask();

  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  useScrollFocusIntoView(gridEl);

  const [moreDate, setMoreDate] = useState<IsoDate | null>(null);
  const [unscheduledCollapsed, setUnscheduledCollapsed] = useState(
    plugin.settings.calendarUnscheduledCollapsed,
  );
  const [unscheduledHeight, setUnscheduledHeight] = useState(
    plugin.settings.calendarUnscheduledHeight,
  );

  const dateField = view.calendarDateField;
  const todayIso = new Date().toISOString().slice(0, 10);

  const visibleMonth = startOfMonth(view.calendar?.visibleMonth ?? todayIso);
  const onCurrentMonth = visibleMonth === startOfMonth(todayIso);

  const tasks = evaluated.tasks;
  const buckets = useMemo(
    () => bucketByDay(tasks, dateField),
    [tasks, dateField],
  );
  const unscheduled = useMemo(
    () => unscheduledForCalendar(tasks, dateField),
    [tasks, dateField],
  );
  const cells = useMemo(() => monthGrid(visibleMonth), [visibleMonth]);

  const goToMonth = (iso: IsoDate) =>
    onCalendarChange({ visibleMonth: startOfMonth(iso) });

  /* -------------------------------------------------- drag hit-testing --- */

  const dateFromPoint = useCallback((x: number, y: number): IsoDate | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cell = el?.closest<HTMLElement>("[data-date]");
    return cell?.dataset.date ?? null;
  }, []);

  const scheduleDrag = useScheduleDrag((rowKey, x, y) => {
    const target = dateFromPoint(x, y);
    if (!target) return;
    const task = tasks.find((t) => t.path === rowKey);
    if (!task) return;

    const anchor = calendarAnchor(task, dateField);
    if (anchor) {
      // Moving a placed chip: Timeline's body-drag math verbatim, so a task
      // carrying both dates keeps the gap between them intact.
      const deltaDays = dayNumber(target) - dayNumber(anchor);
      if (deltaDays === 0) return;
      const moved = shiftBar(taskBar(task), deltaDays);
      void plugin.mutations.updateTask(task, barDates(moved));
    } else {
      // From the Unscheduled drawer: no prior position to diff, just set the
      // selected field — matching how Timeline's `useScheduleDrag` commits a
      // previously-unscheduled task.
      void plugin.mutations.updateTask(
        task,
        dateField === "dueDate" ? { dueDate: target } : { startDate: target },
      );
    }
  });

  const dragTargetDate = scheduleDrag.drag
    ? dateFromPoint(scheduleDrag.drag.x, scheduleDrag.drag.y)
    : null;

  /* --------------------------------------------------------- row open ---- */

  const openRow = (event: React.MouseEvent, task: Task) => {
    if (scheduleDrag.consumeDragClick()) return;
    const toggle = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;
    selection.select(task.path, { toggle, range });
    if (!toggle && !range) tabs.openTask(task.path);
  };

  const chipClass = (task: Task) =>
    `vf-cal-chip vf-row-open${
      selection.focusedPath === task.path ? " is-focused" : ""
    }${selection.isSelected(task.path) ? " is-selected" : ""}${
      task.archived ? " is-archived" : ""
    }${scheduleDrag.isDragging(task.path) ? " is-dragging" : ""}`;

  const renderChip = (task: Task) => (
    <button
      key={task.path}
      type="button"
      className={chipClass(task)}
      data-task-path={task.path}
      onPointerDown={(event) => scheduleDrag.onPointerDown(event, task.path)}
      onClick={(event) => openRow(event, task)}
    >
      <TaskRowContent
        task={task}
        snapshot={snapshot}
        taxonomies={taxonomies}
        hiddenFields={shownFields}
        dense
      />
    </button>
  );

  const onCellClick = (event: React.MouseEvent, iso: IsoDate) => {
    if (scheduleDrag.consumeDragClick()) return;
    // Only a click on the cell's own whitespace quick-creates — not a click
    // that bubbled up from a chip or the "+N more" button.
    if ((event.target as HTMLElement).closest(".vf-cal-chip, .vf-cal-more")) {
      return;
    }
    void createTask(
      snapshot,
      dateField === "dueDate" ? { dueDate: iso } : { startDate: iso },
    );
  };

  if (evaluated.total === 0) {
    return (
      <EmptyView
        icon={view.icon}
        iconFallback={layoutIcon(view.viewType)}
        title="Nothing here yet."
        note={
          <>
            Press <kbd>c</kbd> <kbd>t</kbd> to create a task.
          </>
        }
        onNewTask={() => void createTask(snapshot, {})}
      />
    );
  }

  const moreTasks = moreDate ? (buckets.get(moreDate) ?? []) : [];

  return (
    <div className="vf-calendar">
      <div className="vf-calendar-toolbar">
        <span className="vf-calendar-nav" role="group" aria-label="Month">
          <button
            type="button"
            className="vf-icon-button"
            aria-label="Previous month"
            title="Previous month"
            onClick={() => goToMonth(addDays(visibleMonth, -1))}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="vf-calendar-month">{monthLabel(visibleMonth)}</span>
          <button
            type="button"
            className="vf-icon-button"
            aria-label="Next month"
            title="Next month"
            onClick={() => goToMonth(addDays(visibleMonth, 32))}
          >
            <ChevronRight size={14} />
          </button>
        </span>

        <button
          type="button"
          className={`vf-bar-item${onCurrentMonth ? " is-on" : ""}`}
          title="Jump to the current month"
          onClick={() => goToMonth(todayIso)}
        >
          Today
        </button>

        <span className="vf-bar-spacer" />

        <span
          className="vf-calendar-datefield"
          role="group"
          aria-label="Date field"
        >
          {DATE_FIELDS.map((field) => (
            <button
              key={field.id}
              type="button"
              className={`vf-calendar-datefield-opt${
                dateField === field.id ? " is-on" : ""
              }`}
              aria-pressed={dateField === field.id}
              onClick={() =>
                dateField !== field.id &&
                onChange({ ...view, calendarDateField: field.id })
              }
            >
              {field.label}
            </button>
          ))}
        </span>
      </div>

      <div className="vf-calendar-body">
        <div className="vf-calendar-scroll" ref={setGridEl}>
          <div className="vf-calendar-weekdays" aria-hidden>
            {WEEKDAYS.map((day) => (
              <span key={day} className="vf-calendar-weekday">
                {day}
              </span>
            ))}
          </div>

          <div className="vf-calendar-grid">
            {cells.map((iso) => {
              const dayTasks = buckets.get(iso) ?? [];
              const shown = dayTasks.slice(0, MAX_CHIPS_PER_DAY);
              const overflow = dayTasks.length - shown.length;
              const outside = startOfMonth(iso) !== visibleMonth;
              return (
                <div
                  key={iso}
                  className={`vf-calendar-cell${outside ? " is-outside" : ""}${
                    iso === todayIso ? " is-today" : ""
                  }${iso === dragTargetDate ? " is-drag-target" : ""}`}
                  data-date={iso}
                  onClick={(event) => onCellClick(event, iso)}
                >
                  <span className="vf-calendar-daynum">
                    {Number(iso.slice(8, 10))}
                  </span>
                  <div className="vf-calendar-cell-chips">
                    {shown.map(renderChip)}
                    {overflow > 0 && (
                      <button
                        type="button"
                        className="vf-cal-more"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMoreDate(iso);
                        }}
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>

                  {moreDate === iso && (
                    <Popover align="left" onClose={() => setMoreDate(null)}>
                      <div
                        className="vf-calendar-more-list"
                        style={{
                          minWidth: Math.max(
                            200,
                            plugin.settings.taskPickerWidth - 120,
                          ),
                        }}
                      >
                        <div className="vf-calendar-more-head">
                          {monthLabel(iso)} · {Number(iso.slice(8, 10))}
                        </div>
                        {moreTasks.map((task) => (
                          <button
                            key={task.path}
                            type="button"
                            className={chipClass(task)}
                            data-task-path={task.path}
                            onClick={(event) => {
                              openRow(event, task);
                              setMoreDate(null);
                            }}
                          >
                            <TaskRowContent
                              task={task}
                              snapshot={snapshot}
                              taxonomies={taxonomies}
                              hiddenFields={shownFields}
                              dense
                            />
                          </button>
                        ))}
                      </div>
                    </Popover>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {unscheduled.length > 0 && !unscheduledCollapsed && (
          <ResizeHandle
            axis="y"
            sign={-1}
            value={unscheduledHeight}
            min={UNSCHEDULED_MIN_HEIGHT}
            computeMax={(h) => h - GRID_MIN_HEIGHT}
            onResize={setUnscheduledHeight}
            onResizeEnd={(next) => {
              plugin.settings.calendarUnscheduledHeight = next;
              void plugin.saveSettings();
            }}
            resetTo={UNSCHEDULED_DEFAULT_HEIGHT}
            className="vf-calendar-unscheduled-handle"
          />
        )}

        {unscheduled.length > 0 && (
          <div
            className={`vf-calendar-unscheduled${
              unscheduledCollapsed ? " is-collapsed" : ""
            }`}
            style={
              unscheduledCollapsed ? undefined : { height: unscheduledHeight }
            }
          >
            <button
              type="button"
              className="vf-calendar-unscheduled-head"
              aria-expanded={!unscheduledCollapsed}
              onClick={() => {
                const next = !unscheduledCollapsed;
                setUnscheduledCollapsed(next);
                plugin.settings.calendarUnscheduledCollapsed = next;
                void plugin.saveSettings();
              }}
            >
              <ChevronsUpDown size={12} aria-hidden />
              <span>Unscheduled</span>
              <span className="vf-count">{unscheduled.length}</span>
              <span className="vf-calendar-unscheduled-hint">
                drag onto a day to schedule
              </span>
            </button>

            {!unscheduledCollapsed && (
              <div className="vf-calendar-unscheduled-body">
                {unscheduled.map((task) => (
                  <div
                    key={task.path}
                    className={`vf-row vf-calendar-unscheduled-row${
                      selection.focusedPath === task.path ? " is-focused" : ""
                    }${selection.isSelected(task.path) ? " is-selected" : ""}${
                      scheduleDrag.isDragging(task.path) ? " is-dragging" : ""
                    }`}
                    data-task-path={task.path}
                    onPointerDown={(event) =>
                      scheduleDrag.onPointerDown(event, task.path)
                    }
                    onClick={(event) => openRow(event, task)}
                  >
                    <TaskRowContent
                      task={task}
                      snapshot={snapshot}
                      taxonomies={taxonomies}
                      hiddenFields={shownFields}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {scheduleDrag.drag &&
        createPortal(
          <div
            className="vf-timeline-schedule-ghost"
            style={{
              transform: `translate(${scheduleDrag.drag.x + 16}px, ${
                scheduleDrag.drag.y + 16
              }px)`,
            }}
            aria-hidden
          >
            {dragTargetDate ?? "Release over a day"}
          </div>,
          document.body,
        )}
    </div>
  );
}
