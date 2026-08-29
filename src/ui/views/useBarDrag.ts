/**
 * Dragging a Timeline bar (§8.1, phase 3).
 *
 * Built on Pointer Events with the same mouse-vs-touch lift rules as
 * `useTaskDrag` (shared via `pointerGesture.ts`): a mouse lifts on a few
 * pixels of movement, a touch lifts only after a long press so a scroll of the
 * timeline isn't mistaken for a drag.
 *
 * Three drag zones per bar, each mapped to one pure function from
 * `core/views/timeline`:
 *
 *   - `start` — left edge of a range bar → `resizeStart`
 *   - `end`   — right edge of a range bar → `resizeEnd`
 *   - `body`  — anywhere else, every bar kind → `shiftBar`
 *
 * **Live preview, single commit.** Every pointer move recomputes the bar from
 * the *original* bar plus the whole-day delta and stores it locally, so the
 * view re-renders the bar under the pointer. `onCommit` fires exactly once, on
 * release — mirroring `VerticalResizeHandle`'s `onResize` / `onResizeEnd`
 * split. One vault write per drag, not one per pointer event.
 *
 * The hook is agnostic to what backs a bar: the view passes an `onCommit` that
 * calls `updateTask` for a task row or `updateProject` for a project row.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	resizeEnd,
	resizeStart,
	shiftBar,
	type Bar,
	type RangeBar,
} from "../../core/views/timeline";
import { LONG_PRESS_MS, liftVerdict } from "./pointerGesture";

export type BarDragZone = "start" | "end" | "body";

export interface BarDragApi {
	/** The in-drag bar for this row, or `null` when it isn't being dragged. */
	previewFor: (rowKey: string) => Bar | null;
	isDragging: (rowKey: string) => boolean;
	/** Attach to each zone's `onPointerDown`. */
	onPointerDown: (
		event: React.PointerEvent,
		rowKey: string,
		bar: Bar,
		zone: BarDragZone,
	) => void;
	/**
	 * True if the gesture that just ended was a drag rather than a click — so a
	 * bar click that opens the task can be suppressed after a drop.
	 */
	consumeDragClick: () => boolean;
}

interface Gesture {
	rowKey: string;
	bar: Bar;
	zone: BarDragZone;
	pointerId: number;
	startX: number;
	startY: number;
	lifted: boolean;
	longPress: number | null;
}

/** Apply a whole-day delta to `bar` for the given zone. */
function project(bar: Bar, zone: BarDragZone, deltaDays: number): Bar {
	if (zone === "body") return shiftBar(bar, deltaDays);
	// Edge zones only exist on range bars (the view only renders the handles
	// there); guard anyway so a stray call can't throw.
	if (bar.kind !== "range") return bar;
	return zone === "start"
		? resizeStart(bar as RangeBar, deltaDays)
		: resizeEnd(bar as RangeBar, deltaDays);
}

export function useBarDrag({
	scale,
	onCommit,
}: {
	/** Pixels per day — the divisor turning pointer travel into whole days. */
	scale: number;
	onCommit: (rowKey: string, bar: Bar) => void;
}): BarDragApi {
	const [preview, setPreview] = useState<{ rowKey: string; bar: Bar } | null>(
		null,
	);
	const gesture = useRef<Gesture | null>(null);
	const previewRef = useRef(preview);
	previewRef.current = preview;
	const suppressClick = useRef(false);

	// Keep the live scale reachable from the window listeners without
	// re-subscribing them on every zoom.
	const scaleRef = useRef(scale);
	scaleRef.current = scale;

	const cancelLongPress = () => {
		const current = gesture.current;
		if (current?.longPress != null) {
			window.clearTimeout(current.longPress);
			current.longPress = null;
		}
	};

	const endGesture = useCallback(() => {
		cancelLongPress();
		gesture.current = null;
		setPreview(null);
		document.body.classList.remove("vf-bar-dragging");
	}, []);

	const lift = useCallback(() => {
		const current = gesture.current;
		if (!current || current.lifted) return;
		current.lifted = true;
		document.body.classList.add("vf-bar-dragging");
		setPreview({ rowKey: current.rowKey, bar: current.bar });
	}, []);

	const onPointerDown = useCallback(
		(
			event: React.PointerEvent,
			rowKey: string,
			bar: Bar,
			zone: BarDragZone,
		) => {
			if (event.button !== 0 || bar.kind === "unscheduled") return;
			event.stopPropagation();

			gesture.current = {
				rowKey,
				bar,
				zone,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				lifted: false,
				longPress: null,
			};

			if (event.pointerType === "touch" || event.pointerType === "pen") {
				gesture.current.longPress = window.setTimeout(lift, LONG_PRESS_MS);
			}
		},
		[lift],
	);

	useEffect(() => {
		const onMove = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || event.pointerId !== current.pointerId) return;

			const dx = Math.abs(event.clientX - current.startX);
			const dy = Math.abs(event.clientY - current.startY);

			if (!current.lifted) {
				const verdict = liftVerdict(event.pointerType, dx, dy);
				if (verdict === "lift") lift();
				else if (verdict === "abandon") {
					cancelLongPress();
					gesture.current = null;
				}
				return;
			}

			const scaleNow = scaleRef.current || 1;
			// Whole days — that's the grain dates are stored at.
			const deltaDays = Math.round(
				(event.clientX - current.startX) / scaleNow,
			);
			setPreview({
				rowKey: current.rowKey,
				bar: project(current.bar, current.zone, deltaDays),
			});
		};

		const onUp = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || event.pointerId !== current.pointerId) return;

			if (current.lifted) {
				const active = previewRef.current;
				if (active) onCommit(active.rowKey, active.bar);
				suppressClick.current = true;
			}
			endGesture();
		};

		const onTouchMove = (event: TouchEvent) => {
			if (gesture.current?.lifted) event.preventDefault();
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		window.addEventListener("touchmove", onTouchMove, { passive: false });

		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			window.removeEventListener("touchmove", onTouchMove);
		};
	}, [lift, endGesture, onCommit]);

	return {
		previewFor: (rowKey) =>
			preview && preview.rowKey === rowKey ? preview.bar : null,
		isDragging: (rowKey) => preview?.rowKey === rowKey,
		onPointerDown,
		consumeDragClick: () => {
			const suppressed = suppressClick.current;
			suppressClick.current = false;
			return suppressed;
		},
	};
}
