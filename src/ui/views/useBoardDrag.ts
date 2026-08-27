/**
 * Board drag-and-drop for both pointer types (§9.2).
 *
 * Built on Pointer Events rather than HTML5 drag-and-drop, because HTML5 DnD
 * has no touch support at all on mobile — and full Obsidian Mobile support is a
 * v1 requirement, not a nice-to-have.
 *
 * The two gestures differ on purpose:
 *   - **Mouse**: lifts as soon as you move a few pixels, the usual behaviour.
 *   - **Touch**: lifts only after a long press. A plain touch-drag would be
 *     indistinguishable from scrolling a column, so it must not start a drag.
 *
 * Once a touch drag lifts, page scrolling is suppressed until it ends —
 * otherwise the column scrolls out from under the finger that's dragging.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 400;
const MOUSE_THRESHOLD_PX = 4;
/** How far a finger may wander before a long press is treated as a scroll. */
const TOUCH_SLOP_PX = 10;

export interface DropTarget {
	/** Group key of the column under the pointer. */
	columnKey: string;
	/** Insert position within that column. */
	index: number;
}

export interface DragState {
	taskPath: string;
	fromColumn: string;
	/** Current pointer position, in viewport coordinates. */
	x: number;
	y: number;
	/**
	 * Where inside the card the pointer grabbed it, and how wide the card was.
	 * The preview renders at `pointer - offset` so the card stays exactly where
	 * it was under the cursor instead of snapping its corner to the pointer.
	 */
	offsetX: number;
	offsetY: number;
	width: number;
	target: DropTarget | null;
}

export interface BoardDragApi {
	drag: DragState | null;
	/** Attach to each card's `onPointerDown`. */
	onPointerDown: (
		event: React.PointerEvent,
		taskPath: string,
		columnKey: string,
	) => void;
	/** True while this card is the one being dragged. */
	isDragging: (taskPath: string) => boolean;
}

export function useBoardDrag(
	onDrop: (taskPath: string, target: DropTarget) => void,
): BoardDragApi {
	const [drag, setDrag] = useState<DragState | null>(null);

	// Everything the live gesture needs, kept in a ref so the global pointer
	// listeners never go stale between renders.
	const gesture = useRef<{
		taskPath: string;
		columnKey: string;
		pointerId: number;
		startX: number;
		startY: number;
		offsetX: number;
		offsetY: number;
		width: number;
		lifted: boolean;
		longPress: number | null;
	} | null>(null);

	const dragRef = useRef<DragState | null>(null);
	dragRef.current = drag;

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

	const lift = useCallback((x: number, y: number) => {
		const current = gesture.current;
		if (!current || current.lifted) return;
		current.lifted = true;
		document.body.classList.add("vf-dragging");
		setDrag({
			taskPath: current.taskPath,
			fromColumn: current.columnKey,
			x,
			y,
			offsetX: current.offsetX,
			offsetY: current.offsetY,
			width: current.width,
			target: resolveTarget(x, y, current.taskPath),
		});
	}, []);

	const onPointerDown = useCallback(
		(event: React.PointerEvent, taskPath: string, columnKey: string) => {
			// Ignore right-clicks and anything starting on an interactive control.
			if (event.button !== 0) return;
			const target = event.target as HTMLElement;
			if (target.closest("button, input, select, a, textarea")) return;

			// Measure now, while the card is still in its resting position.
			const rect = event.currentTarget.getBoundingClientRect();

			gesture.current = {
				taskPath,
				columnKey,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				offsetX: event.clientX - rect.left,
				offsetY: event.clientY - rect.top,
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
				if (event.pointerType === "mouse") {
					if (dx > MOUSE_THRESHOLD_PX || dy > MOUSE_THRESHOLD_PX) {
						lift(event.clientX, event.clientY);
					}
				} else if (dx > TOUCH_SLOP_PX || dy > TOUCH_SLOP_PX) {
					// The finger moved before the long press fired — that's a
					// scroll, so abandon the gesture entirely.
					cancelLongPress();
					gesture.current = null;
				}
				return;
			}

			setDrag({
				taskPath: current.taskPath,
				fromColumn: current.columnKey,
				x: event.clientX,
				y: event.clientY,
				offsetX: current.offsetX,
				offsetY: current.offsetY,
				width: current.width,
				target: resolveTarget(event.clientX, event.clientY, current.taskPath),
			});
		};

		const onUp = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || event.pointerId !== current.pointerId) return;

			const active = dragRef.current;
			if (current.lifted && active?.target) {
				onDrop(current.taskPath, active.target);
			}
			endGesture();
		};

		// Non-passive so a lifted touch drag can suppress the column's scroll.
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
		onPointerDown,
		isDragging: (taskPath) => drag?.taskPath === taskPath,
	};
}

/**
 * Work out where the pointer is hovering, from the DOM.
 *
 * Reading the live layout beats tracking card rectangles in state: columns
 * scroll independently and cards reflow as the placeholder moves, so any cached
 * geometry would be wrong within one frame.
 */
function resolveTarget(x: number, y: number, movingPath: string): DropTarget | null {
	const element = document.elementFromPoint(x, y) as HTMLElement | null;
	const column = element?.closest("[data-column-key]") as HTMLElement | null;
	if (!column) return null;

	const columnKey = column.dataset.columnKey as string;

	// A collapsed column is still a valid drop target (§8.2) — it just has no
	// cards to position against, so anything landing on it goes to the top.
	const cards = [...column.querySelectorAll<HTMLElement>("[data-task-path]")].filter(
		(card) => card.dataset.taskPath !== movingPath,
	);

	let index = cards.length;
	for (let i = 0; i < cards.length; i++) {
		const rect = cards[i].getBoundingClientRect();
		if (y < rect.top + rect.height / 2) {
			index = i;
			break;
		}
	}

	return { columnKey, index };
}
