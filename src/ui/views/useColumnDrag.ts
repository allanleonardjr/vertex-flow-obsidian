/**
 * Drag-to-reorder for Table column headers. Same shape as `useScheduleDrag`/
 * `useTaskDrag`: Pointer Events only (no HTML5 DnD — no touch support there),
 * a mouse lifts on a few pixels of movement, a touch lifts only after a long
 * press so a tap-to-sort click (the header's other job) and a drag gesture
 * never fight each other on mobile.
 *
 * Mandatory columns (status/id/title) never call `onPointerDown` here — they
 * have no drag handle in `TaskTable`, so they simply can't start a drag.
 *
 * Targets are resolved from the live DOM via `[data-column-key]`, one per
 * reorderable header, the same "read real layout, not cached geometry"
 * approach `useTaskDrag`'s `resolveTarget` uses for row drops.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskField } from "../../core/types";
import { LONG_PRESS_MS, liftVerdict } from "./pointerGesture";

export interface ColumnDragState {
	column: TaskField;
	/** Current pointer position, viewport coordinates. */
	x: number;
	y: number;
	/** Width of the dragged header, so a caller could float a preview. */
	width: number;
	/** Insertion index among the reorderable columns, excluding the dragged one. */
	targetIndex: number;
	/**
	 * Horizontal distance moved since the gesture's original pointerdown
	 * (not since it lifted past the drag threshold), so a sideways-sliding
	 * preview starts moving the instant it appears rather than snapping in
	 * from zero.
	 */
	deltaX: number;
}

export interface ColumnDragApi {
	drag: ColumnDragState | null;
	/** Attach to each reorderable column header's drag handle. */
	onPointerDown: (event: React.PointerEvent, column: TaskField) => void;
	isDragging: (column: TaskField) => boolean;
	/** A drag just ended — swallow the trailing click so the header doesn't sort. */
	consumeDragClick: () => boolean;
}

/**
 * Reinserts `column` into `order` at `targetIndex`, among the columns that
 * aren't it. The one true implementation of "what does the order look like
 * with this column at this index" — used both to preview the other columns
 * shuffling live during a drag (`TaskTable.tsx`) and to compute the order
 * actually committed when the drag ends, just below. Keeping both on this
 * one function means the live preview can never settle into an order
 * different from the one that gets saved.
 */
export function reorderColumns(
	order: readonly TaskField[],
	column: TaskField,
	targetIndex: number,
): TaskField[] {
	const rest = order.filter((c) => c !== column);
	return [...rest.slice(0, targetIndex), column, ...rest.slice(targetIndex)];
}

export function useColumnDrag(
	order: readonly TaskField[],
	onDrop: (nextOrder: TaskField[]) => void,
): ColumnDragApi {
	const [drag, setDrag] = useState<ColumnDragState | null>(null);
	const dragRef = useRef<ColumnDragState | null>(null);
	dragRef.current = drag;
	const orderRef = useRef(order);
	orderRef.current = order;

	const gesture = useRef<{
		column: TaskField;
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
		document.body.classList.remove("vf-dragging");
	}, []);

	/** Where, among the *other* reorderable headers, the pointer currently sits. */
	const resolveIndex = (x: number, column: TaskField): number => {
		const headers = [
			...document.querySelectorAll<HTMLElement>("[data-column-key]"),
		].filter((el) => el.dataset.columnKey !== column);

		let index = headers.length;
		for (let i = 0; i < headers.length; i++) {
			const rect = headers[i].getBoundingClientRect();
			if (x < rect.left + rect.width / 2) {
				index = i;
				break;
			}
		}
		return index;
	};

	const lift = useCallback((x: number, y: number) => {
		const current = gesture.current;
		if (!current || current.lifted) return;
		current.lifted = true;
		document.body.classList.add("vf-dragging");
		setDrag({
			column: current.column,
			x,
			y,
			width: current.width,
			targetIndex: resolveIndex(x, current.column),
			deltaX: x - current.startX,
		});
	}, []);

	const onPointerDown = useCallback(
		(event: React.PointerEvent, column: TaskField) => {
			if (event.button !== 0) return;
			const rect = event.currentTarget.getBoundingClientRect();
			gesture.current = {
				column,
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
				column: current.column,
				x: event.clientX,
				y: event.clientY,
				width: current.width,
				targetIndex: resolveIndex(event.clientX, current.column),
				deltaX: event.clientX - current.startX,
			});
		};

		const onUp = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || event.pointerId !== current.pointerId) return;

			if (current.lifted) {
				const active = dragRef.current;
				if (active) {
					onDrop(reorderColumns(orderRef.current, active.column, active.targetIndex));
				}
				suppressClick.current = true;
			}
			endGesture();
		};

		// Non-passive so a lifted touch drag can suppress the table's scroll.
		const onTouchMove = (event: TouchEvent) => {
			if (gesture.current?.lifted) event.preventDefault();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (!gesture.current?.lifted) return;
			event.preventDefault();
			event.stopPropagation();
			suppressClick.current = true;
			endGesture();
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		window.addEventListener("touchmove", onTouchMove, { passive: false });
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			window.removeEventListener("touchmove", onTouchMove);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [lift, endGesture, onDrop]);

	return {
		drag,
		onPointerDown,
		isDragging: (column) => drag?.column === column,
		consumeDragClick: () => {
			const suppressed = suppressClick.current;
			suppressClick.current = false;
			return suppressed;
		},
	};
}
