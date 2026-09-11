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
 * Reading/rendering is still exactly the above. The one thing that writes:
 * drag from a node's small corner handle to another node to draw a new
 * relation (whichever kind the top-left mode selector currently has active),
 * and click an edge then press Delete/Backspace to remove it. Both go through
 * `Mutations.add*`/`remove*Dependency`/`*Related`/`setParent` — cycle checks
 * (`core/hierarchy/cycles.ts`) run against the *whole* workspace before any
 * file is touched, and a hierarchy overwrite confirms first. No group-frame
 * drag-to-reassign yet — that's still future work.
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
import { Notice } from "obsidian";
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
import {
  wouldCreateDependencyCycle,
  wouldCreateHierarchyCycle,
} from "../../core/hierarchy";
import { linksMatch } from "../../core/links";
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
import { usePlugin } from "../context";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { EmptyView } from "../components/EmptyView";
import { Popover } from "../components/Popover";
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
/**
 * Node/layer spacing shared by the root layout pass and every group's own
 * internal one. ELK doesn't inherit a compound node's own `layoutOptions`
 * into its children's nested layered pass — a group node that only sets
 * `elk.algorithm`/`elk.direction`/`elk.padding` runs its internal layout at
 * ELK's (much tighter) library defaults, which is what was collapsing edges
 * between two close-together nodes inside a small group into near-degenerate
 * stubs. Root and every group must set the same values explicitly.
 */
const ELK_SPACING: Record<string, string> = {
  "elk.spacing.nodeNode": "36",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;

/**
 * Human labels — shared by the legend, the relation-visibility toggle, and
 * the drawing-mode selector, so all three always agree. "Parent of", not
 * "Sub-task of": a hierarchy edge is dragged from the parent (matching the
 * rendered line's source→target convention), and "Sub-task of" read as if
 * you'd drag from the child.
 */
export const RELATION_KIND_LABELS: Record<CanvasRelationKind, string> = {
  dependency: "Blocks",
  hierarchy: "Parent of",
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
            ...ELK_SPACING,
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
        ...ELK_SPACING,
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
    // A press on a node, the zoom widget, the draw-mode control, or an edge's
    // click target does its own thing — none of these pan the background.
    // (An edge's hit-path in particular must not be captured here first, or
    // its own onClick — which selects it — never gets a chance to fire.)
    const target = e.target as HTMLElement;
    if (
      target.closest(".vf-canvas-node") ||
      target.closest(".vf-canvas-zoom") ||
      target.closest(".vf-canvas-draw-mode") ||
      target.closest(".vf-canvas-edge-hit")
    ) {
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

  // The slider has no cursor position to anchor to (unlike wheel-zoom or the
  // +/- buttons, which keep a point fixed) — zoom around the viewport's
  // visual centre instead, same as the +/- buttons already do.
  const zoomTo = useCallback((nextScale: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setTransform((t) => {
      const next = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const ratio = next / t.scale;
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

  // Auto-fit once, the first time layout finishes after mount — not on
  // every subsequent re-layout (filter/group/relation-visibility changes
  // also produce a new `laidOut`, and re-fitting then would undo any
  // manual pan/zoom already in place).
  const hasFitOnLoad = useRef(false);
  useEffect(() => {
    if (laidOut && !hasFitOnLoad.current) {
      fitToView();
      hasFitOnLoad.current = true;
    }
  }, [laidOut, fitToView]);

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
  // Suppressed entirely during an active connect-drag — otherwise ordinary
  // hover-dimming keeps applying on top of the drag, dimming exactly the
  // candidate drop targets the drag is asking you to evaluate.
  const isDimmed = (path: string) =>
    !connectDrag &&
    hoveredPath != null &&
    path !== hoveredPath &&
    !connectedToHover?.has(path);
  const isEdgeDimmed = (a: string, b: string) =>
    !connectDrag &&
    hoveredPath != null &&
    a !== hoveredPath &&
    b !== hoveredPath;

  // --- Drawing mode — which relation kind a completed drag creates. ---------
  // Local, ephemeral UI state (like `transform`): it changes what a *future*
  // drag does, it isn't a display preference, so it doesn't belong on
  // `SavedView`. Defaults to "off" — nothing writes unless explicitly opted
  // into, and the drag handle itself doesn't even render while it's off.
  const [drawKind, setDrawKind] = useState<CanvasRelationKind | "off">("off");
  const [drawOpen, setDrawOpen] = useState(false);

  // --- Edge selection + deletion. --------------------------------------------
  type EdgeRef =
    | { kind: "dependency" | "hierarchy"; source: string; target: string }
    | { kind: "related"; a: string; b: string };
  const [selectedEdge, setSelectedEdge] = useState<EdgeRef | null>(null);

  const plugin = usePlugin();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n.task]));

  // A plain function, not a `setState` updater — `setState(fn)` updaters run
  // twice under StrictMode, and these have side effects (file writes), so the
  // write has to happen outside the updater, not inside it.
  const deleteSelectedEdge = () => {
    const edge = selectedEdge;
    if (!edge) return;
    setSelectedEdge(null);
    if (edge.kind === "related") {
      const a = nodeById.get(edge.a);
      const b = nodeById.get(edge.b);
      if (a && b) void plugin.mutations.removeRelated(a, b);
    } else if (edge.kind === "dependency") {
      const blocker = nodeById.get(edge.source);
      const blocked = nodeById.get(edge.target);
      if (blocker && blocked) void plugin.mutations.removeDependency(blocker, blocked);
    } else {
      // hierarchy: source = parent, target = child (see drag direction below).
      const child = nodeById.get(edge.target);
      if (child) void plugin.mutations.setParent(child, null);
    }
  };

  useEffect(() => {
    if (!selectedEdge) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.isContentEditable ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement;
      if (typing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedEdge();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdge, deleteSelectedEdge]);

  // --- Drag-to-connect. -------------------------------------------------------
  // A drag from a node's corner handle to another node draws a new relation of
  // whichever kind `drawKind` currently is. Direction matches the existing
  // edge convention: dependency source→target means "source blocks target";
  // hierarchy source→target means "source is the parent of target" — same
  // orientation `buildCanvasGraph` already uses.
  interface ConnectDrag {
    pointerId: number;
    source: string;
    x: number;
    y: number;
    targetPath: string | null;
    /** Set when dropping on `targetPath` right now would be refused outright. */
    invalid: "self" | "cycle" | null;
  }
  const [connectDrag, setConnectDrag] = useState<ConnectDrag | null>(null);

  const [pendingReparent, setPendingReparent] = useState<{
    child: Task;
    newParent: Task;
  } | null>(null);

  const toSurfacePoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const ox = rect ? clientX - rect.left : clientX;
      const oy = rect ? clientY - rect.top : clientY;
      return {
        x: (ox - transform.x) / transform.scale,
        y: (oy - transform.y) / transform.scale,
      };
    },
    [transform],
  );

  const connectGuard = useCallback(
    (source: string, target: string): ConnectDrag["invalid"] => {
      if (source === target) return "self";
      if (drawKind === "off" || drawKind === "related") return null;
      if (drawKind === "dependency") {
        return wouldCreateDependencyCycle(snapshot.tasks, source, target)
          ? "cycle"
          : null;
      }
      // hierarchy: source would become target's parent.
      return wouldCreateHierarchyCycle(snapshot.tasks, target, source)
        ? "cycle"
        : null;
    },
    [drawKind, snapshot.tasks],
  );

  const startConnect = (
    source: string,
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    // Defense in depth — the handle itself doesn't render while off, so this
    // shouldn't be reachable, but never start a connection with no kind to
    // create.
    if (drawKind === "off") return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toSurfacePoint(e.clientX, e.clientY);
    setConnectDrag({
      pointerId: e.pointerId,
      source,
      x: p.x,
      y: p.y,
      targetPath: null,
      invalid: null,
    });
  };

  const moveConnect = (e: ReactPointerEvent<HTMLDivElement>) => {
    setConnectDrag((cd) => {
      if (!cd || cd.pointerId !== e.pointerId) return cd;
      const p = toSurfacePoint(e.clientX, e.clientY);
      const el = document.elementFromPoint(
        e.clientX,
        e.clientY,
      ) as HTMLElement | null;
      const targetEl = el?.closest(".vf-canvas-node") as HTMLElement | null;
      const targetPath = targetEl?.dataset.taskPath ?? null;
      const invalid = targetPath ? connectGuard(cd.source, targetPath) : null;
      return { ...cd, x: p.x, y: p.y, targetPath, invalid };
    });
  };

  const completeConnect = async (source: string, target: string) => {
    if (drawKind === "off") return; // shouldn't be reachable — see startConnect
    const sourceTask = nodeById.get(source);
    const targetTask = nodeById.get(target);
    if (!sourceTask || !targetTask) return;

    if (drawKind === "dependency") {
      if (wouldCreateDependencyCycle(snapshot.tasks, source, target)) {
        new Notice(
          `Can't link — "${sourceTask.id}" and "${targetTask.id}" would block each other in a cycle.`,
        );
        return;
      }
      await plugin.mutations.addDependency(sourceTask, targetTask);
      return;
    }

    if (drawKind === "related") {
      await plugin.mutations.addRelated(sourceTask, targetTask);
      return;
    }

    // hierarchy: source becomes target's parent.
    if (wouldCreateHierarchyCycle(snapshot.tasks, target, source)) {
      new Notice(
        `Can't move — "${sourceTask.id}" is a descendant of "${targetTask.id}".`,
      );
      return;
    }
    if (targetTask.parent && linksMatch(targetTask.parent, source)) return; // already the parent
    if (targetTask.parent) {
      setPendingReparent({ child: targetTask, newParent: sourceTask });
      return;
    }
    await plugin.mutations.setParent(targetTask, source);
  };

  // A plain function, not a `setState` updater — completing a connection
  // writes a file, and updater functions run twice under StrictMode.
  const endConnect = (e: ReactPointerEvent<HTMLDivElement>) => {
    const cd = connectDrag;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!cd || cd.pointerId !== e.pointerId) return;
    setConnectDrag(null);
    if (cd.targetPath && cd.invalid == null) {
      suppressClick.current = true; // the trailing click lands on the drop target
      void completeConnect(cd.source, cd.targetPath);
    }
  };

  useEffect(() => {
    if (!connectDrag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConnectDrag(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectDrag]);

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
      onClick={() => setSelectedEdge(null)}
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
              {/* Hierarchy edges carry no arrowhead by design, which left no
                  visual way to tell which end is the parent — a small square
                  at the source (parent) end, subtler than the dependency
                  arrowhead so it doesn't compete for attention. */}
              <marker
                id="vf-canvas-parent-marker"
                viewBox="0 0 8 8"
                refX="4"
                refY="4"
                markerWidth="5"
                markerHeight="5"
              >
                <rect
                  className="vf-canvas-parent-marker"
                  x="1"
                  y="1"
                  width="6"
                  height="6"
                />
              </marker>
            </defs>
            {laidOut.edges.map((edge, i) => {
              const selected =
                selectedEdge?.kind === edge.kind &&
                "source" in selectedEdge &&
                selectedEdge.source === edge.source &&
                selectedEdge.target === edge.target;
              return (
                <g key={i}>
                  <path
                    className={`vf-canvas-edge-${edge.kind}${
                      isEdgeDimmed(edge.source, edge.target) ? " is-dimmed" : ""
                    }${selected ? " is-selected" : ""}`}
                    d={edge.d}
                    markerEnd={
                      edge.kind === "dependency"
                        ? "url(#vf-canvas-arrow)"
                        : undefined
                    }
                    markerStart={
                      edge.kind === "hierarchy"
                        ? "url(#vf-canvas-parent-marker)"
                        : undefined
                    }
                  />
                  <path
                    className="vf-canvas-edge-hit"
                    d={edge.d}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedEdge({
                        kind: edge.kind,
                        source: edge.source,
                        target: edge.target,
                      });
                    }}
                  />
                </g>
              );
            })}
            {relatedPaths.map(({ a, b, d }, i) => {
              const selected =
                selectedEdge?.kind === "related" &&
                ((selectedEdge.a === a && selectedEdge.b === b) ||
                  (selectedEdge.a === b && selectedEdge.b === a));
              return (
                <g key={`rel-${i}`}>
                  <path
                    className={`vf-canvas-edge-related${
                      isEdgeDimmed(a, b) ? " is-dimmed" : ""
                    }${selected ? " is-selected" : ""}`}
                    d={d}
                  />
                  <path
                    className="vf-canvas-edge-hit"
                    d={d}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedEdge({ kind: "related", a, b });
                    }}
                  />
                </g>
              );
            })}
            {connectDrag &&
              (() => {
                const src = laidOut.nodes.get(connectDrag.source);
                if (!src) return null;
                const d =
                  `M ${src.x + src.width / 2} ${src.y + src.height / 2} ` +
                  `L ${connectDrag.x} ${connectDrag.y}`;
                return (
                  <path
                    className={`vf-canvas-connect-preview${
                      connectDrag.invalid ? " is-invalid" : ""
                    }`}
                    d={d}
                  />
                );
              })()}
          </svg>

          {[...laidOut.nodes].map(([id, pos]) => {
            const task = nodeById.get(id);
            if (!task) return null;
            const connectTarget: "valid" | "invalid" | null =
              connectDrag?.targetPath === id
                ? connectDrag.invalid
                  ? "invalid"
                  : "valid"
                : null;
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
                connectTarget={connectTarget}
                showHandle={drawKind !== "off"}
                onHandleDown={startConnect}
                onHandleMove={moveConnect}
                onHandleUp={endConnect}
              />
            );
          })}
        </div>
      )}

      <div className="vf-canvas-draw-mode">
        <span className="vf-control-anchor">
          <button
            type="button"
            className={`vf-bar-item${drawKind !== "off" ? " is-on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setDrawOpen((v) => !v);
            }}
          >
            <span className="vf-bar-label">Connect</span>
            <span className="vf-bar-value">
              {drawKind === "off" ? "Off" : RELATION_KIND_LABELS[drawKind]}
            </span>
            <span className="vf-bar-caret" aria-hidden>
              ⌄
            </span>
          </button>
          {drawOpen && (
            <Popover align="left" onClose={() => setDrawOpen(false)}>
              <div className="vf-field-list">
                {(["off", ...CANVAS_RELATION_KINDS] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`vf-field-row${drawKind === kind ? " is-on" : ""}`}
                    onClick={() => {
                      setDrawKind(kind);
                      setDrawOpen(false);
                    }}
                  >
                    <span className="vf-field-label">
                      {kind === "off"
                        ? "Off — click around safely"
                        : RELATION_KIND_LABELS[kind]}
                    </span>
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </span>
      </div>

      <div className="vf-canvas-zoom">
        <button
          type="button"
          className="vf-canvas-zoom-btn"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.1)}
        >
          −
        </button>
        <input
          type="range"
          className="vf-canvas-zoom-slider"
          aria-label="Zoom level"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.01}
          value={transform.scale}
          onChange={(e) => zoomTo(Number(e.target.value))}
        />
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

      {pendingReparent &&
        (() => {
          const oldParent = pendingReparent.child.parent
            ? snapshot.tasks.find((t) =>
                linksMatch(t.path, pendingReparent.child.parent),
              )
            : null;
          return (
            <ConfirmDeleteDialog
              title={`Move "${displayTitle(pendingReparent.child)}" from under "${
                oldParent ? oldParent.id : "its current parent"
              }" to under "${pendingReparent.newParent.id}"?`}
              body="This replaces its existing parent — a task can't have two."
              confirmLabel="Move"
              destructive={false}
              onCancel={() => setPendingReparent(null)}
              onConfirm={() => {
                const { child, newParent } = pendingReparent;
                setPendingReparent(null);
                void plugin.mutations.setParent(child, newParent.path);
              }}
            />
          );
        })()}
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
  connectTarget,
  showHandle,
  onHandleDown,
  onHandleMove,
  onHandleUp,
}: {
  task: Task;
  pos: PlacedBox;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  hiddenFields: readonly TaskField[];
  showProject: boolean;
  dimmed: boolean;
  onHover: (path: string | null) => void;
  /** True when the click that follows was really the end of a pan/connect gesture. */
  consumePanClick: () => boolean;
  /** Set while a connect-drag is hovering this node as a potential drop target. */
  connectTarget: "valid" | "invalid" | null;
  /** False while the draw mode is "off" — the handle isn't just inert, it isn't rendered. */
  showHandle: boolean;
  onHandleDown: (source: string, e: ReactPointerEvent<HTMLDivElement>) => void;
  onHandleMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onHandleUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const off = (field: TaskField) => hiddenFields.includes(field);
  // Same mechanism Board's own cards open a task with — no Canvas-only path.
  const tabs = useTabs();
  return (
    <div
      className={[
        "vf-canvas-node",
        dimmed && "is-dimmed",
        connectTarget === "valid" && "is-connect-target",
        connectTarget === "invalid" && "is-connect-invalid",
      ]
        .filter(Boolean)
        .join(" ")}
      data-task-path={task.path}
      style={{ left: pos.x, top: pos.y, width: pos.width, height: pos.height }}
      onPointerEnter={() => onHover(task.path)}
      onPointerLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (consumePanClick()) return;
        tabs.openTask(task.path);
      }}
    >
      {/* Drag from here to draw a new relation — the click-to-open target is
          the card body, so the handle sits apart from it in a corner. Not
          rendered at all while "Connect" is off — a visibly-absent handle
          reads as "nothing here creates a connection" more clearly than one
          that's merely inert. */}
      {showHandle && (
        <div
          className="vf-canvas-node-handle"
          title="Drag to another card to link them"
          onPointerDown={(e) => onHandleDown(task.path, e)}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onClick={(e) => e.stopPropagation()}
        />
      )}
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
