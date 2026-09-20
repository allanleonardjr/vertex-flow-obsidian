/**
 * MCP server bearer token — held **per device**, never in `data.json`.
 *
 * Why: `data.json` syncs with the vault. The MCP token is a secret that
 * authorizes read access to a workspace's whole contents through the local HTTP
 * endpoint; carrying it in synced settings would mean every collaborator's
 * device learns the secret whenever anyone regenerates it. Same class of bug —
 * and the same fix — as `me-storage.ts`: `localStorage` lives in the app's own
 * data dir, not in the vault, so no sync layer ever sees it.
 *
 * The key is prefixed with the stable per-vault `app.appId` (set once at plugin
 * load via `configureMcpTokenStorage`), so two different vaults on the same
 * machine can't collide the way a flat key would.
 *
 * Every function degrades gracefully: unavailable storage (private mode, mobile
 * quirks) yields `null` / a no-op, never a throw — exactly like `me-storage`.
 */

const TOKEN_KEY_BASE = "vertex-flow-mcp-token";

let vaultId = "";

/** Called once from `main.ts` onload with `app.appId`. */
export function configureMcpTokenStorage(id: string | undefined | null): void {
	vaultId = id ? String(id) : "";
}

function tokenKey(): string {
	return `${TOKEN_KEY_BASE}:${vaultId}`;
}

/** The current bearer token, or `null` when unset or storage is unavailable. */
export function getMcpToken(): string | null {
	try {
		const raw = window.localStorage.getItem(tokenKey());
		if (!raw) return null;
		return raw.length > 0 ? raw : null;
	} catch {
		return null;
	}
}

/** Store a new token, or (with `null`) clear it. No-op if storage is unavailable. */
export function setMcpToken(token: string | null): void {
	try {
		if (token) window.localStorage.setItem(tokenKey(), token);
		else window.localStorage.removeItem(tokenKey());
	} catch {
		// Storage unavailable — the token won't stick this session.
	}
}

/**
 * A fresh opaque token: `crypto.getRandomValues` in the renderer (available in
 * both Electron and the mobile WebView), hex-encoded. 32 bytes → 64 chars.
 */
export function generateMcpToken(): string {
	const bytes = new Uint8Array(32);
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		crypto.getRandomValues(bytes);
	} else {
		// Last-resort fallback acceptable only because this is an offline,
		// localhost-only access token, not a credential for a remote service.
		for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}