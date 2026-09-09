/**
 * Narrow glue tests for `VaultIndex.migrateViewQueries` /
 * `migrateDashboardFilters` — same spirit as `recurrence-migration.test.ts`:
 * an in-memory fake `NoteIO`, no Vault API. These migrations rewrite a file's
 * frontmatter exactly once, converting the retired structured view/dashboard
 * keys to a single `query:` / `filter:` string, and must never touch a file
 * that already carries the new field.
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
import {
	parseLegacyViewDefinition,
	parseView,
} from "../../src/core/serialization/views";
import { parseDashboard } from "../../src/core/serialization/dashboards";
import { workspaceQueryContext } from "../../src/core/query";
import { canonicalizeDefinition } from "../../src/core/views/filter";
import { canonicalizeFilters } from "../../src/core/views/filter";

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
	getFile(path: string): FakeNote | null {
		return this.notes.find((n) => n.path === `${path}.md`) ?? null;
	}
	async readConfigFrontmatter(
		file: FakeNote,
	): Promise<Record<string, unknown> | null> {
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

const workspace = {
	root: "W",
	history: { enabled: true },
	statuses: [
		{ id: "todo", name: "Todo", color: "#000", category: "unstarted", order: 1 },
		{
			id: "in-progress",
			name: "In Progress",
			color: "#000",
			category: "started",
			order: 2,
		},
	],
	priorities: [{ id: "high", name: "High", color: "#000", order: 1 }],
	taskTypes: [{ id: "bug", name: "Bug", color: "#000" }],
	labels: [],
	people: [],
} as never;

const ctx = workspaceQueryContext(workspace);

function makeIndex(io: FakeIO, history: { record: () => void }) {
	return new VaultIndex({} as never, io as never, history as never) as unknown as {
		migrateViewQueries(w: unknown): Promise<boolean>;
		migrateDashboardFilters(w: unknown): Promise<boolean>;
	};
}

describe("migrateViewQueries", () => {
	it("converts a legacy Views/*.md note to a query string", async () => {
		const legacy = {
			type: "vertex-flow-view",
			id: "my-bugs",
			name: "My Bugs",
			viewType: "board",
			groupBy: "status",
			sortBy: "rank",
			filters: { taskType: ["bug"], status: ["todo", "in-progress"] },
			hiddenFields: ["priority"],
		};
		const note: FakeNote = {
			path: "W/Views/my-bugs.md",
			frontmatter: { ...legacy },
		};
		const record = vi.fn();
		expect(await makeIndex(new FakeIO([note]), { record }).migrateViewQueries(workspace)).toBe(
			true,
		);

		const fm = note.frontmatter!;
		expect(typeof fm.query).toBe("string");
		for (const key of [
			"viewType",
			"groupBy",
			"sortBy",
			"filters",
			"hiddenFields",
		]) {
			expect(fm).not.toHaveProperty(key);
		}
		// Identity keys are left alone.
		expect(fm.name).toBe("My Bugs");

		// The query canonicalizes to what the old structured parse produced.
		const fromQuery = parseView(fm, { path: "W/Views/my-bugs", context: ctx }).value;
		const fromLegacy = canonicalizeDefinition(parseLegacyViewDefinition(legacy));
		expect(canonicalizeDefinition(fromQuery)).toEqual(fromLegacy);

		// One aggregated [system] entry.
		expect(record).toHaveBeenCalledTimes(1);
		expect(record.mock.calls[0][1]).toMatchObject({
			action: "view.migrate-query-format",
			actorOverride: { kind: "system", name: "[system]" },
			targets: [{ kind: "view", id: "my-bugs", path: "W/Views/my-bugs" }],
		});
	});

	it("leaves a note that already has query untouched", async () => {
		const note: FakeNote = {
			path: "W/Views/v.md",
			frontmatter: { id: "v", name: "V", query: "status:todo group:none sort:rank" },
		};
		const io = new FakeIO([note]);
		const record = vi.fn();
		expect(await makeIndex(io, { record }).migrateViewQueries(workspace)).toBe(false);
		expect(io.writes).toBe(0);
		expect(record).not.toHaveBeenCalled();
	});

	it("is a no-op the second time through", async () => {
		const note: FakeNote = {
			path: "W/Views/v.md",
			frontmatter: { id: "v", name: "V", viewType: "board", groupBy: "status" },
		};
		const io = new FakeIO([note]);
		const idx = makeIndex(io, { record: vi.fn() });
		expect(await idx.migrateViewQueries(workspace)).toBe(true);
		expect(io.writes).toBe(1);
		expect(await idx.migrateViewQueries(workspace)).toBe(false);
		expect(io.writes).toBe(1);
	});

	it("migrates a Project's embedded view: block", async () => {
		const note: FakeNote = {
			path: "W/Projects/Core.md",
			frontmatter: {
				type: "vertex-flow-project",
				title: "Core",
				view: {
					viewType: "board",
					groupBy: "status",
					columns: { collapsed: ["todo"], hidden: [] },
				},
			},
		};
		const record = vi.fn();
		expect(
			await makeIndex(new FakeIO([note]), { record }).migrateViewQueries(workspace),
		).toBe(true);
		const view = note.frontmatter!.view as Record<string, unknown>;
		expect(typeof view.query).toBe("string");
		expect(view).not.toHaveProperty("viewType");
		// Per-session chrome is preserved.
		expect(view.columns).toEqual({ collapsed: ["todo"], hidden: [] });
		expect(record.mock.calls.map((c) => c[1].action)).toContain(
			"project.migrate-query-format",
		);
	});

	it("does nothing (and logs nothing) when a workspace has no views", async () => {
		const record = vi.fn();
		const io = new FakeIO([]);
		expect(await makeIndex(io, { record }).migrateViewQueries(workspace)).toBe(false);
		expect(io.writes).toBe(0);
		expect(record).not.toHaveBeenCalled();
	});
});

describe("migrateDashboardFilters", () => {
	it("converts a legacy Dashboards/*.md filters block to a filter string", async () => {
		const note: FakeNote = {
			path: "W/Dashboards/health.md",
			frontmatter: {
				type: "vertex-flow-dashboard",
				id: "health",
				name: "Health",
				filters: { status: ["todo"], taskType: ["bug"] },
				widgets: [],
			},
		};
		const record = vi.fn();
		expect(
			await makeIndex(new FakeIO([note]), { record }).migrateDashboardFilters(workspace),
		).toBe(true);

		const fm = note.frontmatter!;
		expect(fm).not.toHaveProperty("filters");
		expect(typeof fm.filter).toBe("string");

		const parsed = parseDashboard(fm, { path: "W/Dashboards/health", context: ctx }).value;
		expect(canonicalizeFilters(parsed.filters)).toEqual(
			canonicalizeFilters({ status: ["todo"], taskType: ["bug"] }),
		);
		expect(record.mock.calls[0][1]).toMatchObject({
			action: "dashboard.migrate-filter-format",
			actorOverride: { kind: "system", name: "[system]" },
		});
	});

	it("leaves a dashboard that already has filter untouched, and is idempotent", async () => {
		const note: FakeNote = {
			path: "W/Dashboards/d.md",
			frontmatter: { id: "d", name: "D", filter: "status:todo", widgets: [] },
		};
		const io = new FakeIO([note]);
		const record = vi.fn();
		expect(await makeIndex(io, { record }).migrateDashboardFilters(workspace)).toBe(false);
		expect(io.writes).toBe(0);
		expect(record).not.toHaveBeenCalled();
	});

	it("does nothing when a workspace has no dashboards", async () => {
		const record = vi.fn();
		expect(
			await makeIndex(new FakeIO([]), { record }).migrateDashboardFilters(workspace),
		).toBe(false);
		expect(record).not.toHaveBeenCalled();
	});
});
