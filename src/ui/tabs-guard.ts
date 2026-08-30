/**
 * Pure helpers behind `tabs-context.tsx` — the unsaved-changes guard decision
 * and the drag-reorder splice — split out so they can be unit-tested (the React
 * wiring around them can't).
 *
 * Only the active tab is ever mounted, so only it can hold a live draft. The
 * rules:
 *
 *   - No guard registered → never prompt.
 *   - Switching / opening a tab that is *already* the active one → no-op, never
 *     prompt.
 *   - Closing a tab that isn't the active one → that tab has no live draft,
 *     never prompt.
 *   - Otherwise → prompt (navigation is leaving the active, guarded tab).
 */

export type GuardedAction = "navigate" | "close";

export function shouldPromptUnsavedGuard(input: {
	/** Whether the active tab registered an unsaved-changes check. */
	hasGuard: boolean;
	action: GuardedAction;
	/** The tab being navigated to, or closed. */
	targetId: string;
	activeId: string;
}): boolean {
	if (!input.hasGuard) return false;

	if (input.action === "close") {
		return input.targetId === input.activeId;
	}

	// navigate: a no-op switch to the current tab shouldn't prompt.
	return input.targetId !== input.activeId;
}

/**
 * Move the tab `tabId` to sit at gap `toIndex` (an insertion point in the
 * *current* array, `0` = before the first tab). Every tab is freely
 * reorderable — there is no pinned tab. Rules:
 *
 *   - Dropping a tab back where it already sits is a no-op — the same array is
 *     returned so React doesn't re-render the strip.
 */
export function reorderTabs<T extends { id: string }>(
	tabs: T[],
	tabId: string,
	toIndex: number,
): T[] {
	const from = tabs.findIndex((tab) => tab.id === tabId);
	if (from === -1) return tabs;

	// Gap right before or right after the tab's current slot → nothing moves.
	if (toIndex === from || toIndex === from + 1) return tabs;

	const moved = tabs[from];
	const without = tabs.filter((tab) => tab.id !== tabId);
	// `toIndex` indexes the original array; shift left when the removed tab sat
	// before the gap.
	const target = Math.max(
		0,
		Math.min(from < toIndex ? toIndex - 1 : toIndex, without.length),
	);

	without.splice(target, 0, moved);
	return without;
}
