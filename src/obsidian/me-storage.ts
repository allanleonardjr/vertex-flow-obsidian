/**
 * "Who am I" — the roster `Person.id` that `SELF` filters and the history-log
 * actor resolve against — held **per device, per workspace**.
 *
 * Why this exists, and why it must never touch `data.json` or any vault file:
 * vaults are now shared between real collaborators (iCloud/Drive/raw folder
 * sync), and `data.json` syncs with the vault. A single global "me" value there
 * means whichever collaborator last saved their setting silently overwrites
 * everyone else's — corrupting `SELF` results and actor attribution for the
 * whole team. This is the same class of problem `device-id.ts` solved for the
 * history log's per-device stream tokens, with the same fix: `localStorage`
 * persists in the app's own data dir, not in the vault, so no sync layer ever
 * sees it.
 *
 * Keyed **per workspace**, not one flat value, because roster `Person.id`s are
 * generated independently per workspace — a single `personId` isn't guaranteed
 * to mean the same person across two workspaces.
 *
 * The key is also prefixed with a stable per-vault identifier (Obsidian's
 * `app.appId`) so two different vaults opened on the same machine can never
 * collide even if they happen to hold a workspace at the same relative path.
 *
 * Every function degrades gracefully: unavailable storage (private mode, mobile
 * quirks) yields `null` / a no-op, never a throw — exactly like `deviceId()`.
 */

const PERSON_KEY_BASE = "vertex-flow-me";
const PREFILL_KEY_BASE = "vertex-flow-me-prefill";
const BANNER_DISMISSED_KEY_BASE = "vertex-flow-me-banner-dismissed";

/**
 * The stable per-vault id, set once at plugin load from `app.appId`. Kept in a
 * module cache so the storage helpers can stay parameter-light (`getMePersonId(root)`)
 * and free of any Obsidian import.
 */
let vaultId = "";

/** Called once from `main.ts` onload with `app.appId`. */
export function configureMeStorage(id: string | undefined | null): void {
	vaultId = id ? String(id) : "";
}

// --- Reactivity -----------------------------------------------------------
//
// `localStorage` reads aren't reactive, but every write goes through a setter
// in this module, so the setters fan out to subscribers. Obsidian is a single
// renderer window, so one in-memory Set reaches every open pane. `meRevision`
// is the change token `useSyncExternalStore` compares (see `src/ui/useMe.ts`).

type MeListener = () => void;
const meListeners = new Set<MeListener>();
let meRevision = 0;

/** Subscribe to any "me" change — the workspace personId map or a banner
 *  dismissal. Returns an unsubscribe. */
export function subscribeMe(listener: MeListener): () => void {
	meListeners.add(listener);
	return () => {
		meListeners.delete(listener);
	};
}

/** Monotonic token, bumped once per write. */
export function meStoreRevision(): number {
	return meRevision;
}

function notifyMeChange(): void {
	meRevision += 1;
	for (const listener of meListeners) listener();
}

/** A small convenience default for new workspaces and the native settings tab —
 *  never a source of truth for `SELF` resolution. */
export interface MePrefill {
	name?: string;
	aliases?: string[];
}

function personKey(): string {
	return `${PERSON_KEY_BASE}:${vaultId}`;
}

function prefillKey(): string {
	return `${PREFILL_KEY_BASE}:${vaultId}`;
}

function bannerKey(): string {
	return `${BANNER_DISMISSED_KEY_BASE}:${vaultId}`;
}

function readMap(): Record<string, string> {
	try {
		const raw = window.localStorage.getItem(personKey());
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		return parsed as Record<string, string>;
	} catch {
		return {};
	}
}

/** The roster `Person.id` this device treats as "me" in the given workspace,
 *  or `null` when unset or storage is unavailable. */
export function getMePersonId(workspaceRoot: string): string | null {
	const map = readMap();
	const value = map[workspaceRoot];
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Set (or, with `null`, clear) this device's "me" for one workspace. No-op if
 *  storage is unavailable. */
export function setMePersonId(
	workspaceRoot: string,
	personId: string | null,
): void {
	try {
		const map = readMap();
		if (personId) map[workspaceRoot] = personId;
		else delete map[workspaceRoot];
		window.localStorage.setItem(personKey(), JSON.stringify(map));
	} catch {
		// Storage unavailable — "me" simply doesn't stick this session.
	}
	// Any deliberate change to "me" resets the "you haven't set who you are"
	// banner dismissal for this workspace: clearing it (person deleted / unset)
	// must bring the nudge back, and re-setting it starts a fresh slate for the
	// next time it goes unset.
	writeBannerDismissed(workspaceRoot, false);
	notifyMeChange();
}

/** The cross-workspace prefill (name/aliases), or `null`. Convenience only. */
export function getMePrefill(): MePrefill | null {
	try {
		const raw = window.localStorage.getItem(prefillKey());
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		return parsed;
	} catch {
		return null;
	}
}

/** Store the prefill. No-op if storage is unavailable. */
export function setMePrefill(prefill: MePrefill | null): void {
	try {
		if (prefill) {
			window.localStorage.setItem(prefillKey(), JSON.stringify(prefill));
		} else {
			window.localStorage.removeItem(prefillKey());
		}
	} catch {
		// Storage unavailable — no prefill persisted.
	}
}

// --- "Who are you?" nudge banner: per-workspace dismiss state ---------------
//
// The banner shows only while "me" is unset for a workspace; a viewer can
// dismiss it to stop the nudge without setting an identity. `setMePersonId`
// clears this whenever "me" changes, so a dismissal can never permanently
// hide a genuinely-unset workspace (see there).

function readDismissed(): Record<string, true> {
	try {
		const raw = window.localStorage.getItem(bannerKey());
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		return parsed as Record<string, true>;
	} catch {
		return {};
	}
}

/** Has this device dismissed the "who are you?" banner for this workspace? */
export function isMeBannerDismissed(workspaceRoot: string): boolean {
	return readDismissed()[workspaceRoot] === true;
}

function writeBannerDismissed(workspaceRoot: string, dismissed: boolean): void {
	try {
		const map = readDismissed();
		if (dismissed) map[workspaceRoot] = true;
		else delete map[workspaceRoot];
		window.localStorage.setItem(bannerKey(), JSON.stringify(map));
	} catch {
		// Storage unavailable — dismissal doesn't stick this session.
	}
}

/** Set (or clear) the banner-dismissed flag for one workspace. No-op if
 *  storage is unavailable. */
export function setMeBannerDismissed(
	workspaceRoot: string,
	dismissed: boolean,
): void {
	writeBannerDismissed(workspaceRoot, dismissed);
	notifyMeChange();
}
