/**
 * Narrow glue test for `VaultIndex.migrateOnCloseDateModes` — same spirit as
 * `history-log.test.ts`: an in-memory fake `NoteIO`, no Vault API. It exists
 * because the migration writes to disk exactly once and must never touch a
 * note that already carries an explicit choice.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	TFile: class {},
	TFolder: class {},
	Notice: class {},
	normalizePath: (p: string) => p,
	parseYaml: () => ({}),
	stringifyYaml: () => "",
	debounce: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

import { VaultIndex } from "../../src/obsidian/index-store";

interface FakeNote {
	path: string;
	frontmatter: Record<string, unknown> | null;
}

class FakeIO {
	writes = 0;
	constructor(private notes: FakeNote[]) {}

	listFiles(folderPath: string): FakeNote[] {
		return this.notes.filter((n) => n.path.startsWith(`${folderPath}/`));
	}
	readFrontmatter(file: FakeNote): Record<string, unknown> | null {
		return file.frontmatter;
	}
	async updateFrontmatter(
		file: FakeNote,
		mutate: (fm: Record<string, unknown>) => void,
	): Promise<void> {
		this.writes++;
		file.frontmatter ??= {};
		mutate(file.frontmatter);
	}
}

const run = (io: FakeIO): Promise<boolean> =>
	// The method is private by design — reach past it for this narrow check.
	(new VaultIndex({} as never, io as never) as unknown as {
		migrateOnCloseDateModes(root: string): Promise<boolean>;
	}).migrateOnCloseDateModes("W");

const onClose = (extra: Record<string, unknown> = {}) => ({
	trigger: "on-close",
	freq: "weekly",
	nextDate: "2026-09-01",
	...extra,
});

describe("migrateOnCloseDateModes", () => {
	it("backfills both modes to immediate on a legacy on-close note", async () => {
		const note: FakeNote = {
			path: "W/Tasks/TSK-1",
			frontmatter: { recurrence: onClose() },
		};
		const io = new FakeIO([note]);
		expect(await run(io)).toBe(true);
		const rec = note.frontmatter!.recurrence as Record<string, unknown>;
		expect(rec.onCloseStartDateMode).toBe("immediate");
		expect(rec.onCloseDueDateMode).toBe("immediate");
	});

	it("never overwrites an explicitly-set value, even a deliberate none", async () => {
		const note: FakeNote = {
			path: "W/Tasks/TSK-2",
			frontmatter: {
				recurrence: onClose({
					onCloseStartDateMode: "none",
					onCloseDueDateMode: "none",
				}),
			},
		};
		const io = new FakeIO([note]);
		expect(await run(io)).toBe(false);
		const rec = note.frontmatter!.recurrence as Record<string, unknown>;
		expect(rec.onCloseStartDateMode).toBe("none");
		expect(rec.onCloseDueDateMode).toBe("none");
		expect(io.writes).toBe(0);
	});

	it("leaves an on-date recurrence block untouched", async () => {
		const note: FakeNote = {
			path: "W/Tasks/TSK-3",
			frontmatter: {
				recurrence: { trigger: "on-date", freq: "daily", nextDate: "2026-09-01" },
			},
		};
		const io = new FakeIO([note]);
		expect(await run(io)).toBe(false);
		const rec = note.frontmatter!.recurrence as Record<string, unknown>;
		expect(rec).not.toHaveProperty("onCloseStartDateMode");
	});

	it("is a no-op the second time through", async () => {
		const note: FakeNote = {
			path: "W/Tasks/TSK-4",
			frontmatter: { recurrence: onClose() },
		};
		const io = new FakeIO([note]);
		expect(await run(io)).toBe(true);
		expect(io.writes).toBe(1);
		expect(await run(io)).toBe(false);
		expect(io.writes).toBe(1);
	});

	it("backfills only the missing key when one is already present", async () => {
		const note: FakeNote = {
			path: "W/Tasks/TSK-5",
			frontmatter: {
				recurrence: onClose({ onCloseStartDateMode: "shifted" }),
			},
		};
		const io = new FakeIO([note]);
		expect(await run(io)).toBe(true);
		const rec = note.frontmatter!.recurrence as Record<string, unknown>;
		expect(rec.onCloseStartDateMode).toBe("shifted");
		expect(rec.onCloseDueDateMode).toBe("immediate");
	});
});
