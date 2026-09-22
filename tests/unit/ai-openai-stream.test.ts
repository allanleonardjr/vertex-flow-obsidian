import { describe, expect, it } from "vitest";
import { createToolCallAccumulator, parseSseChunk } from "../../src/core/ai/openai-stream";

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe("parseSseChunk", () => {
	it("parses complete events and keeps a partial trailing one", () => {
		const buffer = event({ n: 1 }) + event({ n: 2 }) + 'data: {"n":';
		const result = parseSseChunk(buffer);
		expect(result.events).toEqual([{ n: 1 }, { n: 2 }]);
		expect(result.rest).toBe('data: {"n":');
		expect(result.done).toBe(false);
	});

	it("completes a partial event once the rest arrives", () => {
		const first = parseSseChunk('data: {"n":');
		const second = parseSseChunk(`${first.rest}3}\n\n`);
		expect(second.events).toEqual([{ n: 3 }]);
		expect(second.rest).toBe("");
	});

	it("recognises [DONE] and CRLF line endings", () => {
		const result = parseSseChunk('data: {"n":1}\r\n\r\ndata: [DONE]\r\n\r\n');
		expect(result.events).toEqual([{ n: 1 }]);
		expect(result.done).toBe(true);
	});

	it("ignores comments, non-data fields and malformed JSON", () => {
		const result = parseSseChunk(": keep-alive\n\nevent: ping\n\ndata: {oops\n\n" + event({ ok: true }));
		expect(result.events).toEqual([{ ok: true }]);
	});
});

describe("createToolCallAccumulator", () => {
	const delta = (d: unknown, extra: Record<string, unknown> = {}) => ({
		choices: [{ delta: d, finish_reason: null }],
		...extra,
	});

	it("accumulates content and returns each fragment", () => {
		const acc = createToolCallAccumulator();
		expect(acc.push(delta({ content: "Hel" }))).toBe("Hel");
		expect(acc.push(delta({ content: "lo" }))).toBe("lo");
		acc.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
		expect(acc.result()).toEqual({ content: "Hello", toolCalls: [], finishReason: "stop" });
	});

	it("concatenates tool-call arguments across chunks", () => {
		const acc = createToolCallAccumulator();
		acc.push(delta({ tool_calls: [{ index: 0, id: "call_a", function: { name: "list_tasks", arguments: '{"que' } }] }));
		acc.push(delta({ tool_calls: [{ index: 0, function: { arguments: 'ry":"is:open"}' } }] }));
		acc.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
		expect(acc.result()).toEqual({
			content: "",
			toolCalls: [{ id: "call_a", name: "list_tasks", arguments: '{"query":"is:open"}' }],
			finishReason: "tool_calls",
		});
	});

	it("keeps parallel calls on different indices apart, in index order", () => {
		const acc = createToolCallAccumulator();
		acc.push(delta({ tool_calls: [{ index: 1, id: "b", function: { name: "list_projects", arguments: "{}" } }] }));
		acc.push(delta({ tool_calls: [{ index: 0, id: "a", function: { name: "get_summary", arguments: "{" } }] }));
		acc.push(delta({ tool_calls: [{ index: 0, function: { arguments: "}" } }] }));
		expect(acc.result().toolCalls).toEqual([
			{ id: "a", name: "get_summary", arguments: "{}" },
			{ id: "b", name: "list_projects", arguments: "{}" },
		]);
	});

	it("never concatenates a repeated id or name", () => {
		const acc = createToolCallAccumulator();
		acc.push(delta({ tool_calls: [{ index: 0, id: "123", function: { name: "find", arguments: '{"q":' } }] }));
		acc.push(delta({ tool_calls: [{ index: 0, id: "123", function: { name: "find", arguments: '"x"}' } }] }));
		expect(acc.result().toolCalls).toEqual([{ id: "123", name: "find", arguments: '{"q":"x"}' }]);
	});

	it("generates an id for a call that never gets one", () => {
		const acc = createToolCallAccumulator();
		acc.push(delta({ tool_calls: [{ index: 0, function: { name: "get_stats", arguments: "{}" } }] }));
		expect(acc.result().toolCalls[0].id).toBe("call_0");
	});

	it("captures usage, including from a choice-less final event", () => {
		const acc = createToolCallAccumulator();
		acc.push(delta({ content: "hi" }));
		acc.push({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
		expect(acc.result().usage).toEqual({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
	});
});
