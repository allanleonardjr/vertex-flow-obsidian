/**
 * Forgiving coercion helpers for hand-editable frontmatter.
 *
 * These notes are plain Markdown that users are explicitly encouraged to edit
 * by hand, sync across devices, and recover from git. So parsing is *forgiving*
 * by design: a malformed field degrades to a sensible default and records an
 * issue, rather than throwing and taking a view down with it.
 */

export interface ParseResult<T> {
	value: T;
	/** Human-readable problems, surfaced in the UI rather than thrown. */
	issues: string[];
}

export class IssueLog {
	readonly issues: string[] = [];

	add(message: string): void {
		this.issues.push(message);
	}

	/** Record an issue only when `condition` fails. */
	check(condition: boolean, message: string): boolean {
		if (!condition) this.add(message);
		return condition;
	}
}

export function asString(raw: unknown): string | null {
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
	return null;
}

export function asStringOr(raw: unknown, fallback: string): string {
	return asString(raw) ?? fallback;
}

export function asNumber(raw: unknown): number | null {
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string") {
		const parsed = Number.parseFloat(raw.trim());
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export function asBoolean(raw: unknown, fallback = false): boolean {
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "string") {
		const value = raw.trim().toLowerCase();
		if (value === "true" || value === "yes") return true;
		if (value === "false" || value === "no") return false;
	}
	return fallback;
}

/**
 * Normalize to a string array. A bare scalar becomes a one-element array —
 * `labels: bug` is what a human writes, and refusing it would be pedantic.
 */
export function asStringArray(raw: unknown): string[] {
	if (raw == null) return [];
	const items = Array.isArray(raw) ? raw : [raw];
	const out: string[] = [];
	for (const item of items) {
		const value = asString(item);
		if (value && !out.includes(value)) out.push(value);
	}
	return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;

/**
 * Accept `YYYY-MM-DD` and ISO datetimes, plus whatever the YAML parser already
 * turned into a `Date` (Obsidian's does this for unquoted dates).
 */
export function asDate(raw: unknown): string | null {
	if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
		return raw.toISOString().slice(0, 10);
	}
	const value = asString(raw);
	if (!value) return null;
	if (DATE_RE.test(value)) return value;
	if (DATETIME_RE.test(value)) return value;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function asDateTime(raw: unknown): string | null {
	if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
		return raw.toISOString();
	}
	const value = asString(raw);
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function asRecord(raw: unknown): Record<string, unknown> {
	return raw != null && typeof raw === "object" && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};
}

/** Drop null/undefined/empty-array entries so frontmatter stays uncluttered. */
export function compact(
	record: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (value == null) continue;
		if (Array.isArray(value) && value.length === 0) continue;
		out[key] = value;
	}
	return out;
}

export function nowIso(): string {
	return new Date().toISOString();
}
