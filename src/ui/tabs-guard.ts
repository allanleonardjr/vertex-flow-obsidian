/**
 * The pure decision behind the tab strip's unsaved-changes guard, split out of
 * `tabs-context.tsx` so it can be unit-tested (the React wiring around it
 * can't).
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
