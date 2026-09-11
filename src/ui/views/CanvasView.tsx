/**
 * Canvas view — read-only relationship graph.
 *
 * Renders the current view's filtered tasks as an `elkjs` layered graph:
 *   - grouping — when `view.groupBy` is a single-valued field (status, priority,
 *     taskType, assignee, project), each non-hidden `TaskGroup` from
 *     `evaluated.groups` becomes a real ELK compound box (the same groups the
 *     Board renders as columns, so "No Project"/"No Status", hidden-group
 *     filtering and per-group colour all come for free). `label` and `none`
 *     render flat;
 *   - layered edges — `blocks`/`blockedBy` dependencies (solid, arrowed) and
 *     `parent` → child hierarchy (thin, arrowless) both feed ELK's ranking and
 *     may cross group boxes;
 *   - `related` links — dashed, arrowless, drawn straight between final node
 *     centres, never fed into the layout.
 *
 * Strictly read-only: pan and zoom only, nothing is written to any file. Node
 * dragging, drag-to-reparent and topology picking are later phases.
 *
 * The pure edge-building lives in `core/canvas/graph.ts` (Obsidian-free,
 * unit-tested); grouping and layout are this component's job.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import {
  buildCanvasGraph,
  canvasGrouping,
  filterCanvasGraph,
  type CanvasGraph,
} from "../../core/canvas/graph";
import {
  DEFAULT_GROUP_PADDING,
  elkPaddingOption,
  flattenCanvasLayout,
  type EdgeMeta,
  type FlatCanvasLayout,
  type PlacedBox,
} from "../../core/canvas/layout";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { layoutIcon, renderedHiddenFields } from "../../core/views";
import {
  CANVAS_RELATION_KINDS,
  type CanvasRelationKind,
  type SavedView,
  type Task,
  type TaskField,
  type WorkspaceSnapshot,
} from "../../core/types";
import { EmptyView } from "../components/EmptyView";
import {
  Assignee,
  DueDate,
  ProjectChip,
  StatusDot,
  TaxonomyChip,
} from "../components/TaskBits";
import { displayTitle } from "../components/TaskTitle";
import { useTabs } from "../tabs-context";

export interface CanvasViewProps {
  snapshot: WorkspaceSnapshot;
  view: SavedView;
  evaluated: EvaluatedView;
  taxonomies: WorkspaceTaxonomies;
}

/**
 * Fixed card box — also the leaf-node size fed to `elkjs`. Sized for the
 * fullest card: a two-badge top row, a due-date + assignee row, an optional
 * project chip, and a 2-line title, within 8px vertical padding and 4px gaps,
 * with headroom for the "comfortable" UI text scale.
 */
const NODE_WIDTH = 240;
const NODE_HEIGHT = 136;
/** `elk.padding` inside a group box, kept in sync with the render-side fit. */
const GROUP_PADDING = elkPaddingOption(DEFAULT_GROUP_PADDING);

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;

/** Human labels for the relation-kind visibility toggle. */
const RELATION_KIND_LABELS: Record<CanvasRelationKind, string> = {
  dependency: "Blocks",
  hierarchy: "Sub-task of",
  related: "Related",
};

const elk = new ELK();

export function CanvasView({
  snapshot,
  view,
  evaluated,
  taxonomies,
}: CanvasViewProps) {
  // Grouping by project already puts each card inside its project's box, so a
  // per-card project chip there would just be noise.
  const showProject = view.groupBy !== "project";
  // Reuse the Board's own group set — non-hidden, non-empty — for the boxes,
  // and the matching visible-task set. Flat when grouped by `label`/`none`.
  const {
    grouped,
    boxes: visibleGroups,
    tasks: visibleTasks,
  } = useMemo(
    () => canvasGrouping(evaluated.groups, evaluated.tasks, view.groupBy),
    [evaluated.groups, evaluated.tasks, view.groupBy],
  );

  const shownFields = useMemo(() => renderedHiddenFields(view), [view]);

  // Stable key for the hidden-relation set — the array identity churns.
  const hiddenKinds = view.canvasHiddenRelationKinds ?? [];
  const hiddenKindKey = [...hiddenKinds].sort().join(",");
  const hiddenKindSet = useMemo(
    () => new Set(hiddenKinds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hiddenKindKey],
  );

  // Memoise on the *content* that feeds the graph — visible task paths, their
  // parent, their three relation arrays, and the box each sits in — not on
  // `evaluated` identity, which changes reference on unrelated re-renders.
  const signature = useMemo(() => {
    const boxOf = new Map<string, string>();
    for (const g of visibleGroups) {
      for (const t of g.tasks) boxOf.set(t.path, g.key);
    }
    return visibleTasks
      .map(
        (t) =>
          `${t.path}@${boxOf.get(t.path) ?? ""}|${t.parent ?? ""}|` +
          `${t.relations.blocks.join(",")}|${t.relations.blockedBy.join(",")}|` +
          `${t.relations.related.join(",")}`,
      )
      .join(";");
  }, [visibleTasks, visibleGroups]);

  const graph: CanvasGraph = useMemo(
    () => filterCanvasGraph(buildCanvasGraph(visibleTasks), [...hiddenKindSet]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, hiddenKindKey],
  );

  const direction = view.canvasDirection === "TB" ? "DOWN" : "RIGHT";

  const [laidOut, setLaidOut] = useState<FlatCanvasLayout | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visibleTasks.length === 0) return;
    let cancelled = false;
    setLoading(true);

    const leaf = (id: string) => ({
      id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
    const children: ElkNode[] = grouped
      ? visibleGroups.map((g) => ({
          id: `group:${g.key}`,
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": direction,
            "elk.padding": GROUP_PADDING,
          },
          children: g.tasks.map((t) => leaf(t.path)),
        }))
      : graph.nodes.map((n) => leaf(n.id));

    // `edge-${i}` carries the kind + endpoints back by index after layout.
    const edgeMeta = new Map<string, EdgeMeta>();
    const edges = graph.layeringEdges.map((e, i) => {
      const id = `edge-${i}`;
      edgeMeta.set(id, { kind: e.kind, source: e.source, target: e.target });
      return { id, sources: [e.source], targets: [e.target] };
    });

    const elkGraph: ElkNode = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": direction,
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.spacing.nodeNode": "36",
        "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      },
      children,
      edges,
    };

    elk
      .layout(elkGraph)
      .then((res) => {
        if (cancelled) return;
        setLaidOut(
          flattenCanvasLayout(res, edgeMeta, {
            nodeWidth: NODE_WIDTH,
            nodeHeight: NODE_HEIGHT,
          }),
        );
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLaidOut(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [graph, grouped, visibleGroups, visibleTasks.length, direction]);

  // --- Pan / zoom — transient component state, never persisted. -------------
  const canvasRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 24, y: 24, scale: 1 });
  const panState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  // Set once a background-started pan actually moves — consumed by the click
  // that follows pointerup, so releasing a drag over a card doesn't also open
  // it. Mirrors Board's own drag `consumeDragClick()` pattern.
  const panMoved = useRef(false);
  const suppressClick = useRef(false);
  const PAN_CLICK_THRESHOLD = 4;

  const consumePanClick = () => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A press on a node or on the zoom widget does its own thing — neither
    // pans the background.
    const target = e.target as HTMLElement;
    if (target.closest(".vf-canvas-node") || target.closest(".vf-canvas-zoom")) {
      return;
    }
    panMoved.current = false;
    panState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panState.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    if (!panMoved.current && Math.hypot(dx, dy) > PAN_CLICK_THRESHOLD) {
      panMoved.current = true;
    }
    setTransform((t) => ({
      ...t,
      x: pan.originX + dx,
      y: pan.originY + dy,
    }));
  };

  const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panState.current?.pointerId === e.pointerId) {
      // A pan that actually moved emits a trailing click on whatever's under
      // the cursor at release — swallow it so panning over a card doesn't
      // also open it (same ordering as the drag code's own suppress-flag).
      if (panMoved.current) suppressClick.current = true;
      panState.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const zoomBy = useCallback((factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setTransform((t) => {
      const next = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = next / t.scale;
      // Keep the container's centre fixed, same math as the wheel handler.
      return {
        scale: next,
        x: cx - (cx - t.x) * ratio,
        y: cy - (cy - t.y) * ratio,
      };
    });
  }, []);

  const fitToView = useCallback(() => {
    if (!laidOut) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const margin = 48;
    const next = clamp(
      Math.min(
        (rect.width - margin) / laidOut.width,
        (rect.height - margin) / laidOut.height,
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
    setTransform({
      scale: next,
      x: (rect.width - laidOut.width * next) / 2,
      y: (rect.height - laidOut.height * next) / 2,
    });
  }, [laidOut]);

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    setTransform((t) => {
      const next = clamp(
        t.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1),
        MIN_SCALE,
        MAX_SCALE,
      );
      const ratio = next / t.scale;
      // Keep the point under the cursor fixed while zooming.
      return {
        scale: next,
        x: px - (px - t.x) * ratio,
        y: py - (py - t.y) * ratio,
      };
    });
  };

  // --- Hover highlight — pure CSS-class state, no re-layout. -----------------
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  // Every path directly connected to another, across all three relation kinds
  // (both layering edges — dependency + hierarchy — and related). Built from
  // `graph`, not `laidOut`, so it's unaffected by pan/zoom/hover and never
  // touches the ELK effect's own dependency array.
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    };
    for (const e of graph.layeringEdges) link(e.source, e.target);
    for (const e of graph.relatedEdges) link(e.a, e.b);
    return map;
  }, [graph]);

  const connectedToHover = hoveredPath ? adjacency.get(hoveredPath) : undefined;
  const isDimmed = (path: string) =>
    hoveredPath != null &&
    path !== hoveredPath &&
    !connectedToHover?.has(path);
  const isEdgeDimmed = (a: string, b: string) =>
    hoveredPath != null && a !== hoveredPath && b !== hoveredPath;

  if (evaluated.total === 0 || visibleTasks.length === 0) {
    const filtered = evaluated.filteredOut > 0 || evaluated.total > 0;
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
      />
    );
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n.task]));
  const groupByKey = new Map(visibleGroups.map((g) => [`group:${g.key}`, g]));

  const relatedPaths = laidOut
    ? graph.relatedEdges
        .map(({ a, b }) => {
          const na = laidOut.nodes.get(a);
          const nb = laidOut.nodes.get(b);
          if (!na || !nb) return null;
          return {
            a,
            b,
            d:
              `M ${na.x + na.width / 2} ${na.y + na.height / 2} ` +
              `L ${nb.x + nb.width / 2} ${nb.y + nb.height / 2}`,
          };
        })
        .filter((e): e is { a: string; b: string; d: string } => e !== null)
    : [];

  return (
    <div
      ref={canvasRef}
      className="vf-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onWheel={onWheel}
    >
      {view.groupBy === "label" && (
        <div className="vf-canvas-note">
          Label grouping isn't shown as boxes here — a task can carry several
          labels at once.
        </div>
      )}

      {loading && !laidOut && (
        <div className="vf-canvas-loading">Laying out graph…</div>
      )}

      {laidOut && (
        <div
          className="vf-canvas-surface"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {[...laidOut.groups].map(([id, box]) => {
            const group = groupByKey.get(id);
            return (
              <div
                key={id}
                className="vf-canvas-group"
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.width,
                  height: box.height,
                }}
              >
                <div className="vf-canvas-group-header">
                  {group?.color && (
                    <span
                      className="vf-status-dot"
                      style={{ backgroundColor: group.color }}
                    />
                  )}
                  <span className="vf-canvas-group-title">
                    {group?.label ?? "Group"}
                  </span>
                </div>
              </div>
            );
          })}

          <svg
            className="vf-canvas-edges"
            width={laidOut.width}
            height={laidOut.height}
            viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
            aria-hidden
          >
            <defs>
              <marker
                id="vf-canvas-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path
                  className="vf-canvas-arrow-head"
                  d="M 0 0 L 10 5 L 0 10 z"
                />
              </marker>
            </defs>
            {laidOut.edges.map((edge, i) => (
              <path
                key={i}
                className={`vf-canvas-edge-${edge.kind}${
                  isEdgeDimmed(edge.source, edge.target) ? " is-dimmed" : ""
                }`}
                d={edge.d}
                markerEnd={
                  edge.kind === "dependency"
                    ? "url(#vf-canvas-arrow)"
                    : undefined
                }
              />
            ))}
            {relatedPaths.map(({ a, b, d }, i) => (
              <path
                key={`rel-${i}`}
                className={`vf-canvas-edge-related${
                  isEdgeDimmed(a, b) ? " is-dimmed" : ""
                }`}
                d={d}
              />
            ))}
          </svg>

          {[...laidOut.nodes].map(([id, pos]) => {
            const task = nodeById.get(id);
            if (!task) return null;
            return (
              <CanvasNode
                key={id}
                task={task}
                pos={pos}
                snapshot={snapshot}
                taxonomies={taxonomies}
                hiddenFields={shownFields}
                showProject={showProject}
                dimmed={isDimmed(id)}
                onHover={setHoveredPath}
                consumePanClick={consumePanClick}
              />
            );
          })}
        </div>
      )}

      <div className="vf-canvas-zoom">
        <button
          type="button"
          className="vf-canvas-zoom-btn"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.1)}
        >
          −
        </button>
        <span className="vf-canvas-zoom-pct">
          {Math.round(transform.scale * 100)}%
        </span>
        <button
          type="button"
          className="vf-canvas-zoom-btn"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.1)}
        >
          +
        </button>
        <button
          type="button"
          className="vf-canvas-zoom-btn vf-canvas-zoom-fit"
          aria-label="Fit to view"
          title="Fit to view"
          disabled={!laidOut}
          onClick={fitToView}
        >
          Fit
        </button>
      </div>

      <CanvasLegend hidden={hiddenKindSet} />
    </div>
  );
}

/**
 * A Canvas card. Deliberately compact: Status, ID, Type, Priority, Due date,
 * Assignee, and — outside project-grouped mode — Project. That is the whole
 * list on purpose.
 *
 * `labels`, `estimate`, `startDate`, `progress` and `relations` are NOT
 * rendered here and should stay that way: a graph node reads only while it
 * carries a handful of fields, and the edges already carry the relations. This
 * is curated scope, not an unfinished list — don't "complete" it.
 */
function CanvasNode({
  task,
  pos,
  snapshot,
  taxonomies,
  hiddenFields,
  showProject,
  dimmed,
  onHover,
  consumePanClick,
}: {
  task: Task;
  pos: PlacedBox;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  hiddenFields: readonly TaskField[];
  showProject: boolean;
  dimmed: boolean;
  onHover: (path: string | null) => void;
  /** True when the click that follows was really the end of a pan gesture. */
  consumePanClick: () => boolean;
}) {
  const off = (field: TaskField) => hiddenFields.includes(field);
  // Same mechanism Board's own cards open a task with — no Canvas-only path.
  const tabs = useTabs();
  return (
    <div
      className={`vf-canvas-node${dimmed ? " is-dimmed" : ""}`}
      style={{ left: pos.x, top: pos.y, width: pos.width, height: pos.height }}
      onPointerEnter={() => onHover(task.path)}
      onPointerLeave={() => onHover(null)}
      onClick={() => {
        if (consumePanClick()) return;
        tabs.openTask(task.path);
      }}
    >
      <div className="vf-canvas-node-row">
        <StatusDot taxonomies={taxonomies} status={task.status} />
        <span className="vf-id">{task.id}</span>
        {!off("type") && (
          <TaxonomyChip
            taxonomies={taxonomies}
            kind="taskType"
            id={task.taskType}
          />
        )}
        {!off("priority") && (
          <TaxonomyChip
            taxonomies={taxonomies}
            kind="priority"
            id={task.priority}
          />
        )}
      </div>
      <div className="vf-canvas-node-row">
        {!off("dueDate") && <DueDate task={task} />}
        {!off("assignee") && (
          <Assignee
            people={snapshot.workspace.people}
            assignee={task.assignee}
          />
        )}
      </div>
      {showProject && !off("project") && (
        <ProjectChip task={task} projects={snapshot.projects} />
      )}
      <div className="vf-canvas-node-title" title={displayTitle(task)}>
        {displayTitle(task)}
      </div>
    </div>
  );
}

function CanvasLegend({ hidden }: { hidden: Set<CanvasRelationKind> }) {
  return (
    <div className="vf-canvas-legend" aria-hidden>
      {CANVAS_RELATION_KINDS.map((kind) => (
        <div
          key={kind}
          className={`vf-canvas-legend-row${hidden.has(kind) ? " is-hidden" : ""}`}
        >
          <svg width="26" height="10" viewBox="0 0 26 10">
            <path
              className={`vf-canvas-edge-${kind}`}
              d={kind === "dependency" ? "M 1 5 L 19 5" : "M 1 5 L 25 5"}
            />
            {kind === "dependency" && (
              <path
                className="vf-canvas-arrow-head"
                d="M 19 2 L 25 5 L 19 8 z"
              />
            )}
          </svg>
          <span>{RELATION_KIND_LABELS[kind]}</span>
        </div>
      ))}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
