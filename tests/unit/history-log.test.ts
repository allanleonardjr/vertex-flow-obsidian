/**
 * The `HistoryLog` writer — the one piece of the history feature that rides on
 * Obsidian's Vault API, mocked here with an in-memory `NoteIO`. history.test.ts
 * pins the pure format/diffs; this pins the chain's *behaviour*: entries land
 * in call order, the per-month `seq` keeps counting in a new session, and a
 * seed (or record) bumps the revision so a live hub repaints.
 */

import { describe, it, expect } from "vitest";
import { HistoryLog } from "../../src/obsidian/history-log";
import type { NoteIO } from "../../src/obsidian/note-io";
import { createWorkspaceConfig } from "../../src/core/serialization/workspace";
import type { HistoryEntry, WorkspaceConfig } from "../../src/core/types";

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
  it("continues seq past an existing month file (a fresh session)", async () => {
    const io = new FakeIO() as unknown as NoteIO;
    const ws = enabledWorkspace();

    // Session 1 writes seq 1, 2.
    const first = new HistoryLog(io);
    first.record(ws, action(ws.root));
    first.record(ws, action(ws.root));
    const afterFirst = await first.readEntries(ws.root);
    expect(afterFirst.map((e) => e.seq)).toEqual([1, 2]);

    // Session 2 (new in-memory counter) must continue past the file: 3, 4.
    const second = new HistoryLog(io);
    second.record(ws, action(ws.root));
    second.record(ws, action(ws.root));
    const afterSecond = await second.readEntries(ws.root);
    expect(afterSecond.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it("bumps the revision so a live hub re-reads a seeded log", async () => {
    const io = new FakeIO();
    const ws = enabledWorkspace();
    const log = new HistoryLog(io as unknown as NoteIO);

    let calls = 0;
    log.subscribe(() => calls++);
    const seedEntry: HistoryEntry = {
      seq: 1,
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
    expect(entries[0].seq).toBe(1);
    expect(io.files.size).toBe(1);
  });
});