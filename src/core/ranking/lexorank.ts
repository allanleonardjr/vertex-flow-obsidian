/**
 * LexoRank — fractional indexing over lexicographically-sortable strings.
 *
 * Format (Atlassian-compatible, matching the schema in `vault-schema.md`):
 *
 *     0|i00004:
 *     ^ ^      ^
 *     | |      └── decimal part (variable length, may be empty)
 *     | └───────── integer part (always 6 base-36 digits)
 *     └─────────── bucket
 *
 * The sortable payload is `integer + ':' + decimal`. Because the integer part is
 * a fixed 6 characters, `':'` always lands at index 6, so a plain lexicographic
 * string comparison of the payload *is* the numeric ordering — that is the whole
 * point of the format. (`':'` is ASCII 58, above `0`–`9` and below `a`–`z`, so a
 * shorter decimal correctly sorts before a longer one that extends it.)
 *
 * Buckets exist in the format for future rebalancing. v1 writes bucket 0 only
 * and ignores the bucket when comparing; see `needsRebalance()`.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length; // 36
const HALF = BASE / 2; // 18 → 'i'
const INT_LEN = 6;

const MIN_INT = "0".repeat(INT_LEN);
const MAX_INT = "z".repeat(INT_LEN);
const MID_INT = ALPHABET[HALF] + "0".repeat(INT_LEN - 1); // "i00000"

export const DEFAULT_BUCKET = "0";

/** Lowest representable rank. Nothing may sort before this. */
export const MIN_RANK = `${DEFAULT_BUCKET}|${MIN_INT}:`;
/** Highest representable rank. Nothing may sort after this. */
export const MAX_RANK = `${DEFAULT_BUCKET}|${MAX_INT}:`;
/** The rank a lone first item receives. */
export const MIDDLE_RANK = `${DEFAULT_BUCKET}|${MID_INT}:`;

/**
 * Decimal length past which the engine recommends a rebalance. Fractional
 * indexing grows the decimal by one digit whenever two neighbours are adjacent;
 * in practice this only happens after thousands of insertions at one spot.
 */
export const REBALANCE_THRESHOLD = 24;

const RANK_RE = /^(\d)\|([0-9a-z]{6}):([0-9a-z]*)$/;

export interface ParsedRank {
	bucket: string;
	int: string;
	dec: string;
}

export function isValidRank(value: unknown): value is string {
	return typeof value === "string" && RANK_RE.test(value);
}

export function parseRank(value: string): ParsedRank {
	const match = RANK_RE.exec(value);
	if (!match) throw new Error(`Invalid LexoRank: ${JSON.stringify(value)}`);
	return { bucket: match[1], int: match[2], dec: match[3] };
}

function formatRank(bucket: string, digits: number[]): string {
	const chars = digits.map((d) => ALPHABET[d]);
	const int = chars.slice(0, INT_LEN).join("");
	// Trailing zeros in the decimal are meaningless; drop them so equal values
	// always have one canonical spelling.
	const dec = chars.slice(INT_LEN).join("").replace(/0+$/, "");
	return `${bucket}|${int}:${dec}`;
}

/** The lexicographically-comparable payload of a rank (bucket stripped). */
function payload(value: string): string {
	const { int, dec } = parseRank(value);
	return `${int}:${dec}`;
}

/**
 * Sort comparator. Ignores the bucket — v1 never mixes buckets, and comparing
 * them would make a future rebalance's rotation change existing order.
 */
export function compareRanks(a: string, b: string): number {
	const pa = payload(a);
	const pb = payload(b);
	return pa < pb ? -1 : pa > pb ? 1 : 0;
}

function toDigits(value: string): number[] {
	const { int, dec } = parseRank(value);
	return [...(int + dec)].map((ch) => ALPHABET.indexOf(ch));
}

function padTo(digits: number[], length: number): number[] {
	return digits.length >= length
		? digits.slice()
		: digits.concat(new Array(length - digits.length).fill(0));
}

function compareDigits(a: number[], b: number[]): number {
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const da = a[i] ?? 0;
		const db = b[i] ?? 0;
		if (da !== db) return da < db ? -1 : 1;
	}
	return 0;
}

/**
 * Midpoint of two equal-length base-36 fixed-point digit arrays, where `a < b`.
 * If the two are adjacent (no room between them) the result gains one extra
 * digit — that is the "fractional" in fractional indexing.
 */
function midpointDigits(a: number[], b: number[]): number[] {
	const len = Math.max(a.length, b.length);
	const left = padTo(a, len);
	const right = padTo(b, len);

	// sum = left + right, with `overflow` holding the carry out of digit 0.
	const sum = new Array<number>(len).fill(0);
	let carry = 0;
	for (let i = len - 1; i >= 0; i--) {
		const total = left[i] + right[i] + carry;
		sum[i] = total % BASE;
		carry = Math.floor(total / BASE);
	}
	const overflow = carry;

	// half = sum / 2, long-division style, most significant digit first.
	const half = new Array<number>(len).fill(0);
	let remainder = overflow;
	for (let i = 0; i < len; i++) {
		const current = remainder * BASE + sum[i];
		half[i] = Math.floor(current / 2);
		remainder = current % 2;
	}
	if (remainder > 0) half.push(HALF);

	// Exactly-adjacent neighbours floor to `a`; extend precision instead.
	if (compareDigits(half, left) <= 0) return left.concat([HALF]);
	return half;
}

/**
 * Produce a rank strictly between `prev` and `next`.
 *
 * - `between(null, null)` → the middle of the space
 * - `between(prev, null)` → after `prev` (append to a list)
 * - `between(null, next)` → before `next` (prepend to a list)
 *
 * Throws if `prev >= next`, which always indicates a caller bug (neighbours
 * passed out of order) rather than recoverable data corruption.
 */
export function rankBetween(
	prev: string | null | undefined,
	next: string | null | undefined,
): string {
	const lo = prev ?? MIN_RANK;
	const hi = next ?? MAX_RANK;

	if (!isValidRank(lo)) throw new Error(`Invalid LexoRank: ${String(prev)}`);
	if (!isValidRank(hi)) throw new Error(`Invalid LexoRank: ${String(next)}`);

	if (prev == null && next == null) return MIDDLE_RANK;

	if (compareRanks(lo, hi) >= 0) {
		throw new Error(
			`rankBetween requires prev < next (got ${lo} and ${hi})`,
		);
	}

	const bucket = parseRank(lo).bucket;
	return formatRank(bucket, midpointDigits(toDigits(lo), toDigits(hi)));
}

/** Shorthand for appending after a known last rank. */
export function rankAfter(prev: string | null): string {
	return rankBetween(prev, null);
}

/** Shorthand for prepending before a known first rank. */
export function rankBefore(next: string | null): string {
	return rankBetween(null, next);
}

/**
 * `count` evenly-spaced ranks across the whole space — used when seeding a
 * workspace or importing tasks in bulk. Evenly spacing keeps plenty of room for
 * later insertions anywhere in the list.
 */
export function initialRanks(count: number): string[] {
	if (count <= 0) return [];
	if (count === 1) return [MIDDLE_RANK];

	// Spread across the full 6-digit integer space (36^6 ≈ 2.2e9 slots), which
	// is far more headroom than any realistic bulk import needs.
	const space = BASE ** INT_LEN;
	const step = Math.max(1, Math.floor(space / (count + 1)));
	const ranks: string[] = [];
	for (let i = 1; i <= count; i++) {
		let value = step * i;
		const digits = new Array<number>(INT_LEN).fill(0);
		for (let d = INT_LEN - 1; d >= 0; d--) {
			digits[d] = value % BASE;
			value = Math.floor(value / BASE);
		}
		ranks.push(formatRank(DEFAULT_BUCKET, digits));
	}
	return ranks;
}

/**
 * The rank an item should take to land at `toIndex` in `ordered` — the list of
 * the *other* items' ranks, already sorted ascending and with the moved item
 * removed.
 */
export function rankForPosition(ordered: string[], toIndex: number): string {
	const index = Math.max(0, Math.min(toIndex, ordered.length));
	const prev = index > 0 ? ordered[index - 1] : null;
	const next = index < ordered.length ? ordered[index] : null;
	return rankBetween(prev, next);
}

/** Ascending sort by rank, stable, non-mutating. */
export function sortByRank<T>(items: T[], getRank: (item: T) => string): T[] {
	return items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => {
			const cmp = compareRanks(getRank(a.item), getRank(b.item));
			return cmp !== 0 ? cmp : a.index - b.index;
		})
		.map((entry) => entry.item);
}

/**
 * Whether a rank's decimal has grown long enough to be worth rebalancing.
 * v1 only reports this; accepts last-write-wins and defers real rebalancing.
 */
export function needsRebalance(value: string): boolean {
	return isValidRank(value) && parseRank(value).dec.length >= REBALANCE_THRESHOLD;
}
