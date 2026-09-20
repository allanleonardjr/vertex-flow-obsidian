/**
 * Whether this device's AI Chat tab was open the last time Obsidian closed —
 * used only to decide whether a fresh launch is worth a background model warm
 * (see `main.ts`'s `onload`). Mirrors `last-workspace-storage.ts` exactly.
 *
 * Held in `localStorage`, never in `data.json` or any vault file — same
 * reasoning as `last-workspace-storage.ts`/`me-storage.ts`: a shared/synced
 * vault must not carry one machine's UI state onto every other machine. Keyed
 * per vault (Obsidian's `app.appId`) so two vaults opened on the same machine
 * can't collide.
 *
 * Every function degrades gracefully: unavailable storage (private mode,
 * mobile quirks) yields `false` / a no-op, never a throw.
 */

const KEY_BASE = "vertex-flow-ai-chat-tab-open";

let vaultId = "";

/** Called once from `main.ts` onload with `app.appId`. */
export function configureAiChatTabStorage(id: string | undefined | null): void {
	vaultId = id ? String(id) : "";
}

function key(): string {
	return `${KEY_BASE}:${vaultId}`;
}

/** Whether the AI Chat tab was open on this device the last time it was recorded — `false` when unset or storage is unavailable. */
export function wasAiChatTabOpen(): boolean {
	try {
		return window.localStorage.getItem(key()) === "true";
	} catch {
		return false;
	}
}

/** Record whether the AI Chat tab is currently open on this device. No-op if storage is unavailable. */
export function setAiChatTabOpen(open: boolean): void {
	try {
		if (open) window.localStorage.setItem(key(), "true");
		else window.localStorage.removeItem(key());
	} catch {
		// Storage unavailable — the flag just doesn't persist this session.
	}
}
