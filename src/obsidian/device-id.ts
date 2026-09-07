/**
 * A stable per-install device token, owned by this Obsidian install alone.
 *
 * It powers the history log's per-device stream files: `History/YYYY-MM.<device>.md`.
 * For that to work the token must be *unique to this install* and *never reach
 * the other end of a vault sync* — if two machines shared one token they'd race
 * the same file again. `localStorage` is the holding place: it persists in the
 * app's own data dir, not in the vault, so iCloud/iDrive/Dropbox never see it.
 *
 * No longer available (storage cleared) yields a fresh token rather than an
 * error; the old stream file is simply still read-and-merged by the hub, so
 * nothing is lost, just split.
 */

const STORAGE_KEY = "vertex-flow-device";

export function deviceId(): string {
	try {
		const existing = window.localStorage.getItem(STORAGE_KEY);
		if (existing) return existing;
		const fresh = randomToken();
		window.localStorage.setItem(STORAGE_KEY, fresh);
		return fresh;
	} catch {
		// Storage unavailable (private mode / mobile quirk): fall back to an
		// in-memory token. It resets next launch, spawning a new stream each
		// run — merged by the reader, so still no loss.
		return randomToken();
	}
}

/** 8 chars of base-36 entropy — distinct enough for file names. */
function randomToken(): string {
	let out = "";
	const bytes = new Uint8Array(8);
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	for (const byte of bytes) {
		out += Math.floor(byte / (256 / 36)).toString(36);
	}
	return out;
}