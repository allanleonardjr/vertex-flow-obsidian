/**
 * The Obsidian-half of activity history: turning pure keystrokes from the core
 * log format (`src/core/history/`) into real append-only files.
 *
 * Everything here is glue. It must never import the Obsidian-importing part of
 * `src/core` — there is none; the format, parsing and month rotation all live
 * in `src/core/history/` and are unit-tested there.
 *
 * Two behaviours worth spelling out:
 *
 *   - **Appends are promise-chained.** `record` enqueues onto a single chain,
 *     so entries are written strictly in call order and the per-month `seq`
 *     counter can never interleave. This is the one place in the plugin where
 *     a `void`-style call is deliberately serialized.
 *   - **`seq` seeds from the file on a session's first write to a month.**
 *     The counter is per-session in-memory; reading the file back lets a
 *     pre-existing month keep counting past wherever it stopped. Two OS
 *     processes racing a brand-new month both write `seq: 1` — fine, `seq` is
 *     ordering candy, not an id.
 */

import { HistoryActor, HistoryChange, HistoryTarget, IsoDate, WorkspaceConfig } from "../core/types";
import type { HistoryEntry } from "../core/types";
import {
	UNKNOWN_ACTOR_NAME,
	historyFolder,
	historyPathFor,
	monthKey,
	parseHistoryLog,
	serializeEntryLine,
} from "../core/history";
import { NoteIO } from "./note-io";

function selfActor(workspace: WorkspaceConfig): HistoryActor {
	const self = workspace.people.find((person) => person.isSelf);
	if (self) return { kind: "person", id: self.id, name: self.name };
	// A workspace that hasn't configured a self person still gets history; the
	// entry just can't name the human in the chair. This is absence, not a
	// costume — `kind: "system"` is reserved for machine writes, and a bracketed
	// name keeps the Feed from reading it as a colleague.
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
  private readonly seq = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

	constructor(
		private readonly io: NoteIO,
		private readonly now: () => Date = () => new Date(),
	) {}

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

		const ts = input.ts ?? this.now().toISOString();
		const month = monthKey(ts);
		const entry: HistoryEntry = {
			seq: this.seq.get(month) ?? 1,
			ts,
			actor: input.actorOverride ?? selfActor(workspace),
			action: input.action,
			workspace: workspace.root,
			targets: input.targets ?? [],
			...(input.changes?.length ? { changes: input.changes } : {}),
		};

		this.seq.set(month, entry.seq + 1);
		const path = historyPathFor(workspace.root, ts);
		const line = serializeEntryLine(entry);

		this.chain = this.chain.then(async () => {
			if (entry.seq === 1) {
				// Fresh month for this session: make sure the counter starts
				// above whatever the file already holds.
				const existing = await this.readFile(path);
				this.seq.set(month, existing + 1);
				entry.seq = existing + 1;
			}
			await this.io.append(path, line);
		});
		this.touch();
	}

/**
   * Write a pre-built set of entries in one flush — the onboarding demo log.
   * Entries are appended oldest-first to the correct month files, each `seq`
   * continuing past anything already on disk, and the session's per-month
   * counter is left aligned so subsequent `record()` calls keep counting on
   * (a re-scaffold over an existing month just keeps the file growing rather
   * than clobbering). Fire-and-forget like `record()`: returns the chained
   * promise for callers that want to await it, but workspace creation doesn't
   * need to — the chain flushes before any `readEntries` resolves.
   */
  seed(root: string, entries: HistoryEntry[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    return (this.chain = this.chain.then(async () => {
      for (const entry of entries) {
        const month = monthKey(entry.ts);
        const next = (this.seq.get(month) ?? 0) + 1;
        if (next === 1) {
          // Fresh month for this session: continue past whatever's on disk
          // rather than replaying seq 1 against an existing file.
          const existing = await this.readFile(historyPathFor(root, entry.ts));
          this.seq.set(month, existing + 1);
        } else {
          this.seq.set(month, next);
        }
        const seq = this.seq.get(month)!;
        await this.io.append(
          historyPathFor(root, entry.ts),
          serializeEntryLine({ ...entry, seq }),
        );
      }
    }));
    this.touch();
  }

  /**
   * Every entry a workspace has ever recorded, oldest first. Flushes any
   * chained writes first, so a just-completed mutation is always visible.
   */
	async readEntries(root: string): Promise<HistoryEntry[]> {
		await this.chain;
		const entries: HistoryEntry[] = [];
		for (const file of this.io.listFiles(historyFolder(root))) {
			entries.push(...parseHistoryLog(await this.io.read(file)));
		}
		return entries.sort(
			(a, b) =>
				a.ts.localeCompare(b.ts) || String(a.seq).localeCompare(String(b.seq), undefined, { numeric: true }),
		);
	}

	private async readFile(path: string): Promise<number> {
		const file = this.io.getFile(path);
		if (!file) return 0;
		const entries = parseHistoryLog(await this.io.read(file));
		return entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
	}
}