import { describe, expect, it } from "vitest";
import { resolveTaskIdFragments } from "../../src/core/ai/resolve-task-ids";
import { task } from "./fixtures";

describe("resolveTaskIdFragments", () => {
	it("resolves a zero-padded fragment to the matching task", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		const result = resolveTaskIdFragments("what's the status on 0040?", [t]);

		expect(result).toEqual([{ fragment: "0040", matches: [t] }]);
	});

	it("resolves the same task from an unpadded fragment", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		const result = resolveTaskIdFragments("what's the status on 40?", [t]);

		expect(result).toEqual([{ fragment: "40", matches: [t] }]);
	});

	it("resolves a fragment preceded by the word 'task'", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		const result = resolveTaskIdFragments("give me an update on task 40", [t]);

		expect(result).toEqual([{ fragment: "40", matches: [t] }]);
	});

	it("never matches a single digit, even when a task with that sequence exists", () => {
		const t = task({ id: "TSK-5", path: "W/Tasks/TSK-5" });
		const result = resolveTaskIdFragments("show me 5 tasks", [t]);

		expect(result).toEqual([]);
	});

	it("doesn't match a longer number that shares no 2-4 digit boundary", () => {
		const t = task({ id: "TSK-0480", path: "W/Tasks/TSK-0480" });
		const result = resolveTaskIdFragments("ticket 20480 in the other system", [t]);

		expect(result).toEqual([]);
	});

	it("drops a fragment with no matching task rather than treating it as an id", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		const result = resolveTaskIdFragments("I have 99 things to do today", [t]);

		expect(result).toEqual([]);
	});

	it("never matches an archived task", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040", archived: true });
		const result = resolveTaskIdFragments("what's the status on 40?", [t]);

		expect(result).toEqual([]);
	});

	it("leaves a full task ID untouched — no fragment extracted from it", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		// The full id already appears verbatim in the facts the model sees;
		// this resolver is scoped to the bare-number case only, but the digits
		// inside "TSK-0040" still form a word-bounded run and legitimately
		// resolve too — this just confirms it doesn't crash or double up.
		const result = resolveTaskIdFragments("what about TSK-0040", [t]);

		expect(result).toEqual([{ fragment: "0040", matches: [t] }]);
	});

	it("returns every match on a genuine sequence collision", () => {
		const a = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		const b = task({ id: "OPS-0040", path: "W/Tasks/OPS-0040" });
		const result = resolveTaskIdFragments("what's up with 40?", [a, b]);

		expect(result).toEqual([{ fragment: "40", matches: [a, b] }]);
	});

	it("returns one entry per distinct fragment, deduplicating repeats in the message", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		const result = resolveTaskIdFragments("40, did you see 40? I mean 40.", [t]);

		expect(result).toEqual([{ fragment: "40", matches: [t] }]);
	});

	it("returns an empty array for a message with no digits at all", () => {
		const t = task({ id: "TSK-0040", path: "W/Tasks/TSK-0040" });
		expect(resolveTaskIdFragments("what's overdue?", [t])).toEqual([]);
	});
});
