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
 *   - two arrangements, chosen per view (`view.canvasArrangement`), each in
 *     either direction (`view.canvasDirection`, left-to-right or top-to-bottom):
 *       `flow` — every layering edge (`blocks`/`blockedBy` solid + arrowed,
 *       `parent` → child thin + arrowless) feeds ELK's ranking and may cross
 *       group boxes;
 *       `tree` — only `parent` → child edges feed ELK (an `mrtree` pass);
 *       `blocks`/`blockedBy` edges are drawn edge-to-edge after layout,
 *       overlay-style (snapped to each card's boundary, arrowhead inset clear
 *       of the target), like `related` (which is always an overlay, straight
 *       centre-to-centre).
 *       With no visible hierarchy edge the pass silently falls back to `flow`;
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
  canvasEdgePlan,
  canvasGrouping,
  canvasLayoutSignature,
  canvasTopologyKey,
  filterCanvasGraph,
  getCanvasElkOptions,
  partitionByConnectivity,
  type CanvasGraph,
  type CanvasNode as CanvasGraphNode,
} from "../../core/canvas/graph";
import {
  DEFAULT_GROUP_PADDING,
  ISOLATED_GRID_GAP,
  canvasEdgeLinePath,
  createLayoutGuard,
  elkPaddingOption,
  flattenCanvasLayout,
  mergeIsolatedIntoLayout,
  packCanvasGrid,
  planIsolatedGrid,
  resolveIsolatedGrids,
  type EdgeMeta,
  type FlatCanvasLayout,
  type IsolatedGridBox,
  type IsolatedGridPlan,
  type PlacedBox,
} from "../../core/canvas/layout";
import {
  wouldCreateDependencyCycle,
  wouldCreateHierarchyCycle,
} from "../../core/hierarchy";
import { linksMatch } from "../../core/links";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { layoutIcon } from "../../core/views";
import {
  CANVAS_RELATION_KINDS,
  type CanvasArrangement,
  type CanvasDirection,
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
import { layoutHiddenFields } from "./viewOptions";

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
const NODE_HEIGHT = 100;
/**
 * A title needing more than 2 lines grows the card past `NODE_HEIGHT` by this
 * many extra pixels per extra line — a title beyond `MAX_TITLE_LINES` still
 * clips (with the card's native `title=` tooltip as the escape hatch), so the
 * card never grows unboundedly. `resolveTitleMetrics` measures the real
 * computed line-height each layout pass; this is only the fallback for when
 * that measurement can't be read.
 */
const TITLE_LINE_HEIGHT_FALLBACK_PX = 17;
/** Matches `.vf-canvas-node-title`'s `-webkit-line-clamp`. */
const MAX_TITLE_LINES = 6;
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

/* --------------------------------------------- title-height estimation --- */

let titleMeasureCanvas: HTMLCanvasElement | null = null;

/**
 * Greedy word-wrap simulation over `Canvas2D.measureText` — an estimate of how
 * many lines `title` would wrap to at `maxWidthPx`, not a real render. Pure
 * aside from the DOM canvas it measures against, so it never needs `font`
 * re-resolved per call — the caller resolves that once per layout pass (see
 * `resolveTitleMetrics`) and reuses it across every task being measured.
 */
function estimateTitleLines(
  title: string,
  maxWidthPx: number,
  font: string,
): number {
  titleMeasureCanvas ??= document.createElement("canvas");
  const ctx = titleMeasureCanvas.getContext("2d");
  if (!ctx) return 1;
  ctx.font = font;

  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  let lines = 1;
  let lineWidth = 0;
  const spaceWidth = ctx.measureText(" ").width;
  for (const word of words) {
    const wordWidth = ctx.measureText(word).width;
    const nextWidth =
      lineWidth === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
    if (nextWidth > maxWidthPx && lineWidth > 0) {
      lines += 1;
      lineWidth = wordWidth;
    } else {
      lineWidth = nextWidth;
    }
  }
  return lines;
}

/**
 * `ctx.font` needs a fully resolved shorthand ("13px Inter"), not a CSS
 * custom property string — `measureText` can't resolve `var(--font-ui-small)`
 * itself. Reads it (and the title's real computed line-height, so the
 * per-line height budget tracks the active theme/text-scale rather than a
 * hardcoded guess) off a throwaway, off-screen `.vf-canvas-node-title`, once
 * per layout pass.
 */
function resolveTitleMetrics(): { font: string; lineHeightPx: number } {
	const probe = document.createElement("span");
	probe.className = "vf-canvas-metrics-probe vf-canvas-node-title";
	document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const font = style.font;
  const lineHeightPx =
    parseFloat(style.lineHeight) || TITLE_LINE_HEIGHT_FALLBACK_PX;
  document.body.removeChild(probe);
  return { font, lineHeightPx };
}

/**
 * The card's actual inner content width available to the title — `NODE_WIDTH`
 * minus `.vf-canvas-node`'s real horizontal padding, read live rather than
 * re-guessed (it's shifted across earlier Canvas phases already).
 */
function resolveTitleMaxWidth(): number {
	const probe = document.createElement("div");
	probe.className = "vf-canvas-metrics-probe vf-canvas-node";
	probe.style.width = `${NODE_WIDTH}px`;
	document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const horizontalPadding =
    (parseFloat(style.paddingLeft) || 0) +
    (parseFloat(style.paddingRight) || 0);
  document.body.removeChild(probe);
  return NODE_WIDTH - horizontalPadding;
}

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

  const shownFields = useMemo(() => layoutHiddenFields(view), [view]);

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
  // Both this and `graph` therefore survive a title/status edit untouched.
  const topologyKey = useMemo(
    () => canvasTopologyKey(visibleTasks, visibleGroups),
    [visibleTasks, visibleGroups],
  );

  const graph: CanvasGraph = useMemo(
    () => filterCanvasGraph(buildCanvasGraph(visibleTasks), [...hiddenKindSet]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topologyKey, hiddenKindKey],
  );

  const arrangement: CanvasArrangement = view.canvasArrangement ?? "flow";
  const direction: CanvasDirection = view.canvasDirection ?? "right";

  // The full layout signature — the topology above plus the view's canvas
  // arrangement and direction. Toggling either in the toolbar flips it and
  // requests a fresh ELK pass; a card edit repaints in place and moves nothing.
  const layoutKey = useMemo(
    () =>
      canvasLayoutSignature(visibleTasks, visibleGroups, {
        grouped,
        arrangement,
        direction,
      }),
    [visibleTasks, visibleGroups, grouped, arrangement, direction],
  );

  // Tree arrangement ranks parent→child edges only, so those are the layout
  // input and `blocks`/`blockedBy` edges become post-layout overlays. With no
  // visible hierarchy edge there's nothing to rank — fall back to the flow
  // pass (without touching the saved setting) and say so.
  const plan = useMemo(
    () => canvasEdgePlan(graph, arrangement),
    [graph, arrangement],
  );
  const effectiveArrangement: CanvasArrangement =
    arrangement === "tree" && plan.layoutEdges.length === 0
      ? "flow"
      : arrangement;
  const treeHasHierarchy = plan.layoutEdges.length > 0;

  const [laidOut, setLaidOut] = useState<FlatCanvasLayout | null>(null);
  const [loading, setLoading] = useState(false);
  const layoutGuard = useRef(createLayoutGuard()).current;

  useEffect(() => {
    if (visibleTasks.length === 0) return;
    let cancelled = false;
    const requestId = layoutGuard.begin();
    setLoading(true);

    const elkOptions = getCanvasElkOptions(effectiveArrangement, direction);

    // Resolved once per layout pass (not per task, not per render) — the same
    // triggers that already rebuild `children`/`elkGraph` below.
    const titleMetrics = resolveTitleMetrics();
    const titleMaxWidth = resolveTitleMaxWidth();

    const leaf = (task: Task) => {
      const lines = Math.min(
        estimateTitleLines(
          displayTitle(task),
          titleMaxWidth,
          titleMetrics.font,
        ),
        MAX_TITLE_LINES,
      );
      // The base NODE_HEIGHT budget already covers a 2-line title.
      const extraLines = Math.max(0, lines - 2);
      return {
        id: task.path,
        width: NODE_WIDTH,
        height: NODE_HEIGHT + extraLines * titleMetrics.lineHeightPx,
      };
    };

    // Partition each scope's own node set against the *same* global
    // `plan.layoutEdges` — a task's connectivity is global (an edge to a task
    // in a different group still counts as connected), only which node set
    // gets tested changes per scope. Keyed by the scope's own ELK id so the
    // grid-pack pass below can look each one back up after layout resolves.
    const partitions = new Map<
      string,
      { connected: CanvasGraphNode[]; isolated: CanvasGraphNode[] }
    >(
      grouped
        ? visibleGroups.map((g) => [
            `group:${g.key}`,
            partitionByConnectivity(
              g.tasks.map((t) => ({ id: t.path, task: t })),
              plan.layoutEdges,
            ),
          ])
        : [["root", partitionByConnectivity(graph.nodes, plan.layoutEdges)]],
    );

    // Reserve each group's isolated grid *inside* ELK via a placeholder leaf
    // in the compound: ELK sizes the box around it and, critically, spaces
    // sibling groups clear of it. Without that reservation a grid appended
    // after layout anchored to the connected-block bbox (or, for a group with
    // no connected members at all, an empty 0×0 compound) and landed on top
    // of whichever sibling group ELK had placed just past it — the
    // grouped-layout regression. Columns come from the rendered viewport
    // width, keeping grid density consistent with the flat root's.
    const gridPlans = new Map<string, IsolatedGridPlan>();
    if (grouped) {
      for (const g of visibleGroups) {
        const scopeId = `group:${g.key}`;
        const isolated = partitions.get(scopeId)?.isolated ?? [];
        if (isolated.length === 0) continue;
        const sizeById = new Map(isolated.map((n) => [n.id, leaf(n.task)]));
        const columns = Math.max(
          1,
          Math.min(
            isolated.length,
            Math.floor(
              ((canvasRef.current?.getBoundingClientRect().width ||
                NODE_WIDTH) +
                ISOLATED_GRID_GAP) /
                (NODE_WIDTH + ISOLATED_GRID_GAP),
            ),
          ),
        );
        gridPlans.set(
          scopeId,
          planIsolatedGrid(
            scopeId,
            isolated,
            sizeById,
            NODE_WIDTH,
            ISOLATED_GRID_GAP,
            columns,
          ),
        );
      }
    }

    // ELK only ever sees each scope's `connected` members (plus, when a group
    // has any, its isolated grid's placeholder leaf) — the `isolated` cards
    // themselves are grid-packed separately once layout resolves (below).
    const children: ElkNode[] = grouped
      ? visibleGroups.map((g) => {
          const scopeId = `group:${g.key}`;
          const plan = gridPlans.get(scopeId);
          return {
            id: scopeId,
            layoutOptions: {
              ...elkOptions,
              "elk.padding": GROUP_PADDING,
              ...ELK_SPACING,
            },
            children: [
              ...(partitions.get(scopeId)?.connected ?? []).map((n) =>
                leaf(n.task),
              ),
              ...(plan
                ? [
                    {
                      id: plan.placeholderId,
                      width: plan.placeholder.width,
                      height: plan.placeholder.height,
                    },
                  ]
                : []),
            ],
          };
        })
      : partitions.get("root")!.connected.map((n) => leaf(n.task));

    // `edge-${i}` carries the kind + endpoints back by index after layout. In
    // tree mode this is just the parent→child edges (`plan.layoutEdges`);
    // dependencies are drawn as overlays post-layout instead.
    const edgeMeta = new Map<string, EdgeMeta>();
    const edges = plan.layoutEdges.map((e, i) => {
      const id = `edge-${i}`;
      edgeMeta.set(id, { kind: e.kind, source: e.source, target: e.target });
      return { id, sources: [e.source], targets: [e.target] };
    });

    const elkGraph: ElkNode = {
      id: "root",
      layoutOptions: {
        ...elkOptions,
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        ...ELK_SPACING,
      },
      children,
      edges,
    };

    // ELK resolves asynchronously and out of order; a slow pass for an older
    // signature must never overwrite a fast pass for the newest one. The guard
    // is monotonically increasing, so only the latest `begin()` may commit —
    // the `cancelled` flag covers trouble after unmount.
    elk
      .layout(elkGraph)
      .then((res) => {
        if (cancelled || !layoutGuard.isCurrent(requestId)) return;
        const base = flattenCanvasLayout(res, edgeMeta, {
          nodeWidth: NODE_WIDTH,
          nodeHeight: NODE_HEIGHT,
        });

        if (grouped) {
          // The placeholder leaves already reserved each grid's space inside
          // ELK (and spaced sibling groups clear of it) — just swap the
          // rects in.
          setLaidOut(resolveIsolatedGrids(base, [...gridPlans.values()]));
        } else {
          // Flat root: append the isolated grid below (direction "right") or
          // beside (direction "down") the connected block — the design's own
          // placement, and safe since the root has no sibling to collide
          // with. Columns come from the rendered viewport width.
          const isolated = partitions.get("root")!.isolated;
          const columns = Math.max(
            1,
            Math.floor(
              ((canvasRef.current?.getBoundingClientRect().width ||
                NODE_WIDTH) +
                ISOLATED_GRID_GAP) /
                (NODE_WIDTH + ISOLATED_GRID_GAP),
            ),
          );
          const sizeById = new Map(isolated.map((n) => [n.id, leaf(n.task)]));
          // Rows must clear the tallest card in this scope's grid, or two
          // consecutive rows of variable-height (Phase 11 title-wrapped)
          // cards could overlap.
          const cellHeight = Math.max(
            NODE_HEIGHT,
            ...[...sizeById.values()].map((s) => s.height),
          );
          const positions = packCanvasGrid(
            isolated,
            NODE_WIDTH,
            cellHeight,
            ISOLATED_GRID_GAP,
            columns,
          );
          const boxes: IsolatedGridBox[] = positions.map((p) => {
            const size = sizeById.get(p.id)!;
            return { ...size, x: p.x, y: p.y };
          });
          setLaidOut(
            mergeIsolatedIntoLayout(
              base,
              new Map([["root", boxes]]),
              direction,
            ),
          );
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || !layoutGuard.isCurrent(requestId)) return;
        setLaidOut(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    layoutKey,
    graph,
    plan,
    effectiveArrangement,
    direction,
    grouped,
    visibleTasks.length,
    layoutGuard,
  ]);

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

  // Up to two simultaneous background pointers, tracked by id, alongside the
  // single-pointer `panState` above — a third finger is simply ignored (no
  // rotation, no three-finger gestures). `pinchState` is non-null exactly
  // while both are down.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{
    initialDistance: number;
    initialScale: number;
  } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A press on a node, the zoom widget, the draw-mode control, or an edge's
    // click target does its own thing — none of these pan the background.
    // (An edge's hit-path in particular must not be captured here first, or
    // its own onClick — which selects it — never gets a chance to fire.)
    // This also means a two-finger gesture that happens to start on a node's
    // own drag handle never reaches pinch tracking below — the handle's own
    // `startConnect` owns that pointer instead.
    const target = e.target as HTMLElement;
    if (
      target.closest(".vf-canvas-node") ||
      target.closest(".vf-canvas-zoom") ||
      target.closest(".vf-canvas-draw-mode") ||
      target.closest(".vf-canvas-edge-hit") ||
      target.closest(".vf-canvas-edge-popup") ||
      target.closest(".vf-canvas-tap-connect")
    ) {
      return;
    }
    if (pointers.current.size >= 2) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // A second finger just landed — switch from single-pointer pan to
      // pinch for as long as both stay down.
      panState.current = null;
      const [p1, p2] = [...pointers.current.values()];
      pinchState.current = {
        initialDistance: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        initialScale: transform.scale,
      };
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
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinchState.current && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const { initialDistance, initialScale } = pinchState.current;
      if (initialDistance === 0) return;
      const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const rect = canvasRef.current?.getBoundingClientRect();
      const midX = (p1.x + p2.x) / 2 - (rect?.left ?? 0);
      const midY = (p1.y + p2.y) / 2 - (rect?.top ?? 0);
      const nextScale = clamp(
        initialScale * (distance / initialDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      // Same anchoring principle as wheel-zoom (keep the point under the
      // anchor fixed while scale changes), generalized to a moving midpoint:
      // recomputed fresh from the two *current* pointer positions every move,
      // against the live (not initial) transform, so panning the fingers
      // together while pinching never drifts or jumps.
      setTransform((t) => {
        const ratio = nextScale / t.scale;
        return {
          scale: nextScale,
          x: midX - (midX - t.x) * ratio,
          y: midY - (midY - t.y) * ratio,
        };
      });
      return;
    }

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
    // Only a pointer we're actually tracking can end the pinch — an
    // untracked third finger lifting (ignored on the way down) must not be
    // mistaken for one of the two pinching fingers releasing.
    const wasTracked = pointers.current.has(e.pointerId);
    const wasPinching =
      wasTracked && pinchState.current != null && pointers.current.size === 2;
    if (wasTracked) pointers.current.delete(e.pointerId);

    if (panState.current?.pointerId === e.pointerId) {
      // A pan that actually moved emits a trailing click on whatever's under
      // the cursor at release — swallow it so panning over a card doesn't
      // also open it (same ordering as the drag code's own suppress-flag).
      if (panMoved.current) suppressClick.current = true;
      panState.current = null;
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (wasPinching) {
      pinchState.current = null;
      // One finger remains — drop back to single-pointer pan from wherever
      // it currently is, so there's no jump.
      const remaining = [...pointers.current][0];
      if (remaining) {
        const [remainingId, remainingPos] = remaining;
        panMoved.current = false;
        panState.current = {
          pointerId: remainingId,
          startX: remainingPos.x,
          startY: remainingPos.y,
          originX: transform.x,
          originY: transform.y,
        };
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
    drawKind === "off" &&
    !connectDrag &&
    hoveredPath != null &&
    path !== hoveredPath &&
    !connectedToHover?.has(path);
  const isEdgeDimmed = (a: string, b: string) =>
    drawKind === "off" &&
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
  // Where the click that selected the edge landed, in `.vf-canvas`-relative
  // coordinates — screen space, not surface space, so the popup doesn't scale
  // with zoom. Drives the Part F Delete/Reverse popup positioning.
  const [edgePopupPos, setEdgePopupPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const plugin = usePlugin();

  // Live task lookup for render + mutation handlers, built from the workspace
  // snapshot — NOT from `graph.nodes`, whose `CanvasNode.task` instances are
  // frozen at layout time. Cards must repaint, and delete/reverse/connect must
  // read, the freshest task; otherwise a just-edited title or status stays
  // stale until the next layout pass happens to run.
  const taskById = useMemo(
    () => new Map(snapshot.tasks.map((t) => [t.path, t])),
    [snapshot.tasks],
  );

  const clearEdgeSelection = () => {
    setSelectedEdge(null);
    setEdgePopupPos(null);
  };

  const selectEdge = (
    edge: EdgeRef,
    e: { clientX: number; clientY: number },
  ) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    setSelectedEdge(edge);
    setEdgePopupPos({
      x: rect ? e.clientX - rect.left : e.clientX,
      y: rect ? e.clientY - rect.top : e.clientY,
    });
  };

  // A plain function, not a `setState` updater — `setState(fn)` updaters run
  // twice under StrictMode, and these have side effects (file writes), so the
  // write has to happen outside the updater, not inside it.
  const deleteSelectedEdge = () => {
    const edge = selectedEdge;
    if (!edge) return;
    clearEdgeSelection();
    if (edge.kind === "related") {
      const a = taskById.get(edge.a);
      const b = taskById.get(edge.b);
      if (a && b) void plugin.mutations.removeRelated(a, b);
    } else if (edge.kind === "dependency") {
      const blocker = taskById.get(edge.source);
      const blocked = taskById.get(edge.target);
      if (blocker && blocked)
        void plugin.mutations.removeDependency(blocker, blocked);
    } else {
      // hierarchy: source = parent, target = child (see drag direction below).
      const child = taskById.get(edge.target);
      if (child) void plugin.mutations.setParent(child, null);
    }
  };

  /**
   * Flip a selected edge's direction. `related` has no direction — the popup
   * doesn't even offer this for it, but guard here too rather than trust the
   * caller. Uses the exact same `Mutations`/cycle-check/overwrite-confirm
   * machinery Phase 7 already built — no new write capability.
   */
  const reverseSelectedEdge = () => {
    const edge = selectedEdge;
    if (!edge || edge.kind === "related") return;
    clearEdgeSelection();

    if (edge.kind === "dependency") {
      const blocker = taskById.get(edge.source);
      const blocked = taskById.get(edge.target);
      if (!blocker || !blocked) return;

      // Check the cycle as it would be *after* the old edge is gone — the
      // existing edge itself would otherwise always look like "the target
      // already blocks the source" and refuse every reversal.
      const strip = (t: Task): Task => ({
        ...t,
        relations: {
          ...t.relations,
          blocks: t.relations.blocks.filter(
            (l) => !linksMatch(l, blocked.path),
          ),
          blockedBy: t.relations.blockedBy.filter(
            (l) => !linksMatch(l, blocker.path),
          ),
        },
      });
      const withoutOldEdge = snapshot.tasks.map((t) =>
        t.path === blocker.path || t.path === blocked.path ? strip(t) : t,
      );
      if (
        wouldCreateDependencyCycle(withoutOldEdge, blocked.path, blocker.path)
      ) {
        new Notice(
          `Can't reverse — "${blocked.id}" and "${blocker.id}" would block each other in a cycle.`,
        );
        return;
      }
      void (async () => {
        await plugin.mutations.removeDependency(blocker, blocked);
        await plugin.mutations.addDependency(blocked, blocker);
      })();
      return;
    }

    // hierarchy: oldChild becomes oldParent's parent.
    const oldParent = taskById.get(edge.source);
    const oldChild = taskById.get(edge.target);
    if (!oldParent || !oldChild) return;

    // Same silent-overwrite risk Phase 7 flags for creating a hierarchy edge:
    // oldParent is the one becoming a child here, so it's oldParent's *own*
    // existing parent (unrelated to this edge) that would be replaced.
    if (oldParent.parent && !linksMatch(oldParent.parent, oldChild.path)) {
      setPendingReparent({
        child: oldParent,
        newParent: oldChild,
        clearFirst: oldChild,
      });
      return;
    }
    void (async () => {
      await plugin.mutations.setParent(oldChild, null);
      await plugin.mutations.setParent(oldParent, oldChild.path);
    })();
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
      } else if (e.key === "Escape") {
        clearEdgeSelection();
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

  // --- Tap-to-connect. --------------------------------------------------------
  // An alternate way to complete the same connection the drag handle draws —
  // for touch, where a continuous drag from a small corner handle isn't
  // always practical. Only participates in node taps while `drawKind !==
  // "off"`; the two input methods coexist rather than one replacing the
  // other (dragging from the handle is untouched).
  interface TapConnect {
    source: string;
    target: string | null; // null while only the source is armed
  }
  const [tapConnect, setTapConnect] = useState<TapConnect | null>(null);

  const [pendingReparent, setPendingReparent] = useState<{
    child: Task;
    newParent: Task;
    /** Set only for a hierarchy reversal: sever this task's old parent link
     *  first, before `child`'s new one is written. */
    clearFirst?: Task;
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

  /**
   * Tapping a node while `drawKind !== "off"`. Nine rules, each with a
   * specific reason — see Phase 12's spec for the reasoning behind each one;
   * this is just the encoding:
   *   1. no `tapConnect` → arm the tapped node as `source`.
   *   2. `target` still null, tap `source` again → cancel.
   *   3. `target` still null, tap a different node → set `target`.
   *   4. `target` set, tap `source` again → cancel entirely.
   *   5. `target` set, tap the current `target` again → no-op.
   *   6. `target` set, tap any other node → re-target in place.
   * Tapping empty canvas (rule 7), Escape (8), and a `drawKind` change (9)
   * are handled where those inputs already live, not here.
   */
  const onNodeTap = (path: string) => {
    setTapConnect((tc) => {
      if (!tc) return { source: path, target: null };
      if (tc.target === null) {
        if (path === tc.source) return null;
        return { source: tc.source, target: path };
      }
      if (path === tc.source) return null;
      if (path === tc.target) return tc;
      return { source: tc.source, target: path };
    });
  };

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
    const sourceTask = taskById.get(source);
    const targetTask = taskById.get(target);
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

  useEffect(() => {
    if (!tapConnect) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTapConnect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tapConnect]);

  // Switching the draw kind (including back to "off") invalidates whatever
  // connect gesture was in progress under the old kind — same rule for both
  // input methods.
  useEffect(() => {
    setConnectDrag(null);
    setTapConnect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKind]);

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

  // Tree-mode `blocks`/`blockedBy` edges — excluded from ELK's ranking, drawn
  // after layout with the same styling and arrowhead as an in-flow dependency
  // edge. Selectable and deletable exactly like one. The path snaps from the
  // source card's edge to the target card's edge (inset back by
  // `DEFAULT_CANVAS_EDGE_INSET` so the arrowhead clears the card) instead of
  // running centre-to-centre through the target.
  const overlayDependencyPaths = laidOut
    ? plan.overlayDependencyEdges
        .map(({ source, target }) => {
          const na = laidOut.nodes.get(source);
          const nb = laidOut.nodes.get(target);
          if (!na || !nb) return null;
          const d = canvasEdgeLinePath(na, nb);
          if (d === null) return null;
          return { source, target, d };
        })
        .filter(
          (e): e is { source: string; target: string; d: string } => e !== null,
        )
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
      onClick={() => clearEdgeSelection()}
    >
      {view.groupBy === "label" && (
        <div className="vf-canvas-note">
          Label grouping isn't shown as boxes here — a task can carry several
          labels at once.
        </div>
      )}

      {view.canvasArrangement === "tree" && !treeHasHierarchy && (
        <div className="vf-canvas-note">
          Hierarchy layout uses parent–child relationships. No visible hierarchy
          relationships were found.
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
                id="vf-canvas-dependency-marker"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path
                  className="vf-canvas-dependency-marker"
                  d="M 0 0 L 10 5 L 0 10 z"
                />
              </marker>
              {/* Parent-of: the same arrowhead shape as Blocks, in the
                  hierarchy colour, at the child (target) end — pointing into
                  the child, matching the way Blocks arrows into its target. */}
              <marker
                id="vf-canvas-parent-marker"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path
                  className="vf-canvas-parent-marker"
                  d="M 0 0 L 10 5 L 0 10 z"
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
                        ? "url(#vf-canvas-dependency-marker)"
                        : edge.kind === "hierarchy"
                          ? "url(#vf-canvas-parent-marker)"
                          : undefined
                    }
                  />
                  <path
                    className="vf-canvas-edge-hit"
                    d={edge.d}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      selectEdge(
                        {
                          kind: edge.kind,
                          source: edge.source,
                          target: edge.target,
                        },
                        ev,
                      );
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
                      selectEdge({ kind: "related", a, b }, ev);
                    }}
                  />
                </g>
              );
            })}
            {overlayDependencyPaths.map(({ source, target, d }, i) => {
              const selected =
                selectedEdge?.kind === "dependency" &&
                selectedEdge.source === source &&
                selectedEdge.target === target;
              return (
                <g key={`dep-${i}`}>
                  <path
                    className={`vf-canvas-edge-dependency${
                      isEdgeDimmed(source, target) ? " is-dimmed" : ""
                    }${selected ? " is-selected" : ""}`}
                    d={d}
                    markerEnd="url(#vf-canvas-dependency-marker)"
                  />
                  <path
                    className="vf-canvas-edge-hit"
                    d={d}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      selectEdge({ kind: "dependency", source, target }, ev);
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
            const task = taskById.get(id);
            if (!task) return null;
            const connectTarget: "valid" | "invalid" | null =
              connectDrag?.targetPath === id
                ? connectDrag.invalid
                  ? "invalid"
                  : "valid"
                : null;
            const isDragSource = connectDrag?.source === id;
            const tapRole: "source" | "target" | null =
              tapConnect?.source === id
                ? "source"
                : tapConnect?.target === id
                  ? "target"
                  : null;
            // Static pink preview of the *target* colour on whatever's being
            // hovered while connect mode is on — "this card will take part in
            // the connection." The pulse (the official target's animation)
            // only appears once it's actually set as a target, not while it's
            // merely being hovered. No role of its own yet, so a card that's
            // already a source/target keeps its own colour.
            const hoverTargetPreview =
              drawKind !== "off" &&
              !connectDrag &&
              tapRole === null &&
              hoveredPath === id;
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
                highlighted={
                  drawKind === "off" &&
                  !connectDrag &&
                  hoveredPath != null &&
                  id !== hoveredPath &&
                  connectedToHover?.has(id) === true
                }
                onHover={setHoveredPath}
                consumePanClick={consumePanClick}
                connectTarget={connectTarget}
                dragSource={isDragSource}
                showHandle={drawKind !== "off"}
                onHandleDown={startConnect}
                onHandleMove={moveConnect}
                onHandleUp={endConnect}
                connecting={drawKind !== "off"}
                onNodeTap={onNodeTap}
                tapRole={tapRole}
                hoverTargetPreview={hoverTargetPreview}
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

      {tapConnect?.target &&
        drawKind !== "off" &&
        (() => {
          // Captured as plain `string`s so the click handler below closes
          // over a stable, definitely-non-null pair rather than re-reading
          // `tapConnect.target` (typed `string | null`) inside a nested
          // closure, where TS can't carry this block's narrowing.
          const sourcePath = tapConnect.source;
          const targetPath = tapConnect.target;
          const sourceTask = taskById.get(sourcePath);
          const targetTask = taskById.get(targetPath);
          if (!sourceTask || !targetTask) return null;
          const invalid = connectGuard(sourcePath, targetPath);
          const invalidMessage =
            invalid === "cycle"
              ? drawKind === "hierarchy"
                ? `Can't move — "${sourceTask.id}" is a descendant of "${targetTask.id}".`
                : `Can't link — "${sourceTask.id}" and "${targetTask.id}" would block each other in a cycle.`
              : invalid === "self"
                ? "A task can't connect to itself."
                : null;
          return (
            // Screen-anchored (fixed to the viewport, not a node's canvas
            // coordinates) — deliberately, per rule 7: panning to find a
            // third node must never carry this off-screen along with it.
            <div className="vf-canvas-tap-connect">
              <span className="vf-canvas-tap-connect-label">
                {RELATION_KIND_LABELS[drawKind]}: {sourceTask.id} →{" "}
                {targetTask.id}
              </span>
              {invalidMessage && (
                <span className="vf-canvas-tap-connect-error">
                  {invalidMessage}
                </span>
              )}
              <div className="vf-canvas-tap-connect-actions">
                <button type="button" onClick={() => setTapConnect(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="mod-cta"
                  disabled={invalid != null}
                  onClick={() => {
                    setTapConnect(null);
                    void completeConnect(sourcePath, targetPath);
                  }}
                >
                  Connect
                </button>
              </div>
            </div>
          );
        })()}

      {selectedEdge && edgePopupPos && (
        <div
          className="vf-canvas-edge-popup"
          style={{ left: edgePopupPos.x, top: edgePopupPos.y }}
        >
          <Popover align="left" onClose={clearEdgeSelection}>
            <div className="vf-field-list">
              <button
                type="button"
                className="vf-field-row"
                onClick={deleteSelectedEdge}
              >
                <span className="vf-field-label">Delete</span>
              </button>
              {selectedEdge.kind !== "related" && (
                <button
                  type="button"
                  className="vf-field-row"
                  onClick={reverseSelectedEdge}
                >
                  <span className="vf-field-label">Reverse</span>
                </button>
              )}
            </div>
          </Popover>
        </div>
      )}

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
                const { child, newParent, clearFirst } = pendingReparent;
                setPendingReparent(null);
                void (async () => {
                  if (clearFirst)
                    await plugin.mutations.setParent(clearFirst, null);
                  await plugin.mutations.setParent(child, newParent.path);
                })();
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
  highlighted,
  onHover,
  consumePanClick,
  connectTarget,
  dragSource,
  showHandle,
  onHandleDown,
  onHandleMove,
  onHandleUp,
  connecting,
  onNodeTap,
  tapRole,
  hoverTargetPreview,
}: {
  task: Task;
  pos: PlacedBox;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  hiddenFields: readonly TaskField[];
  showProject: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onHover: (path: string | null) => void;
  /** True when the click that follows was really the end of a pan/connect gesture. */
  consumePanClick: () => boolean;
  /** Set while a connect-drag is hovering this node as a potential drop target. */
  connectTarget: "valid" | "invalid" | null;
  /** True while a connect-drag is pulling a relation out of this node. */
  dragSource: boolean;
  /** False while the draw mode is "off" — the handle isn't just inert, it isn't rendered. */
  showHandle: boolean;
  onHandleDown: (source: string, e: ReactPointerEvent<HTMLDivElement>) => void;
  onHandleMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onHandleUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** True whenever `drawKind !== "off"` — tapping the card body participates
   *  in tap-to-connect instead of opening the task while this is set. */
  connecting: boolean;
  onNodeTap: (path: string) => void;
  /** This node's role in the current tap-to-connect pair, if any. */
  tapRole: "source" | "target" | null;
  /** True while connect mode is on and this node is hovered with no role yet —
   *  shows a static preview of the target colour before it's actually set. */
  hoverTargetPreview: boolean;
}) {
  const off = (field: TaskField) => hiddenFields.includes(field);
  // Same mechanism Board's own cards open a task with — no Canvas-only path.
  const tabs = useTabs();
  return (
    <div
      className={[
        "vf-canvas-node",
        dimmed && "is-dimmed",
        highlighted && "is-hover-connected",
        dragSource && "is-tap-source",
        connectTarget === "valid" && "is-tap-target",
        connectTarget === "invalid" && "is-connect-invalid",
        tapRole === "source" && "is-tap-source",
        tapRole === "target" && "is-tap-target",
        hoverTargetPreview && "is-hover-target",
      ]
        .filter(Boolean)
        .join(" ")}
      data-task-path={task.path}
      // style={{ left: pos.x, top: pos.y, width: pos.width, height: pos.height }}
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        width: pos.width,
        height: pos.height,
      }}
      onPointerEnter={() => onHover(task.path)}
      onPointerLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (consumePanClick()) return;
        if (connecting) {
          onNodeTap(task.path);
        } else {
          tabs.openTask(task.path);
        }
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
                className="vf-canvas-dependency-marker"
                d="M 19 2 L 25 5 L 19 8 z"
              />
            )}
            {/* Parent-of: the same arrowhead at the child (right) end,
                pointing into it — a mirror of the Blocks one. */}
            {kind === "hierarchy" && (
              <path
                className="vf-canvas-parent-marker"
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
