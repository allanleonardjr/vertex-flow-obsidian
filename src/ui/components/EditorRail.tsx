/**
 * The property rail shared by the Task and Project editors: a drag-resizable,
 * collapsible aside pinned to the right of the editor body.
 *
 * Width and collapsed state are per editor kind (Task vs. Project) — each
 * remembers its own, so collapsing or resizing the rail on a task has no
 * effect on a project's rail and vice versa. They persist through
 * `plugin.settings` as `<kind>EditorRailWidth` / `<kind>EditorRailCollapsed`,
 * matching how `<kind>EditorSourceOpen` is keyed per editor kind too.
 */

import { useRef, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { usePlugin } from "../context";
import { useCompactNav } from "../compact-nav-context";

const RAIL_MIN_WIDTH = 200;
/** Keep at least this much for the main (description / tasks) column. */
const EDITOR_MAIN_MIN_WIDTH = 280;
const RAIL_DEFAULT_WIDTH = 264;

export type EditorRailKind = "task" | "project";

export function EditorRail({
	kind,
	children,
}: {
	kind: EditorRailKind;
	children: ReactNode;
}) {
	const plugin = usePlugin();
	// In compact (narrow) panes the rail becomes a right-side overlay drawer and
	// its open/closed state is driven by the toggle strip (`propertiesOpen`),
	// never the persisted `collapsed` flag — the two live in different contexts
	// and must not leak into each other. In wide panes `propertiesOpen` is
	// perpetually false, so `showFull` collapses back to `!collapsed` (the
	// original behavior).
	const { propertiesOpen, closeDrawers } = useCompactNav();
	const widthKey =
		kind === "task" ? "taskEditorRailWidth" : "projectEditorRailWidth";
	const collapsedKey =
		kind === "task" ? "taskEditorRailCollapsed" : "projectEditorRailCollapsed";
	const [width, setWidth] = useState(plugin.settings[widthKey]);
	const [collapsed, setCollapsed] = useState(plugin.settings[collapsedKey]);

	const showFull = propertiesOpen || !collapsed;

	const setCollapsedState = (next: boolean) => {
		setCollapsed(next);
		plugin.settings[collapsedKey] = next;
		void plugin.saveSettings();
	};

	if (!showFull) {
		return (
			<aside className="vf-editor-rail is-collapsed">
				<button
					type="button"
					className="vf-icon-button vf-editor-rail-toggle"
					title="Expand panel"
					aria-label="Expand panel"
					onClick={() => setCollapsedState(false)}
				>
					<PanelRightOpen size={16} />
				</button>
			</aside>
		);
	}

	return (
		<>
			<RailResizeHandle
				width={width}
				onResize={setWidth}
				onResizeEnd={(next) => {
					plugin.settings[widthKey] = next;
					void plugin.saveSettings();
				}}
			/>
			<aside
				className="vf-editor-rail"
				style={propertiesOpen ? undefined : { width }}
			>
				<div className="vf-editor-rail-head">
					<button
						type="button"
						className="vf-icon-button vf-editor-rail-toggle"
						title="Collapse panel"
						aria-label="Collapse panel"
						onClick={() => {
							// Closes the compact drawer (if open) and remembers the
							// persisted collapse for wide panes alike.
							closeDrawers();
							setCollapsedState(true);
						}}
					>
						<PanelRightClose size={16} />
					</button>
				</div>
				{children}
			</aside>
		</>
	);
}

function RailResizeHandle({
	width,
	onResize,
	onResizeEnd,
}: {
	width: number;
	onResize: (width: number) => void;
	onResizeEnd: (width: number) => void;
}) {
	const drag = useRef<{
		startX: number;
		startWidth: number;
		max: number;
	} | null>(null);

	return (
		<div
			className="vf-editor-resize-handle"
			role="separator"
			aria-orientation="vertical"
			aria-valuenow={width}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				// Cap only so the main column keeps a usable minimum; there is no
				// fixed upper bound beyond that.
				const bodyWidth =
					event.currentTarget.parentElement?.clientWidth ?? window.innerWidth;
				drag.current = {
					startX: event.clientX,
					startWidth: width,
					max: Math.max(RAIL_MIN_WIDTH, bodyWidth - EDITOR_MAIN_MIN_WIDTH),
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				if (!drag.current) return;
				const delta = event.clientX - drag.current.startX;
				const next = Math.min(
					drag.current.max,
					Math.max(RAIL_MIN_WIDTH, drag.current.startWidth - delta),
				);
				onResize(next);
			}}
			onPointerUp={(event) => {
				if (!drag.current) return;
				drag.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
				onResizeEnd(width);
			}}
			onDoubleClick={() => {
				onResize(RAIL_DEFAULT_WIDTH);
				onResizeEnd(RAIL_DEFAULT_WIDTH);
			}}
			title="Drag to resize — double-click to reset"
		/>
	);
}
