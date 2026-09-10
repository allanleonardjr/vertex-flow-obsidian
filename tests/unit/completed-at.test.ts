/**
 * `completedAt` — the auto-stamped "when did this task last become done" field.
 *
 *   - `Mutations.updateTask` stamps it when a status patch crosses into the
 *     taxonomy's `"completed"` category, and clears it on the way back out.
 *   - `migrateCompletedAt` backfills it (from `updatedAt`) for tasks that were
 *     already completed before the field shipped, and is a strict no-op once
 *     the vault has converged.
 *
 * Narrow glue tests in the spirit of `entity-type-migration.test.ts`: in-memory
 * fakes, no Vault API.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	App: class {},
	Notice: class {
		constructor(_message?: string) {}
	},
	TFile: class {},
	TFolder: class {},
	normalizePath: (p: string) => p,
	parseYaml: () => ({}),
	stringifyYaml: () => "",
	debounce: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

import { Mutations } from "../../src/obsidian/mutations";
import { migrateCompletedAt } from "../../src/obsidian/migrate-completed-at";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseTask } from "../../src/core/serialization/task";
import type { Task, WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

// ---------------------------------------------------------------------------
// updateTask stamp / clear
// ---------------------------------------------------------------------------

class FakeIO {
	frontmatter: Record<string, unknown> | null = null;
	getFile(): unknown {
		return {};
	}
	async replaceFrontmatter(
		_file: unknown,
		fm: Record<string, unknown>,
	): Promise<void> {
		this.frontmatter = fm;
	}
}

class FakeIndex {
	constructor(public snap: WorkspaceSnapshot) {}
	async rebuild(): Promise<void> {}
	workspaceFor(): WorkspaceSnapshot {
		return this.snap;
	}
}

function buildMutations() {
	const snap = sampleSnapshot();
	const io = new FakeIO();
	const history = { record: vi.fn() };
	const mutations = new Mutations(
		{} as never,
		io as never,
		new FakeIndex(snap) as never,
		history as never,
	);
	return { io, mutations, snap };
}

/** Re-parse whatever `replaceFrontmatter` was handed, so assertions read fields. */
function written(io: FakeIO): Task {
	return parseTask(io.frontmatter, {
		path: "W/Tasks/TSK-1",
		defaultStatus: "todo",
	}).value;
}

describe("Mutations.updateTask — completedAt", () => {
	it("stamps completedAt when the status crosses into a completed category", async () => {
		const { io, mutations } = buildMutations();
		const t = task({ path: "W/Tasks/TSK-1", status: "in-progress" });

		await mutations.updateTask(t, { status: "done" });

		expect(written(io).completedAt).not.toBeNull();
	});

	it("overwrites an existing completedAt on re-completion", async () => {
		const { io, mutations } = buildMutations();
		const t = task({
			path: "W/Tasks/TSK-1",
			status: "done",
			completedAt: "2020-01-01T00:00:00.000Z",
		});

		await mutations.updateTask(t, { status: "in-review" });
		await mutations.updateTask(written(io), { status: "done" });

		expect(written(io).completedAt).not.toBe("2020-01-01T00:00:00.000Z");
		expect(written(io).completedAt).not.toBeNull();
	});

	it("clears completedAt when the status moves out of completed", async () => {
		const { io, mutations } = buildMutations();
		const t = task({
			path: "W/Tasks/TSK-1",
			status: "done",
			completedAt: "2026-01-01T00:00:00.000Z",
		});

		await mutations.updateTask(t, { status: "in-progress" });

		expect(written(io).completedAt).toBeNull();
	});

	it("leaves completedAt untouched when a non-status field changes", async () => {
		const { io, mutations } = buildMutations();
		const t = task({
			path: "W/Tasks/TSK-1",
			status: "done",
			completedAt: "2026-01-01T00:00:00.000Z",
		});

		await mutations.updateTask(t, { title: "renamed" });

		expect(written(io).completedAt).toBe("2026-01-01T00:00:00.000Z");
	});
});

// ---------------------------------------------------------------------------
// migrateCompletedAt
// ---------------------------------------------------------------------------

interface FakeNote {
	path: string;
	frontmatter: Record<string, unknown>;
}

class MigrateIO {
	writes = 0;
	constructor(private notes: FakeNote[]) {}
	getFile(path: string): FakeNote | null {
		return this.notes.find((n) => n.path === path) ?? null;
	}
	async updateFrontmatter(
		file: FakeNote,
		mutate: (fm: Record<string, unknown>) => void,
	): Promise<void> {
		this.writes++;
		mutate(file.frontmatter);
	}
}

function migrateIndex(tasks: Task[]) {
	const base = sampleSnapshot();
	return { list: () => [{ ...base, tasks }] } as never;
}

describe("migrateCompletedAt", () => {
	it("backfills completedAt from updatedAt for an already-completed task", async () => {
		const t = task({
			path: "W/Tasks/TSK-1",
			status: "done",
			completedAt: null,
			updatedAt: "2026-05-05T12:00:00.000Z",
		});
		const notes: FakeNote[] = [
			{ path: "W/Tasks/TSK-1", frontmatter: { type: "vertex-flow-task" } },
		];
		const io = new MigrateIO(notes);

		expect(await migrateCompletedAt(migrateIndex([t]), io as never)).toBe(1);
		expect(notes[0].frontmatter.completedAt).toBe("2026-05-05T12:00:00.000Z");
	});

	it("leaves a completed task that already has completedAt alone", async () => {
		const t = task({
			path: "W/Tasks/TSK-1",
			status: "done",
			completedAt: "2026-01-01T00:00:00.000Z",
		});
		const io = new MigrateIO([
			{ path: "W/Tasks/TSK-1", frontmatter: { type: "vertex-flow-task" } },
		]);
		expect(await migrateCompletedAt(migrateIndex([t]), io as never)).toBe(0);
		expect(io.writes).toBe(0);
	});

	it("leaves a non-completed task alone", async () => {
		const t = task({
			path: "W/Tasks/TSK-1",
			status: "in-progress",
			completedAt: null,
		});
		const io = new MigrateIO([
			{ path: "W/Tasks/TSK-1", frontmatter: { type: "vertex-flow-task" } },
		]);
		expect(await migrateCompletedAt(migrateIndex([t]), io as never)).toBe(0);
	});

	it("is a strict no-op on the second run", async () => {
		const t = task({
			path: "W/Tasks/TSK-1",
			status: "done",
			completedAt: null,
			updatedAt: "2026-05-05T12:00:00.000Z",
		});
		const notes: FakeNote[] = [
			{ path: "W/Tasks/TSK-1", frontmatter: { type: "vertex-flow-task" } },
		];
		const io = new MigrateIO(notes);

		expect(await migrateCompletedAt(migrateIndex([t]), io as never)).toBe(1);

		const migrated = task({ ...t, completedAt: "2026-05-05T12:00:00.000Z" });
		expect(await migrateCompletedAt(migrateIndex([migrated]), io as never)).toBe(0);
		expect(io.writes).toBe(1);
	});
});
