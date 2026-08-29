/**
 * Shared low-level "is this gesture a drag yet?" disambiguation, used by both
 * drag hooks (`useTaskDrag` for list/board reordering, `useBarDrag` for
 * timeline bars). The domain math on top is completely different; the
 * mouse-vs-touch lift rules must not be.
 *
 *   - **Mouse**: lifts as soon as the pointer moves past a few pixels.
 *   - **Touch / pen**: a long press lifts it; moving the finger *before* that
 *     timer fires means the user is scrolling, so the gesture is abandoned.
 */

export const LONG_PRESS_MS = 400;
export const MOUSE_THRESHOLD_PX = 4;
/** How far a finger may wander before a pending long press is treated as a scroll. */
export const TOUCH_SLOP_PX = 10;

export type LiftVerdict =
	/** Not enough movement yet — keep waiting. */
	| "pending"
	/** Movement crossed the mouse threshold — start the drag now. */
	| "lift"
	/** Finger moved before the long press — this is a scroll, drop the gesture. */
	| "abandon";

/**
 * Decide what a not-yet-lifted gesture should do given how far the pointer has
 * moved from where it went down. `dx`/`dy` are absolute pixel distances.
 */
export function liftVerdict(
	pointerType: string,
	dx: number,
	dy: number,
): LiftVerdict {
	if (pointerType === "mouse") {
		return dx > MOUSE_THRESHOLD_PX || dy > MOUSE_THRESHOLD_PX
			? "lift"
			: "pending";
	}
	return dx > TOUCH_SLOP_PX || dy > TOUCH_SLOP_PX ? "abandon" : "pending";
}
