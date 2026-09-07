/**
 * The activity-history log format — pure, unit-testable, Obsidian-free.
 *
 * Golden Rule: nothing under `src/core/` imports the Obsidian API, and this
 * file is the inside of that envelope. It decides *what a log looks like*;
 * `src/obsidian/history-log.ts` (outside the envelope) decides where the files
 * live and when to append to them.
 *
 * ## Format
 *
 * Each workspace keeps an append-only log under its own `History/` folder. The
 * writer shards by device (`History/2026-09.<device>.md`) so a vault synced
 * across machines never has two Obsidian instances rewriting the same file —
 * each device appends only to its own stream, and the reader merges everything
 * in the folder. Each entry is a single line of flow-style YAML — a
 * `- { … }` sequence item — so appending is a true O(1) file append and the
 * whole stream parses back into the entry array:
 *
 *     - { ts: 2026-09-05T14:32:00Z, actor: { kind: person, id: allan, name: Allan }, action: task.update, workspace: WS, targets: [ { kind: task, id: TSK-0104, path: WS/Tasks/TSK-0104} ], changes: [ { field: status, from: backlog, to: started} ] }
 *
 * There is deliberately **no sequence number**. Within a stream the writer
 * stamps strictly increasing timestamps, so the file's line order *is* the
 * timeline; across streams the reader sorts by `ts` and file name. A sequence
 * ordinal would be per-stream anyway (every device would restart at 1) and
 * buys nothing a monotonic timestamp doesn't.
 *
 * `yaml` is the one runtime dependency `src/core/` may take (the markdown
 * template parser already uses it), and its flow-style `stringify` quotes
 * values as needed, so hand-written entries — someone *will* paste a name
 * containing a colon — stay parseable.
 *
 * Parsing is deliberately forgiving: a line a human mangled, or a whole file
 * that isn't a YAML list, degrades to fewer entries rather than throwing.
 * The log is a best-effort record, never something that should take a view
 * down because a sync conflict or an over-zealous edit broke one line.
 */

import { parse, stringify } from "yaml";
import { joinPath } from "../links";
import type { HistoryEntry, HistoryChange, HistoryTarget } from "../types";

/** The folder name inside a workspace root that holds the log files. */
export const HISTORY_FOLDER = "History";

/**
 * Machine writes (the onboarding seed, a future recurring-task engine) sign
 * with a bracketed handle — deliberately the sort of thing nobody types into a
 * People-register field, so the Feed's actor chips never read as a colleague.
 */
export const SYSTEM_ACTOR_NAME = "[system]";

/**
 * A human action recorded when this device's "me" personId doesn't resolve
 * into this workspace's roster. Also bracketed: absence of identity, not a
 * colleague named "unknown".
 */
export const UNKNOWN_ACTOR_NAME = "[unknown]";

/** `"2026-09"` for "September 2026" — the log rotates monthly. */
export function monthKey(iso: string): string {
	return iso.slice(0, 7);
}

/**
 * The log stream file for the device that owns this write: `<root>/History/
 * YYYY-MM.<device>.md`. Each Obsidian install has its own random `device` token
 * (never synced), so two synced machines never rewrite the same file — the
 * read-modify-write race that would drop entries disappears by construction.
 */
export function historyPathFor(
	root: string,
	ts: string,
	device: string,
): string {
	return `${joinPath(root, HISTORY_FOLDER, `${monthKey(ts)}.${device}`)}.md`;
}

/**
 * `<root>/History` — the folder holding every device stream of the log.
 * `readEntries` merges all of them.
 */
export function historyFolder(root: string): string {
	return joinPath(root, HISTORY_FOLDER);
}

/**
 * One entry → one parseable line (terminated with `\n`). Written verbatim by
 * the append-only writer, so the month file is just lines.
 */
export function serializeEntryLine(entry: HistoryEntry): string {
	// `stringify` with `flow: true` renders the entry as flow YAML. Line
	// breaks inside the flow are formatting, so they're flattened to spaces —
	// flow-style scalars never contain a literal newline, so crushing them
	// cannot corrupt a value. The `- ` prefix makes the line a sequence item,
	// which is what lets `parseHistoryLog` see the file as a list.
	const flow = stringify([entry], { flow: true })
		.replace(/^\[/, "")
		.replace(/\]\s*$/, "")
		.replace(/^[ \t]*\n?/, "")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n/g, " ")
		.trim();
	return `- ${flow}\n`;
}

/**
 * Parse one stream file back into entries. Order preserved (a stream is
 * written oldest-first, so callers can keep it and sort chronologically).
 *
 * Forgiving by design, one line at a time: each entry is one line, so a single
 * mangled line is dropped while the rest of the stream survives. A whole file
 * that isn't a log still yields `[]` instead of throwing — the log is a
 * best-effort record, never something that should take a view down because a
 * sync conflict or an over-zealous edit broke it.
 */
export function parseHistoryLog(text: string): HistoryEntry[] {
	if (!text || !text.trim()) return [];
	const entries: HistoryEntry[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = parse(trimmed);
		} catch {
			continue;
		}
		// A line is written as `- { … }` (a one-element sequence); a hand-edit
		// may have stripped the dash, leaving a bare flow map. Accept both.
		const item: unknown = Array.isArray(parsed)
			? ((parsed as unknown[])[0] ?? parsed)
			: parsed;
		if (isHistoryEntry(item)) entries.push(item);
	}
	return entries;
}

function isHistoryEntry(raw: unknown): raw is HistoryEntry {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
	const entry = raw as Record<string, unknown>;
	return (
		typeof entry.ts === "string" &&
		typeof entry.action === "string" &&
		typeof entry.workspace === "string" &&
		isActor(entry.actor) &&
		Array.isArray(entry.targets) &&
		entry.targets.every(isTarget) &&
		(entry.changes === undefined ||
			(Array.isArray(entry.changes) && entry.changes.every(isChange)))
	);
}

function isActor(raw: unknown): boolean {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
	const actor = raw as Record<string, unknown>;
	if (actor.kind === "system") return typeof actor.name === "string";
	return (
		actor.kind === "person" &&
		typeof actor.id === "string" &&
		typeof actor.name === "string"
	);
}

function isTarget(raw: unknown): raw is HistoryTarget {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
	const target = raw as Record<string, unknown>;
	return (
		typeof target.kind === "string" &&
		typeof target.id === "string" &&
		typeof target.path === "string"
	);
}

function isChange(raw: unknown): raw is HistoryChange {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
	const change = raw as Record<string, unknown>;
	// `from`/`to` are optional (a description body diff, or a removal), so the
	// observable contract is just that a field is named.
	return typeof change.field === "string";
}

/** True when the JSON-ized forms differ — the durable comparison for values
 *  that may be arrays (`labels`) or plain objects. */
export function valuesDiffer(a: unknown, b: unknown): boolean {
	if (a === b) return false;
	if (
		typeof a === "number" &&
		typeof b === "number" &&
		Number.isNaN(a) &&
		Number.isNaN(b)
	) {
		return false;
	}
	return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}