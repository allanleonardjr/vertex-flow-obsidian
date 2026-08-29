/**
 * The property rail shared by the Task and Project editors: a drag-resizable,
 * collapsible aside pinned to the right of the editor body.
 *
 * Width and collapsed state are plugin-global (not per-entity) — someone who
 * widens or hides the rail on a task wants the same on a project. They persist
 * through `plugin.settings` (`editorRailWidth` / `editorRailCollapsed`),
 * matching how `editorSourceOpen` is already shared between the two editors.
 */

import { useRef, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { usePlugin } from "../context";

const RAIL_MIN_WIDTH = 200;
/** Keep at least this much for the main (description / tasks) column. */
const EDITOR_MAIN_MIN_WIDTH = 280;
const RAIL_DEFAULT_WIDTH = 264;

export function EditorRail({ children }: { children: ReactNode }) {
	const plugin = usePlugin();
	const [width, setWidth] = useState(plugin.settings.editorRailWidth);
	const [collapsed, setCollapsed] = useState(
		plugin.settings.editorRailCollapsed,
	);

	const setCollapsedState = (next: boolean) => {
		setCollapsed(next);
		plugin.settings.editorRailCollapsed = next;
		void plugin.saveSettings();
	};

	if (collapsed) {
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
					plugin.settings.editorRailWidth = next;
					void plugin.saveSettings();
				}}
			/>
			<aside className="vf-editor-rail" style={{ width }}>
				<div className="vf-editor-rail-head">
					<button
						type="button"
						className="vf-icon-button vf-editor-rail-toggle"
						title="Collapse panel"
						aria-label="Collapse panel"
						onClick={() => setCollapsedState(true)}
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
