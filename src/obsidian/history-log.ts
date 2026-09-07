/**
 * The Obsidian-half of activity history: turning pure keystrokes from the core
 * log format (`src/core/history/`) into real append-only files.
 *
 * Everything here is glue. It must never import the Obsidian-importing part of
 * `src/core` — there is none; the format, parsing and month rotation all live
 * in `src/core/history/` and are unit-tested there.
 *
 * Three behaviours worth spelling out:
 *
 *   - **Each Obsidian install owns a stream file per month.** The month file
 *     is `History/YYYY-MM.<device>.md`, where `<device>` is that install's own
 *     random token (from `localStorage`, never synced). Two machines sharing a
 *     synced vault therefore never rewrite the same file, so the classic
 *     read-modify-write race that drops entries — both read, both append, one
 *     write wins — disappears by construction. The reader merges every file in
 *     the `History/` folder and orders by timestamp.
 *   - **Appends are promise-chained.** `record` enqueues onto a single chain,
 *     so entries are written strictly in call order and can never interleave.
 *     This is the one place in the plugin where a `void`-style call is
 *     deliberately serialized.
 *   - **Timestamps are clamped monotonic per device.** There is no sequence
 *     number (see `src/core/history/`); two entries must never carry the same
 *     `ts` within one stream, or the file's order and the timeline could
 *     disagree. Each write's timestamp is `max(now, last+1ms)`, so the file's
 *     line order *is* the timeline even across a backward clock jump.
 */

import { HistoryActor, HistoryChange, HistoryTarget, IsoDate, WorkspaceConfig } from "../core/types";
import type { HistoryEntry } from "../core/types";
import {
	UNKNOWN_ACTOR_NAME,
	historyFolder,
	historyPathFor,
	parseHistoryLog,
	serializeEntryLine,
} from "../core/history";
import { NoteIO } from "./note-io";

/** An entry as the hub reads it, tagged with the stream file it came from. */
export interface LoggedEntry extends HistoryEntry {
	/** Stream file name (`2026-09.<device>.md`) — cheap cross-device tiebreak. */
	stream: string;
}

function selfActor(
	workspace: WorkspaceConfig,
	mePersonId: string | null,
): HistoryActor {
	if (mePersonId) {
		const person = workspace.people.find((p) => p.id === mePersonId);
		if (person) return { kind: "person", id: person.id, name: person.name };
	}
	// The app's `me` is unresolved in this workspace — no self person to credit.
	// This is absence, not a costume: `kind: "system"` is reserved for machine
	// writes, and a bracketed name keeps the Feed from reading it as a colleague.
	return { kind: "system", name: UNKNOWN_ACTOR_NAME };
}

interface RecordInput {
	action: string;
	targets?: HistoryTarget[];
	changes?: HistoryChange[];
	ts?: IsoDate;
	/** For machine-initiated writes the auto-archive sweep would pass here. */
	actorOverride?: HistoryActor;
}

export class HistoryLog {
	private chain: Promise<void> = Promise.resolve();
	private lastTs = 0;
	private initialized = false;
	private readonly listeners = new Set<() => void>();
	private version = 0;

	constructor(
		private readonly io: NoteIO,
		/** This install's never-synced random token; owns its own stream files. */
		readonly device: string,
		private readonly me: (workspaceRoot: string) => string | null,
		private readonly now: () => Date = () => new Date(),
	) {}

	/** Initialize lastTs from existing device stream files (lazy, one-time). */
	private async ensureInitialized(root: string): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		for (const file of this.io.listFiles(historyFolder(root))) {
			const fileName = file.path.slice(file.path.lastIndexOf("/") + 1);
			if (!fileName.endsWith("." + this.device + ".md")) continue;
			const text = await this.io.read(file);
			for (const entry of parseHistoryLog(text)) {
				const ts = new Date(entry.ts).getTime();
				if (ts > this.lastTs) this.lastTs = ts;
			}
		}
	}

	/** `max(now, last+1ms)` so no two entries in a stream share a timestamp. */
	private async nextTs(root: string): Promise<IsoDate> {
		await this.ensureInitialized(root);
		const millis = Math.max(this.now().getTime(), this.lastTs + 1);
		this.lastTs = millis;
		return new Date(millis).toISOString();
	}

	/**
	 * Subscribe to log writes. The React layer uses this (via `revision`, the
	 * same `useSyncExternalStore` pattern the vault index uses) so a mutation
	 * in any other tab repaints the History hub live — no tab-switch needed.
	 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Monotonic version counter, bumped once per record/seed. */
	get revision(): number {
		return this.version;
	}

	private touch(): void {
		this.version += 1;
		for (const listener of this.listeners) listener();
	}

	/**
	 * Append one entry for a human action, when the workspace has history
	 * enabled. Fire-and-forget: the caller's mutation should not wait on a log
	 * write to feel done, and the internal chain keeps ordering deterministic.
	 */
	record(workspace: WorkspaceConfig, input: RecordInput): void {
		if (!workspace.history.enabled) return;

		const action = input.action;
		const actor =
			input.actorOverride ?? selfActor(workspace, this.me(workspace.root));
		const targets = input.targets ?? [];
		const changes = input.changes;

		// The entry is built *inside* the chain so its timestamp is stamped in
		// write order, keeping the file's line order equal to its timeline.
		this.chain = this.chain.then(async () => {
			const ts = await this.nextTs(workspace.root);
			const entry: HistoryEntry = {
				ts,
				actor,
				action,
				workspace: workspace.root,
				targets,
				...(changes?.length ? { changes } : {}),
			};
			await this.io.append(
				historyPathFor(workspace.root, ts, this.device),
				serializeEntryLine(entry),
			);
		});
		this.touch();
	}

	/**
	 * Write a pre-built set of entries in one flush — the onboarding demo log.
	 * Entries are appended oldest-first into the creating device's stream files
	 * (forward-dated into their own months), the parser's leniency absorbs any
	 * overlap with an existing month, and timestamps are clamped monotonic just
	 * like `record`. Fire-and-forget like `record()`: returns the chained
	 * promise for callers that want to await it, but workspace creation doesn't
	 * need to — the chain flushes before any `readEntries` resolves.
	 */
	seed(root: string, entries: HistoryEntry[]): Promise<void> {
		return (this.chain = this.chain.then(async () => {
			await this.ensureInitialized(root);
			for (const entry of entries) {
				const ts = await this.nextTs(root);
				await this.io.append(
					historyPathFor(root, ts, this.device),
					serializeEntryLine({ ...entry, ts }),
				);
			}
			this.touch();
		}));
	}

	/**
	 * Every entry a workspace has ever recorded, oldest first. Flushes any
	 * chained writes first, so a just-completed mutation is always visible.
	 */
	async readEntries(root: string): Promise<LoggedEntry[]> {
		await this.chain;
		const entries: LoggedEntry[] = [];
		for (const file of this.io.listFiles(historyFolder(root))) {
			const fileName = file.path.slice(file.path.lastIndexOf("/") + 1);
			const stream = fileName.slice(0, fileName.lastIndexOf(".md")).split(".")[1] ?? fileName;
			for (const entry of parseHistoryLog(await this.io.read(file))) {
				entries.push({ ...entry, stream });
			}
		}
		return entries.sort(
			(a, b) =>
				a.ts.localeCompare(b.ts) || a.stream.localeCompare(b.stream),
		);
	}
}