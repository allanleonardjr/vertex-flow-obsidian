/**
 * Pointer-based drag-to-reorder for the main tab strip.
 *
 * A stripped-down sibling of `views/useTaskDrag` — a tab strip is a single
 * horizontal row, so there's no group key and no multi-column target
 * resolution, just an insertion index. The mouse-threshold / touch-long-press
 * lift rules are shared verbatim (`pointerGesture`), because Obsidian Mobile is
 * a first-class target and a plain touch-drag must not fight the strip's own
 * horizontal scroll.
 *
 * The pinned "workspace" tab (id `"workspace"`, always index 0) can't be
 * dragged, and nothing can be dropped to its left — the minimum insertion
 * index is 1.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { LONG_PRESS_MS, liftVerdict } from "./views/pointerGesture";

const PINNED_TAB_ID = "workspace";

export interface TabDragApi {
	/** The tab currently being dragged, or null. */
	dragTabId: string | null;
	/** The gap the drop indicator sits in (index into the rendered strip), or null. */
	dropIndex: number | null;
	/** Attach to each non-pinned tab's `onPointerDown`. */
	onPointerDown: (event: React.PointerEvent, tabId: string) => void;
	isDragging: (tabId: string) => boolean;
	/**
	 * True if the gesture that just ended was a drag, not a click — so the tab's
	 * `onClick`-to-activate can bail out. Mirrors `useTaskDrag.consumeDragClick`.
	 */
	consumeDragClick: () => boolean;
}

export function useTabDrag(
	onReorder: (tabId: string, toIndex: number) => void,
): TabDragApi {
	const [dragTabId, setDragTabId] = useState<string | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);

	const gesture = useRef<{
		tabId: string;
		pointerId: number;
		startX: number;
		startY: number;
		lifted: boolean;
		longPress: number | null;
	} | null>(null);

	const dropIndexRef = useRef<number | null>(null);
	dropIndexRef.current = dropIndex;

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
		setDragTabId(null);
		setDropIndex(null);
	}, []);

	const lift = useCallback((clientX: number) => {
		const current = gesture.current;
		if (!current || current.lifted) return;
		current.lifted = true;
		setDragTabId(current.tabId);
		setDropIndex(resolveDropIndex(clientX));
	}, []);

	const onPointerDown = useCallback(
		(event: React.PointerEvent, tabId: string) => {
			// The pinned tab never moves; ignore secondary buttons and the close ✕.
			if (event.button !== 0 || tabId === PINNED_TAB_ID) return;
			if ((event.target as HTMLElement).closest("button, input, a")) return;

			gesture.current = {
				tabId,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				lifted: false,
				longPress: null,
			};

			if (event.pointerType === "touch" || event.pointerType === "pen") {
				const { clientX } = event;
				gesture.current.longPress = window.setTimeout(
					() => lift(clientX),
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
				if (verdict === "lift") lift(event.clientX);
				else if (verdict === "abandon") {
					cancelLongPress();
					gesture.current = null;
				}
				return;
			}

			setDropIndex(resolveDropIndex(event.clientX));
		};

		const onUp = (event: PointerEvent) => {
			const current = gesture.current;
			if (!current || event.pointerId !== current.pointerId) return;

			if (current.lifted) {
				const target = dropIndexRef.current;
				if (target != null) onReorder(current.tabId, target);
				// A drag ends with a trailing click; swallow it so the drop doesn't
				// also activate the tab.
				suppressClick.current = true;
			}
			endGesture();
		};

		// Non-passive so a lifted touch drag can suppress the strip's scroll.
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
	}, [lift, endGesture, onReorder]);

	return {
		dragTabId,
		dropIndex,
		onPointerDown,
		isDragging: (tabId) => dragTabId === tabId,
		consumeDragClick: () => {
			const suppressed = suppressClick.current;
			suppressClick.current = false;
			return suppressed;
		},
	};
}

/**
 * The gap the pointer is over, as an index into the strip's rendered tab list
 * (`0` = before the first tab). Clamped to a minimum of `1` so nothing can land
 * to the left of the pinned workspace tab. Read from the live DOM — the strip
 * scrolls horizontally and tabs are different widths, so cached geometry would
 * be stale within a frame.
 */
function resolveDropIndex(clientX: number): number {
	const strip = document.querySelector(".vf-tabs");
	if (!strip) return 1;
	const tabEls = [...strip.querySelectorAll<HTMLElement>("[data-tab-id]")];

	let index = tabEls.length;
	for (let i = 0; i < tabEls.length; i++) {
		const rect = tabEls[i].getBoundingClientRect();
		if (clientX < rect.left + rect.width / 2) {
			index = i;
			break;
		}
	}
	return Math.max(1, index);
}
