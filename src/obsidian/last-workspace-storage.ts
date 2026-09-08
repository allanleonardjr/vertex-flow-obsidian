/**
 * The workspace root this device last had active, so relaunching the plugin
 * reopens where you left off instead of always landing on the first workspace.
 *
 * Held in `localStorage`, never in `data.json` or any vault file — for the same
 * reason as `me-storage.ts` and `device-id.ts`: a shared/synced vault must not
 * carry one machine's "which workspace was I looking at" onto every other
 * machine. Keyed per vault (Obsidian's `app.appId`) so two vaults opened on the
 * same machine can't collide.
 *
 * Every function degrades gracefully: unavailable storage (private mode, mobile
 * quirks) yields `null` / a no-op, never a throw. A stored root that no longer
 * resolves in the index is simply ignored by the caller — `activeWorkspace()`
 * and `useActiveWorkspace()` both fall back to the first workspace — so a
 * deleted or renamed workspace needs no migration here.
 */

const KEY_BASE = "vertex-flow-last-workspace";

let vaultId = "";

/** Called once from `main.ts` onload with `app.appId`. */
export function configureLastWorkspaceStorage(
	id: string | undefined | null,
): void {
	vaultId = id ? String(id) : "";
}

function key(): string {
	return `${KEY_BASE}:${vaultId}`;
}

/** The workspace root this device last had active, or `null` when unset or
 *  storage is unavailable. Not validated against the index — the caller does
 *  that by resolving it and falling back. */
export function getLastWorkspaceRoot(): string | null {
	try {
		const value = window.localStorage.getItem(key());
		return value && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

/** Remember (or, with `null`, forget) the active workspace root for this
 *  device. No-op if storage is unavailable. */
export function setLastWorkspaceRoot(root: string | null): void {
	try {
		if (root) window.localStorage.setItem(key(), root);
		else window.localStorage.removeItem(key());
	} catch {
		// Storage unavailable — the pointer just doesn't persist this session.
	}
}
