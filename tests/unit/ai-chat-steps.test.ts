import { describe, expect, it } from "vitest";
import {
	combinedReasoning,
	describeActivity,
	formatElapsed,
	formatToolPayload,
	lastModelStep,
	summarizeToolArgs,
	summarizeToolResult,
	thinkingElapsed,
	totalElapsed,
	type ChatStep,
} from "../../src/core/ai/chat-steps";

describe("summarizeToolArgs", () => {
	it("returns an empty string for no arguments", () => {
		expect(summarizeToolArgs({})).toBe("");
	});

	it("shows strings bare, numbers and booleans as-is, arrays joined with /", () => {
		expect(
			summarizeToolArgs({ query: "is:open sort:due", limit: 5, showArchived: true, labels: ["a", "b"] }),
		).toBe("query: is:open sort:due, limit: 5, showArchived: true, labels: a/b");
	});

	it("omits null, undefined and empty values", () => {
		expect(summarizeToolArgs({ a: null, b: undefined, c: "", d: [], e: {}, f: "kept" })).toBe("f: kept");
	});

	it("collapses nested objects", () => {
		expect(summarizeToolArgs({ filters: { status: "done" } })).toBe("filters: {…}");
	});

	it("truncates long strings and the whole summary", () => {
		const long = "x".repeat(100);
		expect(summarizeToolArgs({ query: long })).toBe(`query: ${"x".repeat(39)}…`);
		const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`key${i}`, "y".repeat(30)]));
		const summary = summarizeToolArgs(many);
		expect(summary.length).toBeLessThanOrEqual(120);
		expect(summary.endsWith("…")).toBe(true);
	});
});

describe("summarizeToolResult", () => {
	it("reports an MCP error payload's message", () => {
		expect(
			summarizeToolResult(JSON.stringify({ error: { code: "unknown-workspace", message: "No workspace matches" } }), true),
		).toBe("error: No workspace matches");
	});

	it("counts results, noting a truncated list", () => {
		expect(summarizeToolResult(JSON.stringify({ results: [{}, {}], total: 42 }), false)).toBe("42 results");
		expect(summarizeToolResult(JSON.stringify({ total: 1 }), false)).toBe("1 result");
		expect(
			summarizeToolResult(
				JSON.stringify({ results: Array.from({ length: 200 }, () => ({})), total: 350, truncated: true }),
				false,
			),
		).toBe("350 results, showing 200");
	});

	it("uses the first line of any other error", () => {
		expect(summarizeToolResult("\nTool list_tasks not found\nmore", true)).toBe("error: Tool list_tasks not found");
		expect(summarizeToolResult("", true)).toBe("error");
	});

	it("says done, with the size for long results", () => {
		expect(summarizeToolResult(JSON.stringify({ workspace: { id: "W" } }), false)).toBe("done");
		expect(summarizeToolResult("z".repeat(2500), false)).toBe("done, 2,500 chars");
	});
});

describe("formatToolPayload", () => {
	it("returns an empty string for null/undefined", () => {
		expect(formatToolPayload(null)).toBe("");
		expect(formatToolPayload(undefined)).toBe("");
	});

	it("pretty-prints an object", () => {
		expect(formatToolPayload({ query: "is:open", limit: 5 })).toBe(
			'{\n  "query": "is:open",\n  "limit": 5\n}',
		);
	});

	it("pretty-prints a JSON string", () => {
		expect(formatToolPayload('{"total":2,"results":[]}')).toBe(
			'{\n  "total": 2,\n  "results": []\n}',
		);
	});

	it("returns non-JSON text as-is", () => {
		expect(formatToolPayload("Tool list_tasks not found")).toBe(
			"Tool list_tasks not found",
		);
	});
});

describe("combinedReasoning", () => {
	const model = (reasoning: string, round = 1): ChatStep => ({
		kind: "model",
		round,
		startedAt: 0,
		reasoning,
	});
	const tool = (): ChatStep => ({
		kind: "tool",
		name: "list_tasks",
		argsSummary: "",
		startedAt: 0,
	});

	it("returns an empty string with no reasoning anywhere", () => {
		expect(combinedReasoning([])).toBe("");
		expect(combinedReasoning([model("   "), tool()])).toBe("");
	});

	it("joins every round's non-empty reasoning in order", () => {
		expect(
			combinedReasoning([model("first thought"), tool(), model("second thought", 2)]),
		).toBe("first thought\n\nsecond thought");
	});

	it("skips whitespace-only rounds without leaving a gap", () => {
		expect(
			combinedReasoning([model("first thought"), model("  \n", 2), model("third thought", 3)]),
		).toBe("first thought\n\nthird thought");
	});
});

describe("formatElapsed", () => {
	it("uses one decimal under 10 seconds", () => {
		expect(formatElapsed(800)).toBe("0.8s");
		expect(formatElapsed(9_940)).toBe("9.9s");
		expect(formatElapsed(-5)).toBe("0.0s");
	});

	it("uses whole seconds under a minute", () => {
		expect(formatElapsed(14_300)).toBe("14s");
	});

	it("uses minutes and padded seconds above", () => {
		expect(formatElapsed(65_000)).toBe("1m 05s");
		expect(formatElapsed(3_723_000)).toBe("62m 03s");
	});
});

describe("describeActivity", () => {
	const model = (extra: Partial<Extract<ChatStep, { kind: "model" }>> = {}): ChatStep => ({
		kind: "model",
		round: 1,
		startedAt: 1_000,
		reasoning: "",
		...extra,
	});
	const tool = (extra: Partial<Extract<ChatStep, { kind: "tool" }>> = {}): ChatStep => ({
		kind: "tool",
		name: "list_tasks",
		argsSummary: "",
		startedAt: 5_000,
		...extra,
	});

	it("says Sending before any step", () => {
		expect(describeActivity([], 0, false)).toBe("Sending…");
	});

	it("counts the wait for a model's first token", () => {
		expect(describeActivity([model()], 13_000, false)).toBe("Waiting for the model · 12s");
	});

	it("reports thinking while reasoning streams and no answer text yet", () => {
		expect(describeActivity([model({ firstTokenAt: 2_000, reasoning: "hmm" })], 10_000, false)).toBe(
			"Thinking · 8.0s",
		);
	});

	it("reports writing once answer text streams", () => {
		expect(describeActivity([model({ firstTokenAt: 2_000, reasoning: "hmm" })], 10_000, true)).toBe(
			"Writing answer…",
		);
		expect(describeActivity([model({ firstTokenAt: 2_000 })], 10_000, true)).toBe("Writing answer…");
	});

	it("reports a running tool, then its outcome until the next round starts", () => {
		expect(describeActivity([model({ endedAt: 4_000 }), tool()], 6_000, false)).toBe("Running list_tasks…");
		expect(
			describeActivity(
				[model({ endedAt: 4_000 }), tool({ endedAt: 5_500, outcome: { isError: false, summary: "42 results" } })],
				6_000,
				false,
			),
		).toBe("list_tasks: 42 results");
		expect(
			describeActivity(
				[
					model({ endedAt: 4_000 }),
					tool({ endedAt: 5_500, outcome: { isError: false, summary: "42 results" } }),
					model({ round: 2, startedAt: 6_000 }),
				],
				7_000,
				false,
			),
		).toBe("Waiting for the model · 1.0s");
	});
});

describe("step helpers", () => {
	const steps: ChatStep[] = [
		{ kind: "model", round: 1, startedAt: 1_000, firstTokenAt: 1_500, endedAt: 3_000, reasoning: "r1" },
		{ kind: "tool", name: "find", argsSummary: "", startedAt: 3_000, endedAt: 3_200 },
		{ kind: "model", round: 2, startedAt: 3_200, reasoning: "" },
	];

	it("finds the last model round", () => {
		expect(lastModelStep(steps)).toBe(steps[2]);
		expect(lastModelStep([])).toBeUndefined();
	});

	it("measures thinking from the first fragment to the end or now", () => {
		expect(thinkingElapsed(steps[0] as Extract<ChatStep, { kind: "model" }>, 9_999)).toBe(1_500);
		expect(thinkingElapsed(steps[2] as Extract<ChatStep, { kind: "model" }>, 4_200)).toBe(1_000);
	});

	it("spans the first start to the latest end", () => {
		expect(totalElapsed(steps)).toBe(2_200);
		expect(totalElapsed([])).toBe(0);
	});
});
