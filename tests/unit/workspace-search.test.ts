/**
 * `searchWorkspace` candidate building / ranking and the pure `splitMatches`
 * highlight helper (`src/obsidian/workspace-search.ts`).
 *
 * That module imports `prepareFuzzySearch` from `"obsidian"`, so — like
 * `entity-type-migration.test.ts` — the suite stubs `"obsidian"` with a small
 * deterministic fuzzy matcher (substring, else subsequence).
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	prepareFuzzySearch: (query: string) => {
		const q = query.toLowerCase();
		return (text: string) => {
			const t = text.toLowerCase();
			const idx = t.indexOf(q);
			if (idx >= 0) {
				return { score: 100 - idx, matches: [[idx, idx + q.length]] };
			}
			const matches: [number, number][] = [];
			let cursor = 0;
			for (const ch of q) {
				const at = t.indexOf(ch, cursor);
				if (at < 0) return null;
				const last = matches[matches.length - 1];
				if (last && last[1] === at) last[1] = at + 1;
				else matches.push([at, at + 1]);
				cursor = at + 1;
			}
			return { score: 10 - matches.length, matches };
		};
	},
}));

import { createWorkspaceConfig } from "../../src/core/serialization/workspace";
import { newView } from "../../src/core/views/defaults";
import { newDashboard } from "../../src/core/dashboards/defaults";
import type { VaultIndex } from "../../src/obsidian/index-store";
import type { WorkspaceSnapshot } from "../../src/core/types";
import {
	PER_KIND_CAP,
	searchWorkspace,
	splitMatches,
} from "../../src/obsidian/workspace-search";
import { project, task } from "./fixtures";

function fakeIndex(descriptions: Record<string, string>): VaultIndex {
	return {
		taskDescription: (p: string) => descriptions[p] ?? "",
		projectDescription: (p: string) => descriptions[p] ?? "",
	} as unknown as VaultIndex;
}

function snapshot(partial: Partial<WorkspaceSnapshot>): WorkspaceSnapshot {
	const workspace = createWorkspaceConfig("WS", "WS", "WS");
	return {
		workspace,
		tasks: [],
		projects: [],
		views: [],
		dashboards: [],
		trash: [],
		...partial,
	};
}

describe("searchWorkspace", () => {
	it("returns [] for a blank query", () => {
		const snap = snapshot({ tasks: [task({ title: "Anything" })] });
		expect(searchWorkspace(snap, fakeIndex({}), "   ")).toEqual([]);
	});

	it("surfaces a task matched only on its description, highlighting the description", () => {
		const t = task({ title: "Totally unrelated", path: "WS/Tasks/TSK-9" });
		const snap = snapshot({ tasks: [t] });
		const index = fakeIndex({ "WS/Tasks/TSK-9": "the lexorank boundary bug" });

		const [hit] = searchWorkspace(snap, index, "lexorank");

		expect(hit.kind).toBe("task");
		expect(hit.id).toBe("WS/Tasks/TSK-9");
		expect(hit.titleMatches).toBeNull();
		expect(hit.snippet).toBe("the lexorank boundary bug");
		expect(hit.snippetMatches).not.toBeNull();
	});

	it("prefers a title match and leaves the description as a plain snippet", () => {
		const t = task({ title: "lexorank engine", path: "WS/Tasks/TSK-1" });
		const snap = snapshot({ tasks: [t] });
		const index = fakeIndex({ "WS/Tasks/TSK-1": "lexorank again in the body" });

		const [hit] = searchWorkspace(snap, index, "lexorank");

		expect(hit.titleMatches).not.toBeNull();
		expect(hit.snippetMatches).toBeNull();
		expect(hit.snippet).toBe("lexorank again in the body");
	});

	it("surfaces a task matched on its formatted ID", () => {
		const t = task({
			id: "PRD-0104",
			title: "Totally unrelated title",
			path: "WS/Tasks/PRD-0104",
		});
		const snap = snapshot({ tasks: [t] });

		const [hit] = searchWorkspace(snap, fakeIndex({}), "PRD-0104");

		expect(hit.kind).toBe("task");
		expect(hit.id).toBe("WS/Tasks/PRD-0104");
		expect(hit.taskId).toBe("PRD-0104");
		expect(hit.titleMatches).toBeNull();
	});

	it("matches a task on a partial ID prefix", () => {
		const t = task({
			id: "PRD-0104",
			title: "Totally unrelated title",
			path: "WS/Tasks/PRD-0104",
		});
		const snap = snapshot({ tasks: [t] });

		const [hit] = searchWorkspace(snap, fakeIndex({}), "PRD");

		expect(hit.kind).toBe("task");
		expect(hit.taskId).toBe("PRD-0104");
	});

	it("never returns archived tasks or projects", () => {
		const snap = snapshot({
			tasks: [
				task({ title: "alpha live", path: "WS/Tasks/A" }),
				task({ title: "alpha gone", path: "WS/Tasks/B", archived: true }),
			],
			projects: [
				project({ title: "alpha project", path: "WS/Projects/P" }),
				project({ title: "alpha old", path: "WS/Projects/Q", archived: true }),
			],
		});

		const ids = searchWorkspace(snap, fakeIndex({}), "alpha").map((r) => r.id);
		expect(ids).toContain("WS/Tasks/A");
		expect(ids).toContain("WS/Projects/P");
		expect(ids).not.toContain("WS/Tasks/B");
		expect(ids).not.toContain("WS/Projects/Q");
	});

	it("excludes projected recurring ghost rows", () => {
		const snap = snapshot({
			tasks: [
				task({ title: "recurring match", path: "WS/Tasks/real" }),
				task({
					title: "recurring match",
					path: "WS/Tasks/real/occ/1",
					projected: true,
				}),
			],
		});
		const ids = searchWorkspace(snap, fakeIndex({}), "recurring").map((r) => r.id);
		expect(ids).toEqual(["WS/Tasks/real"]);
	});

	it("caps results per kind", () => {
		const tasks = Array.from({ length: PER_KIND_CAP + 3 }, (_, i) =>
			task({ title: `match task ${i}`, path: `WS/Tasks/T${i}` }),
		);
		const snap = snapshot({ tasks });

		const hits = searchWorkspace(snap, fakeIndex({}), "match");
		expect(hits).toHaveLength(PER_KIND_CAP);
		expect(hits.every((h) => h.kind === "task")).toBe(true);
	});

	it("matches views, dashboards, labels and people", () => {
		const workspace = createWorkspaceConfig("WS", "WS", "WS");
		workspace.labels = [
			{ id: "perf", name: "performance", color: "#f00" },
		];
		workspace.people = [
			{ id: "al", name: "Alice", aliases: ["performance-lead"] },
		];
		const snap: WorkspaceSnapshot = {
			workspace,
			tasks: [],
			projects: [],
			views: [{ ...newView("v1", "performance view", "list") }],
			dashboards: [newDashboard("d1", "performance dash")],
			trash: [],
		};

		const kinds = new Set(
			searchWorkspace(snap, fakeIndex({}), "performance").map((r) => r.kind),
		);
		expect(kinds).toEqual(new Set(["view", "dashboard", "label", "person"]));
	});

	it("matches a person on an alias when the name doesn't match", () => {
		const workspace = createWorkspaceConfig("WS", "WS", "WS");
		workspace.people = [{ id: "bob", name: "Bob", aliases: ["sparky"] }];
		const snap = snapshot({ workspace });

		const [hit] = searchWorkspace(snap, fakeIndex({}), "sparky");
		expect(hit.kind).toBe("person");
		expect(hit.id).toBe("bob");
		expect(hit.titleMatches).toBeNull();
	});
});

describe("splitMatches", () => {
	it("returns a single unmatched segment when there are no matches", () => {
		expect(splitMatches("hello", null)).toEqual([
			{ text: "hello", matched: false },
		]);
		expect(splitMatches("hello", [])).toEqual([
			{ text: "hello", matched: false },
		]);
	});

	it("returns nothing for empty text", () => {
		expect(splitMatches("", null)).toEqual([]);
	});

	it("slices around a mid-string match", () => {
		expect(splitMatches("abcdef", [[2, 4]])).toEqual([
			{ text: "ab", matched: false },
			{ text: "cd", matched: true },
			{ text: "ef", matched: false },
		]);
	});

	it("handles adjacent matches without emitting empty gaps", () => {
		expect(splitMatches("abcd", [[0, 1], [1, 2]])).toEqual([
			{ text: "a", matched: true },
			{ text: "b", matched: true },
			{ text: "cd", matched: false },
		]);
	});

	it("handles matches touching both string boundaries", () => {
		expect(splitMatches("abcd", [[0, 4]])).toEqual([
			{ text: "abcd", matched: true },
		]);
		expect(splitMatches("abcd", [[3, 4]])).toEqual([
			{ text: "abc", matched: false },
			{ text: "d", matched: true },
		]);
	});

	it("clamps out-of-range pairs", () => {
		expect(splitMatches("abc", [[1, 99]])).toEqual([
			{ text: "a", matched: false },
			{ text: "bc", matched: true },
		]);
	});
});
