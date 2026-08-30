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

	it("never prompts on navigation, even away from a dirty active tab", () => {
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: true,
				action: "navigate",
				targetId: "dashboard:a",
				activeId: "workspace",
			}),
		).toBe(false);
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

	it("never prompts on navigation regardless of target (draft is in the shared store)", () => {
		for (const targetId of ["view:x", "dashboard:a", "workspace", "TSK-1"]) {
			expect(
				shouldPromptUnsavedGuard({
					hasGuard: true,
					action: "navigate",
					targetId,
					activeId: "dashboard:a",
				}),
			).toBe(false);
		}
	});

	it("prompts on close only when the closed tab is the active guarded one", () => {
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: true,
				action: "close",
				targetId: "view:x",
				activeId: "view:x",
			}),
		).toBe(true);
		expect(
			shouldPromptUnsavedGuard({
				hasGuard: false,
				action: "close",
				targetId: "view:x",
				activeId: "view:x",
			}),
		).toBe(false);
	});
});

describe("reorderTabs", () => {
	const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);
	const strip = () => [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

	it("moves a tab to an earlier gap", () => {
		expect(ids(reorderTabs(strip(), "d", 1))).toEqual(["a", "d", "b", "c"]);
	});

	it("moves a tab to the end", () => {
		expect(ids(reorderTabs(strip(), "a", 4))).toEqual(["b", "c", "d", "a"]);
	});

	it("moves a tab to the very front (index 0)", () => {
		expect(ids(reorderTabs(strip(), "c", 0))).toEqual(["c", "a", "b", "d"]);
	});

	it("moves the first tab away from index 0", () => {
		expect(ids(reorderTabs(strip(), "a", 3))).toEqual(["b", "c", "a", "d"]);
	});

	it("returns the same array when a tab is dropped back where it started", () => {
		const s = strip();
		expect(reorderTabs(s, "b", 1)).toBe(s); // gap before b
		expect(reorderTabs(s, "b", 2)).toBe(s); // gap after b
	});

	it("returns the same array when a tab isn't found", () => {
		const s = strip();
		expect(reorderTabs(s, "missing", 2)).toBe(s);
	});
});
