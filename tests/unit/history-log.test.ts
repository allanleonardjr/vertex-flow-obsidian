/**
 * The `HistoryLog` writer — the one piece of the history feature that rides on
 * Obsidian's Vault API, mocked here with an in-memory `NoteIO`. history.test.ts
 * pins the pure format/diffs; this pins the chain's *behaviour*: entries land
 * in call order, per-stream monotonic timestamps, and a seed (or record) bumps
 * the revision so a live hub repaints.
 */

import { describe, it, expect, vi } from "vitest";
import { HistoryLog } from "../../src/obsidian/history-log";
import type { NoteIO } from "../../src/obsidian/note-io";
import { createWorkspaceConfig } from "../../src/core/serialization/workspace";
import type { HistoryEntry, WorkspaceConfig, MeBinding } from "../../src/core/types";

class FakeIO {
	files = new Map<string, string>();
	getFile(path: string) {
		const target = path.endsWith(".md") ? path : `${path}.md`;
		return this.files.has(target) ? ({ path: target } as never) : null;
	}
	async read(file: { path: string }) {
		return this.files.get(file.path) ?? "";
	}
	async append(path: string, text: string) {
		const target = path.endsWith(".md") ? path : `${path}.md`;
		this.files.set(target, (this.files.get(target) ?? "") + text);
	}
	listFiles(folderPath: string) {
		const prefix = `${folderPath}/`;
		return [...this.files.keys()]
			.filter((p) => p.startsWith(prefix))
			.map((p) => ({ path: p }) as never);
	}
}

function enabledWorkspace(): WorkspaceConfig {
	const ws = createWorkspaceConfig("WS1", "Root", "Test Workspace", "TW");
	return { ...ws, history: { enabled: true }, people: [] };
}

function action(root: string): { action: string; targets: { kind: "workspace"; id: string; path: string }[] } {
	return { action: "workspace.config.update", targets: [{ kind: "workspace", id: root, path: `${root}/_workspace` }] };
}

describe("HistoryLog glue", () => {
	it("continues monotonic ts past an existing month file (a fresh session)", async () => {
		const io = new FakeIO() as unknown as NoteIO;
		const ws = enabledWorkspace();
		const device = "test-device";
		const now = new Date("2026-01-01T00:00:00Z");
		const nowFn = vi.fn(() => now);

		// Session 1 writes two entries.
		const first = new HistoryLog(io, device, () => null, nowFn);
		first.record(ws, action(ws.root));
		first.record(ws, action(ws.root));
		const afterFirst = await first.readEntries(ws.root);
		expect(afterFirst.map((e) => e.ts)).toEqual([
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T00:00:00.001Z",
		]);
		expect(afterFirst.every((e) => e.stream === "test-device")).toBe(true);

		// Session 2 (new in-memory counter) must continue past the file.
		const second = new HistoryLog(io, device, () => null, nowFn);
		second.record(ws, action(ws.root));
		second.record(ws, action(ws.root));
		const afterSecond = await second.readEntries(ws.root);
		expect(afterSecond.map((e) => e.ts)).toEqual([
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T00:00:00.001Z",
			"2026-01-01T00:00:00.002Z",
			"2026-01-01T00:00:00.003Z",
		]);
	});

	it("bumps the revision so a live hub re-reads a seeded log", async () => {
		const io = new FakeIO();
		const ws = enabledWorkspace();
		const device = "test-device";
		const now = new Date("2026-01-01T00:00:00Z");
		const nowFn = vi.fn(() => now);
		const log = new HistoryLog(io as unknown as NoteIO, device, () => null, nowFn);

		let calls = 0;
		log.subscribe(() => calls++);
		const seedEntry: HistoryEntry = {
			ts: new Date().toISOString(),
			actor: { kind: "system", name: "[system]" },
			action: "workspace.create",
			workspace: ws.root,
			targets: action(ws.root).targets,
		};
		await log.seed(ws.root, [seedEntry]);
		expect(calls).toBe(1);

		const entries = await log.readEntries(ws.root);
		expect(entries.map((e) => e.action)).toEqual(["workspace.create"]);
		expect(io.files.size).toBe(1);
	});

	it("merges entries from multiple device streams sorted by (ts, stream)", async () => {
		const io = new FakeIO() as unknown as NoteIO;
		const ws = enabledWorkspace();
		const now = new Date("2026-01-01T00:00:00Z");
		const nowFn = vi.fn(() => now);

		const logA = new HistoryLog(io, "device-A", () => null, nowFn);
		logA.record(ws, action(ws.root)); // ts .000
		logA.record(ws, action(ws.root)); // ts .001

		const logB = new HistoryLog(io, "device-B", () => null, nowFn);
		logB.record(ws, action(ws.root)); // ts .000 (per-stream monotonic)
		logB.record(ws, action(ws.root)); // ts .001

		const merged = await logA.readEntries(ws.root); // readEntries reads ALL files
		// Per-stream monotonic: each device starts at .000. Merged sort by (ts, stream).
		expect(merged.map((e) => e.stream)).toEqual(["device-A", "device-B", "device-A", "device-B"]);
		expect(merged.map((e) => e.ts)).toEqual([
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T00:00:00.001Z",
			"2026-01-01T00:00:00.001Z",
		]);
	});
});