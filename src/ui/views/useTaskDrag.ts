/**
 * Drag-and-drop for both pointer types (§9.2), shared by List and Board.
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
 * Nothing here knows what a column looks like. Targets are resolved from the
 * live DOM via two data attributes, so any view that renders
 * `[data-group-key]` containers holding `[data-task-path]` items gets drag and
 * drop for free — that's how the List view reuses this unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 400;
const MOUSE_THRESHOLD_PX = 4;
/** How far a finger may wander before a long press is treated as a scroll. */
const TOUCH_SLOP_PX = 10;

/**
 * How far below-right of the pointer the preview hangs.
 *
 * The preview is deliberately *not* anchored to where you grabbed the card.
 * The drop indicator is drawn at the insertion point, which is right about
 * where the cursor is — a card centred under the cursor covers the very line
 * it's meant to be helping you aim. Hanging it below-right, the way an OS drag
 * image behaves, keeps the indicator clear.
 */
export const PREVIEW_OFFSET_PX = 14;

export interface DropTarget {
	/** Group key of the column/section under the pointer. */
	groupKey: string;
	/** Insert position within that group. */
	index: number;
}

export interface DragState {
	taskPath: string;
	fromGroup: string;
	/** Current pointer position, in viewport coordinates. */
	x: number;
	y: number;
	/** Width of the source element, so the preview matches it. */
	width: number;
	target: DropTarget | null;
}

export interface TaskDragApi {
	drag: DragState | null;
	/** Attach to each draggable item's `onPointerDown`. */
	onPointerDown: (
		event: React.PointerEvent,
		taskPath: string,
		groupKey: string,
	) => void;
	isDragging: (taskPath: string) => boolean;
	/**
	 * True if the gesture that just ended was a drag rather than a click.
	 *
	 * Needed because a drag always ends with a `click` event too, and without
	 * this guard dropping a card would also open its editor.
	 */
	consumeDragClick: () => boolean;
	/** Insert index within a group, or null when it isn't the drop target. */
	dropIndexFor: (groupKey: string) => number | null;
}

export function useTaskDrag(
	onDrop: (taskPath: string, target: DropTarget) => void,
): TaskDragApi {
	const [drag, setDrag] = useState<DragState | null>(null);

	// Everything the live gesture needs, kept in a ref so the global pointer
	// listeners never go stale between renders.
	const gesture = useRef<{
		taskPath: string;
		groupKey: string;
		pointerId: number;
		startX: number;
		startY: number;
		width: number;
		lifted: boolean;
		longPress: number | null;
	} | null>(null);

	const dragRef = useRef<DragState | null>(null);
	dragRef.current = drag;

	/** Set when a drag completes, cleared by the click handler that follows. */
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

	const lift = useCallback((x: number, y: number) => {
		const current = gesture.current;
		if (!current || current.lifted) return;
		current.lifted = true;
		document.body.classList.add("vf-dragging");
		setDrag({
			taskPath: current.taskPath,
			fromGroup: current.groupKey,
			x,
			y,
			width: current.width,
			target: resolveTarget(x, y, current.taskPath),
		});
	}, []);

	const onPointerDown = useCallback(
		(event: React.PointerEvent, taskPath: string, groupKey: string) => {
			// Ignore right-clicks and anything starting on an interactive control.
			if (event.button !== 0) return;
			const target = event.target as HTMLElement;
			if (target.closest("button, input, select, a, textarea")) return;

			// Measure now, while the element is still in its resting position.
			const rect = event.currentTarget.getBoundingClientRect();

			gesture.current = {
				taskPath,
				groupKey,
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
				fromGroup: current.groupKey,
				x: event.clientX,
				y: event.clientY,
				width: current.width,
				target: resolveTarget(event.clientX, event.clientY, current.taskPath),
			});
		};

		const onUp = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || event.pointerId !== current.pointerId) return;

			if (current.lifted) {
				const active = dragRef.current;
				if (active?.target) onDrop(current.taskPath, active.target);
				// A drag always emits a trailing click; swallow it so dropping a
				// card doesn't also open it.
				suppressClick.current = true;
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
		consumeDragClick: () => {
			const suppressed = suppressClick.current;
			suppressClick.current = false;
			return suppressed;
		},
		dropIndexFor: (groupKey) =>
			drag?.target?.groupKey === groupKey ? drag.target.index : null,
	};
}

/**
 * Work out where the pointer is hovering, from the DOM.
 *
 * Reading the live layout beats tracking item rectangles in state: groups
 * scroll independently and items reflow as the indicator moves, so any cached
 * geometry would be wrong within one frame.
 */
function resolveTarget(x: number, y: number, movingPath: string): DropTarget | null {
	const element = document.elementFromPoint(x, y) as HTMLElement | null;
	const group = element?.closest("[data-group-key]") as HTMLElement | null;
	if (!group) return null;

	const groupKey = group.dataset.groupKey as string;

	// A collapsed column is still a valid drop target (§8.2) — it just has no
	// items to position against, so anything landing on it goes to the top.
	const items = [...group.querySelectorAll<HTMLElement>("[data-task-path]")].filter(
		(item) => item.dataset.taskPath !== movingPath,
	);

	let index = items.length;
	for (let i = 0; i < items.length; i++) {
		const rect = items[i].getBoundingClientRect();
		if (y < rect.top + rect.height / 2) {
			index = i;
			break;
		}
	}

	return { groupKey, index };
}
