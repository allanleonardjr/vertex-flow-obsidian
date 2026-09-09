/**
 * The `type:` frontmatter rename (`task` → `vertex-flow-task`, …):
 *   - pure helpers in `src/core/entity-type.ts`
 *   - the post-rebuild migration pass in `src/obsidian/migrate-entity-type.ts`
 *
 * The migration half is a narrow glue test in the spirit of
 * `recurrence-migration.test.ts` / `history-log.test.ts`: an in-memory fake
 * index + fake `NoteIO`, no Vault API. It exists because the pass writes to
 * disk and must be a strict no-op once the vault has converged.
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

import { isTaskNoteType, legacyEntityTypeRewrite } from "../../src/core/entity-type";
import { migrateEntityTypes } from "../../src/obsidian/migrate-entity-type";

describe("isTaskNoteType", () => {
	it("accepts both the bare and prefixed task discriminants", () => {
		expect(isTaskNoteType("task")).toBe(true);
		expect(isTaskNoteType("vertex-flow-task")).toBe(true);
	});

	it("rejects everything else", () => {
		for (const v of ["project", "vertex-flow-project", "", null, undefined, 3]) {
			expect(isTaskNoteType(v)).toBe(false);
		}
	});
});

describe("legacyEntityTypeRewrite", () => {
	it("maps each bare value to its prefixed form", () => {
		expect(legacyEntityTypeRewrite("task")).toBe("vertex-flow-task");
		expect(legacyEntityTypeRewrite("project")).toBe("vertex-flow-project");
		expect(legacyEntityTypeRewrite("workspace")).toBe("vertex-flow-workspace");
		expect(legacyEntityTypeRewrite("view")).toBe("vertex-flow-view");
		expect(legacyEntityTypeRewrite("dashboard")).toBe("vertex-flow-dashboard");
	});

	it("returns null for an already-prefixed, unknown, or non-string value", () => {
		expect(legacyEntityTypeRewrite("vertex-flow-task")).toBeNull();
		expect(legacyEntityTypeRewrite("something-else")).toBeNull();
		expect(legacyEntityTypeRewrite(undefined)).toBeNull();
		expect(legacyEntityTypeRewrite(42)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// migrateEntityTypes
// ---------------------------------------------------------------------------

interface FakeNote {
	path: string;
	frontmatter: Record<string, unknown> | null;
}

class FakeIO {
	writes = 0;
	constructor(private notes: FakeNote[]) {}
	getFile(path: string): FakeNote | null {
		return this.notes.find((n) => n.path === path) ?? null;
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

/** A fake index exposing just the `list()` shape `migrateEntityTypes` reads. */
function fakeIndex(snapshots: unknown[]) {
	return { list: () => snapshots } as never;
}

const snapshot = (root: string) => ({
	workspace: { root },
	tasks: [{ path: `${root}/Tasks/TSK-1` }],
	projects: [{ path: `${root}/Projects/Alpha` }],
	views: [{ path: `${root}/Views/v1` }, { path: "" /* synthetic System View */ }],
	dashboards: [{ path: `${root}/Dashboards/d1` }],
	trash: [{ entity: { path: `${root}/Trash/Tasks/TSK-9` } }],
});

describe("migrateEntityTypes", () => {
	it("rewrites every stale bare `type:` and leaves prefixed/foreign notes alone", async () => {
		const notes: FakeNote[] = [
			{ path: "W/_workspace", frontmatter: { type: "workspace", name: "W" } },
			{ path: "W/Tasks/TSK-1", frontmatter: { type: "task", id: "TSK-1" } },
			{ path: "W/Projects/Alpha", frontmatter: { type: "project" } },
			{ path: "W/Views/v1", frontmatter: { type: "view" } },
			{ path: "W/Dashboards/d1", frontmatter: { type: "vertex-flow-dashboard" } },
			{ path: "W/Trash/Tasks/TSK-9", frontmatter: { type: "task" } },
		];
		const io = new FakeIO(notes);

		expect(await migrateEntityTypes(fakeIndex([snapshot("W")]), io as never)).toBe(5);
		expect(notes.map((n) => n.frontmatter?.type)).toEqual([
			"vertex-flow-workspace",
			"vertex-flow-task",
			"vertex-flow-project",
			"vertex-flow-view",
			"vertex-flow-dashboard",
			"vertex-flow-task",
		]);
		expect(io.writes).toBe(5);
	});

	it("is a strict no-op on the second run", async () => {
		const notes: FakeNote[] = [
			{ path: "W/Tasks/TSK-1", frontmatter: { type: "task" } },
		];
		const io = new FakeIO(notes);
		const index = fakeIndex([
			{ workspace: { root: "W" }, tasks: notes, projects: [], views: [], dashboards: [], trash: [] },
		]);

		expect(await migrateEntityTypes(index, io as never)).toBe(1);
		expect(io.writes).toBe(1);
		expect(await migrateEntityTypes(index, io as never)).toBe(0);
		expect(io.writes).toBe(1);
	});

	it("tolerates notes the index lists that have no file on disk", async () => {
		const io = new FakeIO([]);
		const index = fakeIndex([
			{ workspace: { root: "W" }, tasks: [{ path: "W/Tasks/gone" }], projects: [], views: [], dashboards: [], trash: [] },
		]);
		expect(await migrateEntityTypes(index, io as never)).toBe(0);
	});
});
