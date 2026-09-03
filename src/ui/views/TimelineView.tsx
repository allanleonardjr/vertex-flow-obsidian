/**
 * Timeline (Gantt) view (phase 3).
 *
 * Custom-built rather than library-backed: mobile-touch parity with the rest
 * of the plugin, Obsidian theming, and reuse of the shared task row all
 * mattered more than a head start on the drawing.
 *
 * Layout: a fixed task-label column (the same `TaskRowContent` the List view
 * uses) beside the chart. Only the chart scrolls horizontally; the label
 * column and the Unscheduled pane never do. Vertical scroll is owned by the
 * chart and mirrored onto the label column so the two stay row-aligned.
 *
 * Both separators are drag-resizable and collapsible (`ResizeHandle`), and
 * double-clicking either one sizes that pane to its contents. Those sizes are
 * plugin-global UI state, like the editor rail's.
 *
 * Bars and milestones take their status's colour. Bars are interactive from
 * the start (`useBarDrag`): drag an edge to move one date, drag the body to
 * move both and keep the gap; the dragged date(s) show as a label. An
 * unscheduled task can be dragged up onto the chart to get a `dueDate` where
 * it lands (`useScheduleDrag`), with the same live date read-out.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { getValue, type WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { layoutIcon, renderedHiddenFields } from "../../core/views";
import {
  barDates,
  dateRangeOf,
  dayNumber,
  isoFromDay,
  partitionScheduled,
  taskBar,
  type Bar,
} from "../../core/views/timeline";
import type {
  SavedView,
  Task,
  ViewTimelineState,
  WorkspaceSnapshot,
} from "../../core/types";
import { EmptyView } from "../components/EmptyView";
import { TaskRowContent } from "../components/TaskRow";
import { ResizeHandle } from "../components/ResizeHandle";
import { useCreateTask } from "../actions";
import { usePlugin } from "../context";
import { useSelection, useScrollFocusIntoView } from "../selection";
import { useTabs } from "../tabs-context";
import { useBarDrag, type BarDragZone } from "./useBarDrag";
import { useScheduleDrag } from "./useScheduleDrag";
import { PREVIEW_OFFSET_PX } from "./useTaskDrag";

/** Named zoom presets — pixels per day (the UI owns these values). */
const ZOOM_PRESETS: { id: string; label: string; scale: number }[] = [
  { id: "day", label: "Day", scale: 40 },
  { id: "week", label: "Week", scale: 18 },
  { id: "month", label: "Month", scale: 7 },
  { id: "quarter", label: "Quarter", scale: 2.6 },
  { id: "year", label: "Year", scale: 1 },
];
const DEFAULT_SCALE = ZOOM_PRESETS[1].scale;
const MIN_SCALE = 0.4;
const MAX_SCALE = 120;

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 40;
const LOWER_HEAD_HEIGHT = 28;
/** Blank days kept on each side of the outermost bar. */
const DOMAIN_PADDING_DAYS = 7;

const LEFT_MIN_WIDTH = 140;
const LEFT_DEFAULT_WIDTH = 300;
/** Width of the label column when collapsed — just room for the expander. */
const LEFT_RAIL_WIDTH = 26;
/** Keep at least this much chart visible beside the label column. */
const CHART_MIN_WIDTH = 220;

const LOWER_MIN_HEIGHT = 64;
const LOWER_DEFAULT_HEIGHT = 200;
/** Keep at least this much chart visible above the Unscheduled pane. */
const CHART_MIN_HEIGHT = 140;

/** Below this container width the label column is clamped to `MAX_LABEL_CLAMP_PX`. */
const TIMELINE_NARROW_PX = 620;

/** The widest the expanded label column can be on a narrow pane, so the chart
    always keeps a usable slice. */
const MAX_LABEL_CLAMP_PX = 220;

export interface TimelineViewProps {
  snapshot: WorkspaceSnapshot;
  view: SavedView;
  evaluated: EvaluatedView;
  taxonomies: WorkspaceTaxonomies;
  /** Zoom/scroll writes straight through to disk — see `useViewDraft`. */
  onTimelineChange: (timeline: ViewTimelineState) => void;
}

export function TimelineView({
  snapshot,
  view,
  evaluated,
  taxonomies,
  onTimelineChange,
}: TimelineViewProps) {
  // Fields the view saved as hidden, plus any the filters make redundant.
  const shownFields = useMemo(() => renderedHiddenFields(view), [view]);

  const plugin = usePlugin();
  const selection = useSelection();
  const tabs = useTabs();
  const createTask = useCreateTask();

  const [chartEl, setChartEl] = useState<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const labelsInnerRef = useRef<HTMLDivElement | null>(null);
  const lowerRef = useRef<HTMLDivElement | null>(null);
  const lowerBodyRef = useRef<HTMLDivElement | null>(null);
  useScrollFocusIntoView(chartEl);
  const width = useElementWidth(chartEl);

  /* --------------------------------------------------------------- chrome -- */

  const [leftWidth, setLeftWidth] = useState(plugin.settings.timelineLeftWidth);
  const [leftCollapsed, setLeftCollapsed] = useState(
    plugin.settings.timelineLeftCollapsed,
  );
  const [lowerHeight, setLowerHeight] = useState(
    plugin.settings.timelineLowerHeight,
  );
  const [lowerCollapsed, setLowerCollapsed] = useState(
    plugin.settings.timelineLowerCollapsed,
  );

  /* Narrow-pane clamping: a Gantt is a fat visualization — with a ~300px label
     column plus the toolbar, a narrow pane leaves almost nothing for the chart
     body. When the pane drops below a floor width the label column is capped at
     `MAX_LABEL_CLAMP_PX` so the chart always has room to breathe. The resize
     handle stays visible so the user retains full manual control (they just
     can't widen the label past the clamp while the pane is small). The moment
     the pane widens the cap lifts and the stored drag width returns unchanged. */
  const [timelineEl, setTimelineEl] = useState<HTMLDivElement | null>(null);
  const [timelineWidth, setTimelineWidth] = useState(0);
  useLayoutEffect(() => {
    if (!timelineEl) return;
    setTimelineWidth(timelineEl.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setTimelineWidth(entry.contentRect.width);
    });
    observer.observe(timelineEl);
    return () => observer.disconnect();
  }, [timelineEl]);

  const persist = useCallback(
    (patch: Partial<typeof plugin.settings>) => {
      Object.assign(plugin.settings, patch);
      void plugin.saveSettings();
    },
    [plugin],
  );

  const labelWidth = leftCollapsed
    ? LEFT_RAIL_WIDTH
    : timelineWidth > 0 && timelineWidth < TIMELINE_NARROW_PX
      ? Math.min(leftWidth, MAX_LABEL_CLAMP_PX)
      : leftWidth;

  /* ------------------------------------------------------ chart model --- */

  const tasks = evaluated.tasks;

  const bars = useMemo(
    () => new Map(tasks.map((task) => [task.path, taskBar(task)])),
    [tasks],
  );
  // Scheduled rows first, then unscheduled — the shared order keyboard nav in
  // `TaskViewport` also walks.
  const { scheduled, unscheduled } = useMemo(
    () => partitionScheduled(tasks),
    [tasks],
  );

  const statusColor = useCallback(
    (task: Task) => getValue(taxonomies.status, task.status)?.color ?? null,
    [taxonomies.status],
  );

  // The span the *content* needs: the bars' own range, padded, or a month
  // either side of today when nothing is scheduled yet. Drives the "All" zoom.
  const contentDomain = useMemo(() => {
    const range = dateRangeOf([...bars.values()]);
    const todayDay = dayNumber(new Date().toISOString());
    let minDay = range
      ? dayNumber(range.min) - DOMAIN_PADDING_DAYS
      : todayDay - 30;
    let maxDay = range
      ? dayNumber(range.max) + DOMAIN_PADDING_DAYS
      : todayDay + 30;
    minDay = Math.min(minDay, todayDay - 2);
    maxDay = Math.max(maxDay, todayDay + 2);
    return { minDay, maxDay, days: maxDay - minDay + 1 };
  }, [bars]);

  const allScale =
    width > 0
      ? clampScale(width / Math.max(1, contentDomain.days))
      : DEFAULT_SCALE;
  const storedScale = view.timeline?.scale;
  const scale =
    storedScale != null && storedScale > 0
      ? clampScale(storedScale)
      : DEFAULT_SCALE;

  // The span actually rendered: the content span, widened symmetrically with
  // blank days so the chart always fills the pane instead of trailing off into
  // empty space. Day columns keep the same pixel width — there are just more
  // of them.
  const domain = useMemo(() => {
    if (width <= 0) return contentDomain;
    const needed = Math.ceil(width / scale);
    if (needed <= contentDomain.days) return contentDomain;
    const extra = needed - contentDomain.days;
    const before = Math.floor(extra / 2);
    return {
      minDay: contentDomain.minDay - before,
      maxDay: contentDomain.maxDay + (extra - before),
      days: needed,
    };
  }, [contentDomain, width, scale]);

  const chartWidth = domain.days * scale;
  const dayOffset = useCallback(
    (iso: string) => (dayNumber(iso) - domain.minDay) * scale,
    [domain.minDay, scale],
  );

  /** Viewport client-x → an ISO date, clamped to the domain; null off-chart. */
  const clientPointToDate = useCallback(
    (x: number, y: number): string | null => {
      if (!chartEl) return null;
      const hit = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!hit || !hit.closest(".vf-timeline-chart")) return null;
      const rect = chartEl.getBoundingClientRect();
      const contentX = x - rect.left + chartEl.scrollLeft;
      const day = domain.minDay + Math.round(contentX / scale);
      return isoFromDay(Math.max(domain.minDay, Math.min(domain.maxDay, day)));
    },
    [chartEl, domain.minDay, domain.maxDay, scale],
  );

  /* -------------------------------------------------- zoom + scroll ------ */

  const commitTimeline = useCallback(
    (nextScale: number) => {
      const leftDay = chartEl
        ? domain.minDay + Math.round(chartEl.scrollLeft / scale)
        : domain.minDay;
      onTimelineChange({ scale: nextScale, scrollDate: isoFromDay(leftDay) });
    },
    [chartEl, domain.minDay, scale, onTimelineChange],
  );

  // Restore the saved scroll position once the pane and its width are ready.
  const restoredFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!chartEl || width === 0) return;
    if (restoredFor.current === view.id) return;
    restoredFor.current = view.id;
    const target = view.timeline?.scrollDate;
    chartEl.scrollLeft = target
      ? Math.max(0, (dayNumber(target) - domain.minDay) * scale)
      : Math.max(0, dayOffset(new Date().toISOString()) - width / 3);
  }, [
    chartEl,
    width,
    view.id,
    view.timeline?.scrollDate,
    domain.minDay,
    scale,
    dayOffset,
  ]);

  // Keep the same date at the left edge across a zoom change.
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    if (!chartEl || prevScale.current === scale) return;
    const anchor = view.timeline?.scrollDate;
    chartEl.scrollLeft = anchor
      ? Math.max(0, (dayNumber(anchor) - domain.minDay) * scale)
      : chartEl.scrollLeft * (scale / prevScale.current);
    prevScale.current = scale;
  }, [scale, chartEl, view.timeline?.scrollDate, domain.minDay]);

  // Persist the horizontal scroll position, debounced.
  const scrollTimer = useRef<number | null>(null);
  const onChartScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      // Mirror vertical scroll onto the (non-scrollable) label column.
      if (labelsRef.current) {
        labelsRef.current.scrollTop = event.currentTarget.scrollTop;
      }
      if (scrollTimer.current != null) window.clearTimeout(scrollTimer.current);
      const el = event.currentTarget;
      scrollTimer.current = window.setTimeout(() => {
        onTimelineChange({
          scale: storedScale ?? scale,
          scrollDate: isoFromDay(
            domain.minDay + Math.round(el.scrollLeft / scale),
          ),
        });
      }, 600);
    },
    [storedScale, scale, domain.minDay, onTimelineChange],
  );
  useEffect(
    () => () => {
      if (scrollTimer.current != null) window.clearTimeout(scrollTimer.current);
    },
    [],
  );

  // Wheeling over the label column scrolls the chart vertically.
  const onLabelsWheel = (event: React.WheelEvent) => {
    if (chartEl) chartEl.scrollTop += event.deltaY;
  };

  const scrollToToday = () => {
    chartEl?.scrollTo({
      left: Math.max(0, dayOffset(new Date().toISOString()) - width / 3),
      behavior: "smooth",
    });
  };

  /* --------------------------------------------- fit-to-contents -------- */

  const fitLabels = useCallback(() => {
    const inner = labelsInnerRef.current;
    if (!inner) return;
    let widest = 0;
    inner
      .querySelectorAll<HTMLElement>(".vf-timeline-row-label")
      .forEach((el) => {
        widest = Math.max(widest, el.scrollWidth);
      });
    const region = inner.closest(".vf-timeline-chart-region");
    const cap = region
      ? region.clientWidth - CHART_MIN_WIDTH
      : LEFT_DEFAULT_WIDTH;
    const next = Math.round(
      Math.max(LEFT_MIN_WIDTH, Math.min(cap, widest + 24)),
    );
    setLeftWidth(next);
    persist({ timelineLeftWidth: next });
  }, [persist]);

  const fitLower = useCallback(() => {
    const body = lowerBodyRef.current;
    if (!body) return;
    const region = lowerRef.current?.closest(".vf-timeline-body");
    const cap = region
      ? region.clientHeight - CHART_MIN_HEIGHT
      : LOWER_DEFAULT_HEIGHT;
    const next = Math.round(
      Math.max(
        LOWER_MIN_HEIGHT,
        Math.min(cap, body.scrollHeight + LOWER_HEAD_HEIGHT),
      ),
    );
    setLowerHeight(next);
    persist({ timelineLowerHeight: next });
  }, [persist]);

  /* -------------------------------------------------- dragging ---------- */

  const barDrag = useBarDrag({
    scale,
    onCommit: (rowKey, bar) => {
      const task = tasks.find((t) => t.path === rowKey);
      if (task) void plugin.mutations.updateTask(task, barDates(bar));
    },
  });

  const scheduleDrag = useScheduleDrag((rowKey, x, y) => {
    const date = clientPointToDate(x, y);
    if (!date) return;
    const task = tasks.find((t) => t.path === rowKey);
    if (task) void plugin.mutations.updateTask(task, { dueDate: date });
  });

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

  const { bands, ticks } = buildTimeScale(domain.minDay, domain.days, scale);
  const todayLeft = dayOffset(new Date().toISOString());
  const todayInView = todayLeft >= 0 && todayLeft <= chartWidth;
  const bodyHeight = HEADER_HEIGHT + scheduled.length * ROW_HEIGHT;

  const openRow = (event: React.MouseEvent, task: Task) => {
    if (barDrag.consumeDragClick() || scheduleDrag.consumeDragClick()) return;
    const toggle = event.metaKey || event.ctrlKey;
    const range = event.shiftKey;
    selection.select(task.path, { toggle, range });
    if (!toggle && !range) tabs.openTask(task.path);
  };

  const hasLower = unscheduled.length > 0;
  const scheduleGhostDate = scheduleDrag.drag
    ? clientPointToDate(scheduleDrag.drag.x, scheduleDrag.drag.y)
    : null;
  const draggedScheduleTask = scheduleDrag.drag
    ? unscheduled.find((task) => task.path === scheduleDrag.drag?.rowKey)
    : undefined;

  return (
    <div
      ref={setTimelineEl}
      className={`vf-timeline${leftCollapsed ? " is-left-collapsed" : ""}`}
      style={
        {
          "--vf-tl-row-h": `${ROW_HEIGHT}px`,
          "--vf-tl-header-h": `${HEADER_HEIGHT}px`,
          "--vf-tl-left-w": `${labelWidth}px`,
        } as React.CSSProperties
      }
    >
      <div className="vf-timeline-toolbar">
        <span className="vf-timeline-zoom" role="group" aria-label="Zoom">
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`vf-timeline-zoom-opt${
                approxEqual(scale, preset.scale) ? " is-on" : ""
              }`}
              onClick={() => commitTimeline(preset.scale)}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className={`vf-timeline-zoom-opt${
              approxEqual(scale, allScale) ? " is-on" : ""
            }`}
            title="Fit the whole range"
            onClick={() => commitTimeline(allScale)}
          >
            All
          </button>
        </span>
        <span className="vf-bar-spacer" />
        <button type="button" className="vf-bar-item" onClick={scrollToToday}>
          Today
        </button>
      </div>

      <div className="vf-timeline-body">
        <div className="vf-timeline-chart-region">
          {/* Fixed label column — mirrors the chart's vertical scroll. */}
          <div
            className="vf-timeline-labels"
            ref={labelsRef}
            onWheel={onLabelsWheel}
          >
            <div className="vf-timeline-labels-inner" ref={labelsInnerRef}>
              <div className="vf-timeline-corner">
                {leftCollapsed ? (
                  <button
                    type="button"
                    className="vf-icon-button vf-timeline-left-toggle"
                    title="Expand task column"
                    aria-label="Expand task column"
                    onClick={() => {
                      setLeftCollapsed(false);
                      persist({ timelineLeftCollapsed: false });
                    }}
                  >
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <>
                    <span className="vf-timeline-corner-count">
                      {scheduled.length} scheduled
                    </span>
                    <button
                      type="button"
                      className="vf-icon-button vf-timeline-left-toggle"
                      title="Collapse task column"
                      aria-label="Collapse task column"
                      onClick={() => {
                        setLeftCollapsed(true);
                        persist({ timelineLeftCollapsed: true });
                      }}
                    >
                      <ChevronLeft size={14} />
                    </button>
                  </>
                )}
              </div>

              {scheduled.map((task) => (
                <button
                  key={task.path}
                  type="button"
                  className={`vf-timeline-row-label vf-row-open${
                    selection.focusedPath === task.path ? " is-focused" : ""
                  }${selection.isSelected(task.path) ? " is-selected" : ""}${
                    task.archived ? " is-archived" : ""
                  }`}
                  data-task-path={task.path}
                  title={leftCollapsed ? task.title : undefined}
                  onClick={(event) => openRow(event, task)}
                >
                  {!leftCollapsed && (
                    <TaskRowContent
                      task={task}
                      snapshot={snapshot}
                      taxonomies={taxonomies}
                      hiddenFields={shownFields}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {!leftCollapsed && (
            <ResizeHandle
              axis="x"
              sign={1}
              value={labelWidth}
              min={LEFT_MIN_WIDTH}
              computeMax={(w) => w - CHART_MIN_WIDTH}
              onResize={setLeftWidth}
              onResizeEnd={(next) => {
                setLeftWidth(next);
                persist({ timelineLeftWidth: next });
              }}
              onReset={fitLabels}
              className="vf-timeline-left-handle"
              title="Drag to resize — double-click to fit"
            />
          )}

          {/* The one horizontally-scrolling region. */}
          <div
            className="vf-timeline-chart"
            ref={setChartEl}
            onScroll={onChartScroll}
          >
            <div
              className="vf-timeline-chart-content"
              style={{ width: chartWidth, minHeight: bodyHeight }}
            >
              <div
                className="vf-timeline-chart-header"
                style={{ width: chartWidth }}
              >
                <div className="vf-timeline-band">
                  {bands.map((band) => (
                    <div
                      key={band.key}
                      className="vf-timeline-band-cell"
                      style={{ left: band.left, width: band.width }}
                    >
                      <span>{band.label}</span>
                    </div>
                  ))}
                </div>
                <div className="vf-timeline-ticks">
                  {ticks.map((tick) => (
                    <div
                      key={tick.key}
                      className={`vf-timeline-tick${tick.major ? " is-major" : ""}`}
                      style={{ left: tick.left, width: tick.width }}
                    >
                      <span>{tick.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {scheduled.map((task) => {
                const committed = bars.get(task.path) ?? {
                  kind: "unscheduled" as const,
                };
                const bar = barDrag.previewFor(task.path) ?? committed;
                return (
                  <div
                    key={task.path}
                    className={`vf-timeline-lane${
                      barDrag.isDragging(task.path) ? " is-dragging" : ""
                    }`}
                    data-task-path={task.path}
                    onClick={(event) => openRow(event, task)}
                  >
                    <BarShape
                      rowKey={task.path}
                      bar={bar}
                      color={statusColor(task)}
                      chartWidth={chartWidth}
                      dayOffset={dayOffset}
                      scale={scale}
                      onBarPointerDown={barDrag.onPointerDown}
                    />
                  </div>
                );
              })}

              {todayInView && (
                <div
                  className="vf-timeline-today"
                  style={{ left: todayLeft, height: bodyHeight }}
                  aria-hidden
                />
              )}
            </div>
          </div>
        </div>

        {hasLower && !lowerCollapsed && (
          <ResizeHandle
            axis="y"
            sign={-1}
            value={lowerHeight}
            min={LOWER_MIN_HEIGHT}
            computeMax={(h) => h - CHART_MIN_HEIGHT}
            onResize={setLowerHeight}
            onResizeEnd={(next) => {
              setLowerHeight(next);
              persist({ timelineLowerHeight: next });
            }}
            onReset={fitLower}
            className="vf-timeline-lower-handle"
            title="Drag to resize — double-click to fit"
          />
        )}

        {hasLower && (
          <div
            className={`vf-timeline-lower${lowerCollapsed ? " is-collapsed" : ""}`}
            ref={lowerRef}
            style={lowerCollapsed ? undefined : { height: lowerHeight }}
          >
            <button
              type="button"
              className="vf-timeline-lower-head"
              aria-expanded={!lowerCollapsed}
              onClick={() => {
                const next = !lowerCollapsed;
                setLowerCollapsed(next);
                persist({ timelineLowerCollapsed: next });
              }}
            >
              <ChevronsUpDown size={12} aria-hidden />
              <span>Unscheduled</span>
              <span className="vf-count">{unscheduled.length}</span>
              <span className="vf-timeline-lower-hint">
                drag onto the chart to schedule
              </span>
            </button>

            {!lowerCollapsed && (
              <div className="vf-timeline-lower-body" ref={lowerBodyRef}>
                {unscheduled.map((task) => (
                  <div
                    key={task.path}
                    className={`vf-row vf-timeline-unscheduled-row${
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
        draggedScheduleTask &&
        createPortal(
          <div
            className="vf-drag-layer"
            style={{
              transform: `translate(${
                scheduleDrag.drag.x + PREVIEW_OFFSET_PX
              }px, ${scheduleDrag.drag.y + PREVIEW_OFFSET_PX}px)`,
              width: scheduleDrag.drag.width,
            }}
            aria-hidden
          >
            <div className="vf-row vf-row-preview">
              <TaskRowContent
                task={draggedScheduleTask}
                snapshot={snapshot}
                taxonomies={taxonomies}
                hiddenFields={shownFields}
              />
            </div>
          </div>,
          document.body,
        )}

      {scheduleDrag.drag &&
        createPortal(
          <div
            className="vf-timeline-schedule-ghost"
            style={{
              // Hangs off the top-right of the card preview, like an
              // OS drag badge, so it never covers the row content.
              transform: `translate(${
                scheduleDrag.drag.x +
                PREVIEW_OFFSET_PX +
                scheduleDrag.drag.width -
                8
              }px, ${scheduleDrag.drag.y + PREVIEW_OFFSET_PX - 12}px)`,
            }}
            aria-hidden
          >
            {scheduleGhostDate ?? "Release over the chart"}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* --------------------------------------------------------------- bar ----- */

function BarShape({
  rowKey,
  bar,
  color,
  chartWidth,
  dayOffset,
  scale,
  onBarPointerDown,
}: {
  rowKey: string;
  bar: Bar;
  color: string | null;
  chartWidth: number;
  dayOffset: (iso: string) => number;
  scale: number;
  onBarPointerDown: (
    event: React.PointerEvent,
    rowKey: string,
    bar: Bar,
    zone: BarDragZone,
  ) => void;
}) {
  const down = (zone: BarDragZone) => (event: React.PointerEvent) =>
    onBarPointerDown(event, rowKey, bar, zone);

  if (bar.kind === "unscheduled") return null;

  if (bar.kind === "milestone") {
    return (
      <span
        className="vf-timeline-milestone-wrap"
        style={{ left: dayOffset(bar.date) + scale / 2 }}
        onPointerDown={down("body")}
      >
        <span
          className="vf-timeline-diamond"
          style={color ? { background: color } : undefined}
          aria-hidden
        />
        <span className="vf-timeline-date-label is-solo">{bar.date}</span>
      </span>
    );
  }

  if (bar.kind === "open") {
    const left = dayOffset(bar.start);
    return (
      <div
        className="vf-timeline-bar is-open"
        style={{
          left,
          width: Math.max(scale, chartWidth - left),
          background: color
            ? `linear-gradient(to right, ${color} 0, ${color} 24px, transparent 100%)`
            : undefined,
        }}
        onPointerDown={down("body")}
      >
        <span className="vf-timeline-date-label is-span is-span-open">
          {bar.start} →
        </span>
      </div>
    );
  }

  const left = dayOffset(bar.start);
  // +1 day so a same-day start/end still shows a full day of width.
  const barWidth = Math.max(scale, dayOffset(bar.end) - left + scale);
  return (
    <div
      className="vf-timeline-bar is-range"
      style={{ left, width: barWidth, background: color ?? undefined }}
      onPointerDown={down("body")}
    >
      <span className="vf-timeline-date-label is-span">
        {bar.start} – {bar.end}
      </span>
      <span
        className="vf-timeline-handle is-start"
        onPointerDown={down("start")}
        aria-hidden
      />
      <span
        className="vf-timeline-handle is-end"
        onPointerDown={down("end")}
        aria-hidden
      />
    </div>
  );
}

/* ----------------------------------------------------------- time scale --- */

const MS_PER_DAY = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
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

/** A wide header cell spanning a month (or a year) — always room for its label. */
interface TimeBand {
  key: string;
  left: number;
  width: number;
  label: string;
}

/** A single fixed-width column in the minor band. */
interface TimeTick {
  key: number;
  left: number;
  width: number;
  label: string;
  /** First column of a month/year — a heavier gridline. */
  major: boolean;
}

function startOfMonth(dayNum: number): number {
  const d = new Date(dayNum * MS_PER_DAY);
  return Math.round(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / MS_PER_DAY,
  );
}
function addMonths(dayNum: number, n: number): number {
  const d = new Date(dayNum * MS_PER_DAY);
  return Math.round(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) / MS_PER_DAY,
  );
}
function startOfYear(dayNum: number): number {
  const d = new Date(dayNum * MS_PER_DAY);
  return Math.round(Date.UTC(d.getUTCFullYear(), 0, 1) / MS_PER_DAY);
}
function addYears(dayNum: number, n: number): number {
  const d = new Date(dayNum * MS_PER_DAY);
  return Math.round(Date.UTC(d.getUTCFullYear() + n, 0, 1) / MS_PER_DAY);
}

/**
 * The two-band header: a `bands` row of wide month (or year) cells over a
 * `ticks` row of **equal-width** columns. Splitting the month label out of the
 * per-day columns is what keeps every day column the same size — the old
 * single-band layout squished whichever column carried a month name.
 *
 * Granularity follows the zoom: 1 / 2 / 7-day columns under month bands when
 * zoomed in, month columns under year bands when zoomed out.
 */
function buildTimeScale(
  minDay: number,
  days: number,
  scale: number,
): { bands: TimeBand[]; ticks: TimeTick[] } {
  const maxDay = minDay + days;
  const bands: TimeBand[] = [];
  const ticks: TimeTick[] = [];

  const dayStep = scale >= 20 ? 1 : scale >= 10 ? 2 : scale >= 4 ? 7 : 0;

  if (dayStep > 0) {
    for (let d = minDay; d < maxDay; d += dayStep) {
      const date = new Date(d * MS_PER_DAY);
      const prevMonth = new Date((d - dayStep) * MS_PER_DAY).getUTCMonth();
      ticks.push({
        key: d,
        left: (d - minDay) * scale,
        width: dayStep * scale,
        label: `${date.getUTCDate()}`,
        // Heavier gridline on the column that opens a new month.
        major: date.getUTCMonth() !== prevMonth,
      });
    }
    for (let m = startOfMonth(minDay); m < maxDay; m = addMonths(m, 1)) {
      const next = addMonths(m, 1);
      const from = Math.max(m, minDay);
      const to = Math.min(next, maxDay);
      const date = new Date(m * MS_PER_DAY);
      const wDays = to - from;
      const w = wDays * scale;
      bands.push({
        key: `m${m}`,
        left: (from - minDay) * scale,
        width: w,
        label:
          w > 96
            ? `${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`
            : w > 44
              ? `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
              : MONTHS[date.getUTCMonth()],
      });
    }
  } else {
    for (let m = startOfMonth(minDay); m < maxDay; m = addMonths(m, 1)) {
      const next = addMonths(m, 1);
      const from = Math.max(m, minDay);
      const to = Math.min(next, maxDay);
      const date = new Date(m * MS_PER_DAY);
      const w = (to - from) * scale;
      ticks.push({
        key: m,
        left: (from - minDay) * scale,
        width: w,
        label:
          w > 22 ? MONTHS[date.getUTCMonth()] : MONTHS[date.getUTCMonth()][0],
        major: date.getUTCMonth() === 0,
      });
    }
    for (let y = startOfYear(minDay); y < maxDay; y = addYears(y, 1)) {
      const next = addYears(y, 1);
      const from = Math.max(y, minDay);
      const to = Math.min(next, maxDay);
      bands.push({
        key: `y${y}`,
        left: (from - minDay) * scale,
        width: (to - from) * scale,
        label: `${new Date(y * MS_PER_DAY).getUTCFullYear()}`,
      });
    }
  }

  return { bands, ticks };
}

/* --------------------------------------------------------------- utils --- */

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}

/** Track an element's content width (for the "All" zoom and initial scroll). */
function useElementWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return width;
}
