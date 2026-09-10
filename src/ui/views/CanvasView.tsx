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
	type CanvasGraph,
	type LayeringEdgeKind,
} from "../../core/canvas/graph";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { layoutIcon, renderedHiddenFields } from "../../core/views";
import type {
	SavedView,
	Task,
	TaskField,
	WorkspaceSnapshot,
} from "../../core/types";
import { EmptyView } from "../components/EmptyView";
import { StatusDot, TaxonomyChip } from "../components/TaskBits";
import { displayTitle } from "../components/TaskTitle";

export interface CanvasViewProps {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	evaluated: EvaluatedView;
	taxonomies: WorkspaceTaxonomies;
}

/** Fixed node box — ELK needs concrete dimensions; CSS truncates to fit. */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;
/** Extra top padding inside a group box, leaving room for its header. */
const GROUP_PADDING = "[top=34.0,left=16.0,bottom=16.0,right=16.0]";

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;

interface PlacedBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface FlatLayout {
	/** Task nodes, absolute coords. */
	nodes: Map<string, PlacedBox>;
	/** Group compound boxes, absolute coords, keyed by `group:${key}`. */
	groups: Map<string, PlacedBox>;
	/** One entry per rendered edge segment. */
	edges: { d: string; kind: LayeringEdgeKind }[];
	width: number;
	height: number;
}

const elk = new ELK();

export function CanvasView({ view, evaluated, taxonomies }: CanvasViewProps) {
	// Reuse the Board's own group set — non-hidden, non-empty — for the boxes,
	// and the matching visible-task set. Flat when grouped by `label`/`none`.
	const { grouped, boxes: visibleGroups, tasks: visibleTasks } = useMemo(
		() => canvasGrouping(evaluated.groups, evaluated.tasks, view.groupBy),
		[evaluated.groups, evaluated.tasks, view.groupBy],
	);

	const shownFields = useMemo(() => renderedHiddenFields(view), [view]);

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

	// eslint-disable-next-line react-hooks/exhaustive-deps
	const graph: CanvasGraph = useMemo(
		() => buildCanvasGraph(visibleTasks),
		[signature],
	);

	const direction = view.canvasDirection === "TB" ? "DOWN" : "RIGHT";

	const [laidOut, setLaidOut] = useState<FlatLayout | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (visibleTasks.length === 0) return;
		let cancelled = false;
		setLoading(true);

		const leaf = (id: string) => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT });
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

		// `edge-${i}` carries the kind back by index after layout.
		const kindById = new Map<string, LayeringEdgeKind>();
		const edges = graph.layeringEdges.map((e, i) => {
			const id = `edge-${i}`;
			kindById.set(id, e.kind);
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
				setLaidOut(flattenLayout(res, kindById));
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
	const [transform, setTransform] = useState({ x: 24, y: 24, scale: 1 });
	const panState = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
	} | null>(null);

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		// Only the background pans — a press that lands on a node does nothing.
		if ((e.target as HTMLElement).closest(".vf-canvas-node")) return;
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
		setTransform((t) => ({
			...t,
			x: pan.originX + (e.clientX - pan.startX),
			y: pan.originY + (e.clientY - pan.startY),
		}));
	};

	const endPan = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (panState.current?.pointerId === e.pointerId) {
			panState.current = null;
			if (e.currentTarget.hasPointerCapture(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
		}
	};

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
					return (
						`M ${na.x + na.width / 2} ${na.y + na.height / 2} ` +
						`L ${nb.x + nb.width / 2} ${nb.y + nb.height / 2}`
					);
				})
				.filter((d): d is string => d !== null)
		: [];

	return (
		<div
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
								className={`vf-canvas-edge-${edge.kind}`}
								d={edge.d}
								markerEnd={
									edge.kind === "dependency"
										? "url(#vf-canvas-arrow)"
										: undefined
								}
							/>
						))}
						{relatedPaths.map((d, i) => (
							<path key={`rel-${i}`} className="vf-canvas-edge-related" d={d} />
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
								taxonomies={taxonomies}
								hiddenFields={shownFields}
							/>
						);
					})}
				</div>
			)}

			<CanvasLegend />
		</div>
	);
}

function CanvasNode({
	task,
	pos,
	taxonomies,
	hiddenFields,
}: {
	task: Task;
	pos: PlacedBox;
	taxonomies: WorkspaceTaxonomies;
	hiddenFields: readonly TaskField[];
}) {
	const off = (field: TaskField) => hiddenFields.includes(field);
	return (
		<div
			className="vf-canvas-node"
			style={{ left: pos.x, top: pos.y, width: pos.width, height: pos.height }}
		>
			<div className="vf-canvas-node-top">
				<StatusDot taxonomies={taxonomies} status={task.status} />
				<span className="vf-id">{task.id}</span>
				{!off("priority") && (
					<TaxonomyChip
						taxonomies={taxonomies}
						kind="priority"
						id={task.priority}
					/>
				)}
			</div>
			<div className="vf-canvas-node-title" title={displayTitle(task)}>
				{displayTitle(task)}
			</div>
		</div>
	);
}

function CanvasLegend() {
	return (
		<div className="vf-canvas-legend" aria-hidden>
			<div className="vf-canvas-legend-row">
				<svg width="26" height="10" viewBox="0 0 26 10">
					<path className="vf-canvas-edge-dependency" d="M 1 5 L 19 5" />
					<path className="vf-canvas-arrow-head" d="M 19 2 L 25 5 L 19 8 z" />
				</svg>
				<span>Depends on</span>
			</div>
			<div className="vf-canvas-legend-row">
				<svg width="26" height="10" viewBox="0 0 26 10">
					<path className="vf-canvas-edge-hierarchy" d="M 1 5 L 25 5" />
				</svg>
				<span>Sub-task of</span>
			</div>
			<div className="vf-canvas-legend-row">
				<svg width="26" height="10" viewBox="0 0 26 10">
					<path className="vf-canvas-edge-related" d="M 1 5 L 25 5" />
				</svg>
				<span>Related</span>
			</div>
		</div>
	);
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

/**
 * Flatten ELK's nested result into absolute coordinates.
 *
 * With `hierarchyHandling: INCLUDE_CHILDREN` every node's `x`/`y` is relative to
 * its parent compound node, and an edge's section points are relative to
 * whichever container ELK routed the edge through — so we walk the tree once,
 * carrying each container's absolute origin, and add it into every coordinate.
 */
function flattenLayout(
	root: ElkNode,
	kindById: Map<string, LayeringEdgeKind>,
): FlatLayout {
	const nodes = new Map<string, PlacedBox>();
	const groups = new Map<string, PlacedBox>();
	const edges: { d: string; kind: LayeringEdgeKind }[] = [];

	const visit = (node: ElkNode, absX: number, absY: number) => {
		for (const edge of node.edges ?? []) {
			const kind = kindById.get(edge.id ?? "") ?? "dependency";
			for (const section of edge.sections ?? []) {
				const pts = [
					section.startPoint,
					...(section.bendPoints ?? []),
					section.endPoint,
				];
				const d = pts
					.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x + absX} ${p.y + absY}`)
					.join(" ");
				edges.push({ d, kind });
			}
		}

		for (const child of node.children ?? []) {
			const cx = absX + (child.x ?? 0);
			const cy = absY + (child.y ?? 0);
			const box: PlacedBox = {
				x: cx,
				y: cy,
				width: child.width ?? NODE_WIDTH,
				height: child.height ?? NODE_HEIGHT,
			};
			if (child.id.startsWith("group:")) {
				groups.set(child.id, box);
				visit(child, cx, cy);
			} else {
				nodes.set(child.id, box);
			}
		}
	};

	visit(root, 0, 0);

	return {
		nodes,
		groups,
		edges,
		width: Math.max(root.width ?? 0, 1),
		height: Math.max(root.height ?? 0, 1),
	};
}
