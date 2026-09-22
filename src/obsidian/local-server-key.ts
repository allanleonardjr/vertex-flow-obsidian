/**
 * Local model server API key — held **per device**, never in `data.json`.
 *
 * Most local servers (LM Studio, Ollama, Jan) need no key at all, but some do
 * (llama.cpp's `--api-key`, a remote custom URL), and AI Chat then sends it as
 * `Authorization: Bearer <key>`. It's a secret, and `data.json` syncs with the
 * vault, so it's kept exactly where the MCP token is (see `mcp-token.ts`):
 * `localStorage`, which lives in the app's own data dir and never reaches any
 * sync layer.
 *
 * The key is prefixed with the stable per-vault `app.appId` (set once at plugin
 * load via `configureLocalServerKeyStorage`), so two vaults on the same machine
 * can't collide. Every function degrades gracefully: unavailable storage yields
 * `""` / a no-op, never a throw.
 */

const KEY_BASE = "vertex-flow-local-server-key";

let vaultId = "";

/** Called once from `main.ts` onload with `app.appId`. */
export function configureLocalServerKeyStorage(id: string | undefined | null): void {
	vaultId = id ? String(id) : "";
}

function storageKey(): string {
	return `${KEY_BASE}:${vaultId}`;
}

/** The stored API key, or `""` when unset (send no `Authorization` header) or storage is unavailable. */
export function getLocalServerKey(): string {
	try {
		return window.localStorage.getItem(storageKey()) ?? "";
	} catch {
		return "";
	}
}

/** Store the API key; an empty string clears it. No-op if storage is unavailable. */
export function setLocalServerKey(key: string): void {
	try {
		if (key) window.localStorage.setItem(storageKey(), key);
		else window.localStorage.removeItem(storageKey());
	} catch {
		// Storage unavailable — the key won't stick this session.
	}
}
