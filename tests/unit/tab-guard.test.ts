import { describe, expect, it } from "vitest";
import { shouldPromptUnsavedGuard } from "../../src/ui/tabs-guard";

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
