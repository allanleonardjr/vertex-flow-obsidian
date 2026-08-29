/**
 * A drag-to-resize separator — the reusable form of the near-identical handles
 * in `EditorRail` and the Project editor. Pointer-capture based, so a fast drag
 * never outruns it; double-click resets when `resetTo` is given.
 *
 * `axis` is the axis the pointer travels: `"x"` for a vertical bar that sets a
 * width, `"y"` for a horizontal bar that sets a height. `sign` is which way the
 * value grows — `1` when the resized pane is anchored to the start (drag away
 * to enlarge), `-1` when it's anchored to the end (the rail on the right, a
 * pane docked to the bottom).
 *
 * Live updates go to `onResize` during the drag; `onResizeEnd` fires once on
 * release with the final value — mirror this split when persisting (local
 * state per move, one write on end).
 *
 * `onReset` (optional) runs on double-click — the timeline uses it to size a
 * pane to its contents rather than to a fixed default.
 */

import { useRef } from "react";

export function ResizeHandle({
	axis,
	sign = 1,
	value,
	min,
	computeMax,
	onResize,
	onResizeEnd,
	onReset,
	resetTo,
	className,
	title = "Drag to resize — double-click to reset",
}: {
	axis: "x" | "y";
	sign?: 1 | -1;
	value: number;
	min: number;
	/** Upper bound, from the parent element's size along `axis`. */
	computeMax: (parentSize: number) => number;
	onResize: (value: number) => void;
	onResizeEnd: (value: number) => void;
	/** Double-click behaviour. Runs the callback if given, else resets to `resetTo`. */
	onReset?: () => void;
	resetTo?: number;
	className?: string;
	title?: string;
}) {
	const drag = useRef<{ start: number; startValue: number; max: number } | null>(
		null,
	);

	return (
		<div
			className={`vf-resize-handle vf-resize-${axis}${className ? ` ${className}` : ""}`}
			role="separator"
			aria-orientation={axis === "x" ? "vertical" : "horizontal"}
			aria-valuenow={value}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				const parent = event.currentTarget.parentElement;
				const parentSize =
					axis === "x"
						? (parent?.clientWidth ?? window.innerWidth)
						: (parent?.clientHeight ?? window.innerHeight);
				drag.current = {
					start: axis === "x" ? event.clientX : event.clientY,
					startValue: value,
					max: Math.max(min, computeMax(parentSize)),
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				if (!drag.current) return;
				const pos = axis === "x" ? event.clientX : event.clientY;
				const next = clamp(
					drag.current.startValue + sign * (pos - drag.current.start),
					min,
					drag.current.max,
				);
				onResize(next);
			}}
			onPointerUp={(event) => {
				if (!drag.current) return;
				drag.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
				onResizeEnd(value);
			}}
			onDoubleClick={
				onReset ??
				(resetTo != null
					? () => {
							onResize(resetTo);
							onResizeEnd(resetTo);
						}
					: undefined)
			}
			title={title}
		/>
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
