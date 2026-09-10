/**
 * Canvas (DAG) view — Phase 1, strictly read-only.
 *
 * Renders the current view's filtered tasks as nodes in a layered dependency
 * graph, with directed edges from `blocks` / `blockedBy` relations, laid out by
 * `elkjs` (Sugiyama-style layered layout). Users can pan and zoom; nothing is
 * ever written back to any file. Node dragging, edge editing, topology picking
 * and frames are all later phases.
 *
 * The pure graph-building lives in `core/canvas/graph.ts` so it stays
 * unit-testable and Obsidian-free; this component only lays it out and draws it.
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
import { buildCanvasGraph } from "../../core/canvas/graph";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import { layoutIcon } from "../../core/views";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
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

const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;

interface PlacedNode {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface LaidOutGraph {
	nodes: Map<string, PlacedNode>;
	/** One SVG path `d` string per edge. */
	edges: string[];
	width: number;
	height: number;
}

const elk = new ELK();

export function CanvasView({ snapshot, view, evaluated, taxonomies }: CanvasViewProps) {
	const tasks = evaluated.tasks;

	// Memoise on the *content* that actually feeds the graph — visible task
	// paths plus their blocks/blockedBy arrays — not on `evaluated` identity,
	// which changes reference on unrelated re-renders.
	const signature = useMemo(
		() =>
			tasks
				.map(
					(t) =>
						`${t.path}|${t.relations.blocks.join(",")}|${t.relations.blockedBy.join(",")}`,
				)
				.join(";"),
		[tasks],
	);

	// eslint-disable-next-line react-hooks/exhaustive-deps
	const graph = useMemo(() => buildCanvasGraph(tasks), [signature]);

	const direction = view.canvasDirection === "TB" ? "DOWN" : "RIGHT";

	const [laidOut, setLaidOut] = useState<LaidOutGraph | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (evaluated.total === 0) return;
		let cancelled = false;
		setLoading(true);

		const elkGraph: ElkNode = {
			id: "root",
			layoutOptions: {
				"elk.algorithm": "layered",
				"elk.direction": direction,
				"elk.spacing.nodeNode": "36",
				"elk.layered.spacing.nodeNodeBetweenLayers": "64",
				"elk.separateConnectedComponents": "true",
			},
			children: graph.nodes.map((n) => ({
				id: n.id,
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
			})),
			edges: graph.edges.map((e, i) => ({
				id: `edge-${i}`,
				sources: [e.source],
				targets: [e.target],
			})),
		};

		elk
			.layout(elkGraph)
			.then((res) => {
				if (cancelled) return;
				setLaidOut(toLaidOut(res));
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
	}, [graph, direction, evaluated.total]);

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
			/>
		);
	}

	const nodeById = new Map(graph.nodes.map((n) => [n.id, n.task]));

	return (
		<div
			className="vf-canvas"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endPan}
			onPointerCancel={endPan}
			onWheel={onWheel}
		>
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
								<path d="M 0 0 L 10 5 L 0 10 z" />
							</marker>
						</defs>
						{laidOut.edges.map((d, i) => (
							<path
								key={i}
								className="vf-canvas-edge"
								d={d}
								markerEnd="url(#vf-canvas-arrow)"
							/>
						))}
					</svg>

					{[...laidOut.nodes].map(([id, pos]) => {
						const task = nodeById.get(id);
						if (!task) return null;
						return (
							<div
								key={id}
								className="vf-canvas-node"
								style={{
									left: pos.x,
									top: pos.y,
									width: pos.width,
									height: pos.height,
								}}
							>
								<div className="vf-canvas-node-top">
									<StatusDot taxonomies={taxonomies} status={task.status} />
									<span className="vf-id">{task.id}</span>
									<TaxonomyChip
										taxonomies={taxonomies}
										kind="priority"
										id={task.priority}
									/>
								</div>
								<div className="vf-canvas-node-title" title={displayTitle(task)}>
									{displayTitle(task)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

/** Flatten ELK's result into placed boxes + edge path strings + bounds. */
function toLaidOut(root: ElkNode): LaidOutGraph {
	const nodes = new Map<string, PlacedNode>();
	for (const child of root.children ?? []) {
		nodes.set(child.id, {
			x: child.x ?? 0,
			y: child.y ?? 0,
			width: child.width ?? NODE_WIDTH,
			height: child.height ?? NODE_HEIGHT,
		});
	}

	const edges: string[] = [];
	for (const edge of root.edges ?? []) {
		for (const section of edge.sections ?? []) {
			const pts = [
				section.startPoint,
				...(section.bendPoints ?? []),
				section.endPoint,
			];
			edges.push(
				pts
					.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
					.join(" "),
			);
		}
	}

	return {
		nodes,
		edges,
		width: Math.max(root.width ?? 0, 1),
		height: Math.max(root.height ?? 0, 1),
	};
}
