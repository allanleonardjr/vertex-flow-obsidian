/**
 * Task ID generation (§3).
 *
 * Task filenames are IDs only, never titles (Golden Rule). Because the filename
 * *is* the ID, prefixes must be unique across the entire vault — two workspaces
 * sharing a prefix would produce identically-named files in different folders
 * and break Obsidian's short-form `[[wikilink]]` resolution.
 */

const VOWELS = /[aeiou]/i;
/** §3 allows 3–4; 3 is the default, matching the spec's own `Product Team` → `PRD`. */
const DEFAULT_PREFIX_LEN = 3;
const MAX_PREFIX_LEN = 4;

/**
 * Derive a prefix from a workspace name using its first N consonants.
 * `"Product Team"` → `"PRD"`, `"Marketing"` → `"MRK"`. Vowel-heavy or very
 * short names ("Ideas") top up from the raw letters so we always emit a
 * usable prefix.
 */
export function derivePrefix(
	workspaceName: string,
	length: number = DEFAULT_PREFIX_LEN,
): string {
	const want = Math.min(Math.max(length, DEFAULT_PREFIX_LEN), MAX_PREFIX_LEN);
	const letters = workspaceName.replace(/[^a-z]/gi, "");
	if (!letters) return "WRK";

	const chars: string[] = [];
	for (const ch of letters) {
		if (!VOWELS.test(ch)) chars.push(ch.toUpperCase());
		if (chars.length === want) break;
	}

	if (chars.length < want) {
		for (const ch of letters) {
			if (chars.length >= want) break;
			chars.push(ch.toUpperCase());
		}
	}

	return chars.join("").padEnd(DEFAULT_PREFIX_LEN, "X").slice(0, want);
}

/**
 * Resolve a prefix collision by appending a counter: `MKT` → `MKT2` → `MKT3`.
 * `taken` is every prefix already in use *anywhere in the vault*.
 */
export function disambiguatePrefix(
	desired: string,
	taken: Iterable<string>,
): string {
	const used = new Set(
		[...taken].map((p) => p.trim().toUpperCase()).filter(Boolean),
	);
	const base = desired.trim().toUpperCase();
	if (!used.has(base)) return base;

	for (let n = 2; n < 1000; n++) {
		const candidate = `${base}${n}`;
		if (!used.has(candidate)) return candidate;
	}
	throw new Error(`Unable to disambiguate ID prefix "${desired}"`);
}

/** Convenience: derive then disambiguate in one step. */
export function suggestPrefix(
	workspaceName: string,
	taken: Iterable<string>,
): string {
	return disambiguatePrefix(derivePrefix(workspaceName), taken);
}

/** One workspace's identity, as the index discovers it while scanning the vault. */
export interface WorkspacePrefixEntry {
	/** Vault path of the `_workspace.md` note — the key issues are reported against. */
	notePath: string;
	name: string;
	idPrefix: string;
}

export interface PrefixCollision {
	notePath: string;
	prefix: string;
	/** Names of the *other* workspaces sharing this prefix. */
	others: string[];
}

/**
 * Find workspaces that share an `idPrefix` (§3).
 *
 * Creation-time disambiguation (`suggestPrefix`) only guards prefixes the plugin
 * mints itself — a workspace folder copied in from elsewhere, or restored from
 * trash, can still collide. `linksMatch` leans on prefixes being unique
 * vault-wide to resolve short-form `[[wikilink]]`s, so a duplicate is a real
 * correctness bug, not a cosmetic one — but not a fatal one either: both
 * workspaces still load, and the collision is surfaced as a note issue.
 *
 * Returns one entry per colliding workspace (so each `_workspace.md` gets its
 * own issue), naming the others it clashes with.
 */
export function detectPrefixCollisions(
	workspaces: Iterable<WorkspacePrefixEntry>,
): PrefixCollision[] {
	const groups = new Map<string, WorkspacePrefixEntry[]>();
	for (const entry of workspaces) {
		const key = entry.idPrefix.trim().toUpperCase();
		if (!key) continue;
		const group = groups.get(key) ?? [];
		group.push(entry);
		groups.set(key, group);
	}

	const collisions: PrefixCollision[] = [];
	for (const [prefix, group] of groups) {
		if (group.length < 2) continue;
		for (const entry of group) {
			collisions.push({
				notePath: entry.notePath,
				prefix,
				others: group.filter((o) => o !== entry).map((o) => o.name),
			});
		}
	}
	return collisions;
}

export const ID_DIGITS = 4;

/** `("PRD", 104)` → `"PRD-0104"`. */
export function formatTaskId(prefix: string, sequence: number): string {
	return `${prefix.toUpperCase()}-${String(sequence).padStart(ID_DIGITS, "0")}`;
}

/** `"PRD-0104"` → `{ prefix: "PRD", sequence: 104 }`, or `null` if malformed. */
export function parseTaskId(
	id: string,
): { prefix: string; sequence: number } | null {
	const match = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(id.trim().toUpperCase());
	if (!match) return null;
	return { prefix: match[1], sequence: Number.parseInt(match[2], 10) };
}

/**
 * Next free ID for a workspace. Takes the max existing sequence rather than a
 * count, so deleting a task never causes a later task to reuse its ID.
 */
export function nextTaskId(prefix: string, existingIds: Iterable<string>): string {
	const target = prefix.toUpperCase();
	let max = 0;
	for (const id of existingIds) {
		const parsed = parseTaskId(id);
		if (parsed && parsed.prefix === target && parsed.sequence > max) {
			max = parsed.sequence;
		}
	}
	return formatTaskId(target, max + 1);
}

/**
 * Slugify a title into a taxonomy value id (`"In Progress"` → `"in-progress"`),
 * disambiguating against ids already present in that taxonomy.
 */
export function slugify(input: string, taken: Iterable<string> = []): string {
	const base =
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "value";
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let n = 2; n < 1000; n++) {
		if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
	}
	throw new Error(`Unable to slugify "${input}"`);
}
