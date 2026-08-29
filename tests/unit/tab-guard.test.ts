import { describe, expect, it } from "vitest";
import {
	reorderTabs,
	shouldPromptUnsavedGuard,
} from "../../src/ui/tabs-guard";

describe("shouldPromptUnsavedGuard", () => {
	it("never prompts when no guard is registered", () => {
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: false,
				action: "navigate",
				targetId: "view:x",
				activeId: "workspace",
			}),
		).toBe(false);
	});

	it("prompts when navigating away from a dirty active tab", () => {
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: true,
				action: "navigate",
				targetId: "dashboard:a",
				activeId: "workspace",
			}),
		).toBe(true);
	});

	it("does not prompt for a no-op switch to the tab already active", () => {
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: true,
				action: "navigate",
				targetId: "workspace",
				activeId: "workspace",
			}),
		).toBe(false);
	});

	it("prompts when closing the active (dirty) tab", () => {
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: true,
				action: "close",
				targetId: "dashboard:a",
				activeId: "dashboard:a",
			}),
		).toBe(true);
	});

	it("does not prompt when closing a background tab", () => {
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: true,
				action: "close",
				targetId: "view:other",
				activeId: "dashboard:a",
			}),
		).toBe(false);
	});
});

describe("reorderTabs", () => {
	const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);
	const strip = () =>
		[{ id: "workspace" }, { id: "a" }, { id: "b" }, { id: "c" }];

	it("moves a tab to an earlier gap", () => {
		expect(ids(reorderTabs(strip(), "c", 1))).toEqual([
			"workspace",
			"c",
			"a",
			"b",
		]);
	});

	it("moves a tab to the end", () => {
		expect(ids(reorderTabs(strip(), "a", 4))).toEqual([
			"workspace",
			"b",
			"c",
			"a",
		]);
	});

	it("clamps a drop before the pinned tab to index 1", () => {
		expect(ids(reorderTabs(strip(), "c", 0))).toEqual([
			"workspace",
			"c",
			"a",
			"b",
		]);
	});

	it("never moves the pinned workspace tab", () => {
		const s = strip();
		expect(reorderTabs(s, "workspace", 3)).toBe(s);
	});

	it("returns the same array when a tab is dropped back where it started", () => {
		const s = strip();
		expect(reorderTabs(s, "b", 2)).toBe(s); // gap before b
		expect(reorderTabs(s, "b", 3)).toBe(s); // gap after b
	});

	it("is a no-op for the only non-pinned tab", () => {
		const s = [{ id: "workspace" }, { id: "a" }];
		expect(reorderTabs(s, "a", 1)).toBe(s);
		expect(reorderTabs(s, "a", 2)).toBe(s);
	});
});
