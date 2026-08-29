/**
 * Dragging an unscheduled task up onto the Timeline chart to give it a date.
 *
 * Shares the mouse-vs-touch lift rules with `useTaskDrag` / `useBarDrag` (via
 * `pointerGesture.ts`) — a mouse lifts on a few pixels, a touch lifts only
 * after a long press. On release the raw client coordinates are handed back;
 * the view converts them to a date and commits (`updateTask({ dueDate })`).
 *
 * The state carries the pointer position plus the source row's width, so the
 * view can float a preview card of the dragged task next to the cursor (the
 * same pattern as List/Board) alongside the target-date read-out.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { LONG_PRESS_MS, liftVerdict } from "./pointerGesture";

export interface ScheduleDragState {
	rowKey: string;
	/** Current pointer position, viewport coordinates. */
	x: number;
	y: number;
	/** Width of the source row, so a floating preview matches it. */
	width: number;
}

export interface ScheduleDragApi {
	drag: ScheduleDragState | null;
	isDragging: (rowKey: string) => boolean;
	/** Attach to each unscheduled row's `onPointerDown`. */
	onPointerDown: (event: React.PointerEvent, rowKey: string) => void;
	/** A drag just ended — swallow the trailing click so the row doesn't open. */
	consumeDragClick: () => boolean;
}

export function useScheduleDrag(
	onDrop: (rowKey: string, x: number, y: number) => void,
): ScheduleDragApi {
	const [drag, setDrag] = useState<ScheduleDragState | null>(null);
	const dragRef = useRef<ScheduleDragState | null>(null);
	dragRef.current = drag;

	const gesture = useRef<{
		rowKey: string;
		pointerId: number;
		startX: number;
		startY: number;
		width: number;
		lifted: boolean;
		longPress: number | null;
	} | null>(null);

	const suppressClick = useRef(false);

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
		setDrag(null);
		document.body.classList.remove("vf-bar-dragging");
	}, []);

	const lift = useCallback((x: number, y: number) => {
		const current = gesture.current;
		if (!current || current.lifted) return;
		current.lifted = true;
		document.body.classList.add("vf-bar-dragging");
		setDrag({ rowKey: current.rowKey, x, y, width: current.width });
	}, []);

	const onPointerDown = useCallback(
		(event: React.PointerEvent, rowKey: string) => {
			if (event.button !== 0) return;
			const target = event.target as HTMLElement;
			if (target.closest("button:not(.vf-row-open), input, select, a, textarea")) {
				return;
			}
			// Measure now, while the row is still in its resting position.
			const rect = event.currentTarget.getBoundingClientRect();
			gesture.current = {
				rowKey,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				width: rect.width,
				lifted: false,
				longPress: null,
			};
			if (event.pointerType === "touch" || event.pointerType === "pen") {
				const { clientX, clientY } = event;
				gesture.current.longPress = window.setTimeout(
					() => lift(clientX, clientY),
					LONG_PRESS_MS,
				);
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
				if (verdict === "lift") lift(event.clientX, event.clientY);
				else if (verdict === "abandon") {
					cancelLongPress();
					gesture.current = null;
				}
				return;
			}
			setDrag({
				rowKey: current.rowKey,
				x: event.clientX,
				y: event.clientY,
				width: current.width,
			});
		};

		const onUp = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || event.pointerId !== current.pointerId) return;
			if (current.lifted) {
				onDrop(current.rowKey, event.clientX, event.clientY);
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
	}, [lift, endGesture, onDrop]);

	return {
		drag,
		isDragging: (rowKey) => drag?.rowKey === rowKey,
		onPointerDown,
		consumeDragClick: () => {
			const suppressed = suppressClick.current;
			suppressClick.current = false;
			return suppressed;
		},
	};
}
