/**
 * Regression guard for the "double spawn" bug in the recurrence reconcile pass.
 *
 * Root cause: Obsidian's metadata cache doesn't populate synchronously after
 * `vault.create()`, so the `VaultIndex.rebuild()` that immediately follows a
 * spawn can miss the just-written successor and drop it from the snapshot. The
 * trailing reconcile pass then reads that stale snapshot, still sees no
 * successor, and spawns a second, independent one.
 *
 * This is a deliberately narrow glue test — same spirit as `history-log.test.ts`
 * (an in-memory fake, no Vault API) — because the failure already shipped once
 * and the fix (`Mutations.recentlySpawned`) lives in the glue layer by design.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	Notice: class {
		constructor(_message?: string) {}
	},
	TFile: class {},
	TFolder: class {},
	normalizePath: (path: string) => path,
	parseYaml: () => ({}),
	stringifyYaml: () => "",
	debounce: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

import { Mutations } from "../../src/obsidian/mutations";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { localTodayIso } from "../../src/core/date";
import { nextOccurrence } from "../../src/core/recurrence";
import type {
	RecurrenceConfig,
	Task,
	WorkspaceSnapshot,
} from "../../src/core/types";
import { task } from "./fixtures";

const rule = (partial: Partial<RecurrenceConfig> = {}): RecurrenceConfig => ({
	trigger: "on-date",
	triggerStatus: null,
	freq: "daily",
	interval: 1,
	weekdays: [],
	dayOfMonth: null,
	weekdayOfMonth: null,
	monthOfYear: null,
	anchor: "dueDate",
	newStatus: null,
	endsAfter: null,
	endsOn: null,
	nextDate: localTodayIso(),
	copyFields: null,
	...partial,
});

class FakeIO {
	created: { path: string }[] = [];
	getFile(): unknown {
		return null;
	}
	async readBody(): Promise<string> {
		return "";
	}
	async create(path: string): Promise<{ path: string }> {
		this.created.push({ path });
		return { path };
	}
}

/**
 * `list()` always returns the current snapshot; `rebuild()` advances to the next
 * queued one, modelling the metadata cache lagging behind a fresh `create()`.
 */
class FakeIndex {
	constructor(public snap: WorkspaceSnapshot) {}
	queue: WorkspaceSnapshot[] = [];
	list(): WorkspaceSnapshot[] {
		return [this.snap];
	}
	async rebuild(): Promise<void> {
		if (this.queue.length > 0) this.snap = this.queue.shift()!;
	}
	workspaceFor(): WorkspaceSnapshot {
		return this.snap;
	}
}

const history = { record: () => {} };

function build(source: Task) {
	const base = sampleSnapshot();
	const snapshotOf = (tasks: Task[]): WorkspaceSnapshot => ({ ...base, tasks });

	const io = new FakeIO();
	// S0 -> reconcile spawns; the rebuild that follows still can't see the
	// successor (S1, cache lag); the test later swaps in S2 once it "catches up".
	const index = new FakeIndex(snapshotOf([source]));
	index.queue.push(snapshotOf([source]));

	const mutations = new Mutations(
		{} as never,
		io as never,
		index as never,
		history as never,
	);
	return { io, index, mutations, snapshotOf };
}

describe("reconcileRecurrences — stale-snapshot double spawn", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("does not spawn a second occurrence for an on-date source while the rebuild lags", async () => {
		const today = localTodayIso();
		const source = task({
			id: "TSK-9001",
			path: "W/Tasks/TSK-9001",
			dueDate: today,
			recurrence: rule({ trigger: "on-date", nextDate: today }),
		});
		const { io, index, mutations, snapshotOf } = build(source);

		await mutations.reconcileRecurrences();
		expect(io.created).toHaveLength(1);
		const successorPath = io.created[0].path;

		// Trailing pass over the stale snapshot (successor not yet visible).
		await mutations.reconcileRecurrences();
		expect(io.created).toHaveLength(1);

		// Cache catches up: the successor is now in the snapshot.
		const successor = task({
			id: "TSK-9002",
			path: successorPath,
			recurringFrom: source.path,
			dueDate: nextOccurrence(source.recurrence!, today),
			recurrence: null,
		});
		index.snap = snapshotOf([source, successor]);

		await mutations.reconcileRecurrences();
		expect(io.created).toHaveLength(1);
	});

	it("does not spawn a second occurrence for an on-close source while the rebuild lags", async () => {
		const today = localTodayIso();
		const source = task({
			id: "TSK-9001",
			path: "W/Tasks/TSK-9001",
			status: "done", // sample workspace: `done` is category `completed`
			dueDate: today,
			recurrence: rule({
				trigger: "on-close",
				triggerStatus: null,
				nextDate: today,
			}),
		});
		const { io, index, mutations, snapshotOf } = build(source);

		await mutations.reconcileRecurrences();
		expect(io.created).toHaveLength(1);
		const successorPath = io.created[0].path;

		await mutations.reconcileRecurrences();
		expect(io.created).toHaveLength(1);

		const successor = task({
			id: "TSK-9002",
			path: successorPath,
			recurringFrom: source.path,
			dueDate: nextOccurrence(source.recurrence!, today),
			recurrence: null,
		});
		index.snap = snapshotOf([source, successor]);

		await mutations.reconcileRecurrences();
		expect(io.created).toHaveLength(1);
	});
});
