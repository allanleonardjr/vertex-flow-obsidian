/**
 * Server-sent-events parsing and delta accumulation for a streamed OpenAI
 * `/chat/completions` response. Pure over strings and parsed JSON, so the
 * fiddly parts — events split across network chunks, tool-call arguments
 * arriving a few characters at a time, servers that repeat ids — are unit
 * tested without a server. The Node transport that feeds it lives in
 * `src/ai/local-server-client.ts`.
 */

export interface SseParseResult {
	/** Every complete `data:` payload in the buffer, parsed as JSON (unparseable payloads are skipped). */
	events: unknown[];
	/** A trailing partial event — prepend it to the next network chunk. */
	rest: string;
	/** Whether a `data: [DONE]` sentinel was seen. */
	done: boolean;
}

/** Splits a buffer on blank lines into complete SSE events, keeping any incomplete trailing event in `rest`. */
export function parseSseChunk(buffer: string): SseParseResult {
	const normalized = buffer.replace(/\r\n?/g, "\n");
	const blocks = normalized.split("\n\n");
	const rest = blocks.pop() ?? "";
	const events: unknown[] = [];
	let done = false;
	for (const block of blocks) {
		const data = block
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""))
			.join("\n");
		if (!data) continue;
		if (data.trim() === "[DONE]") {
			done = true;
			continue;
		}
		try {
			events.push(JSON.parse(data));
		} catch {
			// A malformed event is dropped rather than failing the whole stream.
		}
	}
	return { events, rest, done };
}

export interface AccumulatedToolCall {
	id: string;
	name: string;
	/** Raw JSON text, concatenated from every fragment. Parsed (and validated) by the caller. */
	arguments: string;
}

export interface CompletionUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
}

export interface AccumulatedCompletion {
	content: string;
	toolCalls: AccumulatedToolCall[];
	finishReason: string | null;
	usage?: CompletionUsage;
}

export interface ToolCallAccumulator {
	/** Folds in one parsed stream event; returns the content fragment it carried (`""` if none). */
	push(event: unknown): string;
	result(): AccumulatedCompletion;
}

interface ToolCallDelta {
	index?: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

interface StreamEvent {
	choices?: {
		delta?: { content?: string | null; tool_calls?: ToolCallDelta[] };
		finish_reason?: string | null;
	}[];
	usage?: CompletionUsage | null;
}

/**
 * Accumulates `choices[0].delta` across a stream. Tool calls are keyed by
 * `index` (parallel calls interleave on different indices); `arguments` are
 * concatenated, but `id` and `function.name` are taken from the first chunk
 * that carries them and never touched again — some servers (Qwen-family
 * templates) resend the full id on every chunk, and concatenating it would
 * produce an id the next request can't match. A call that never gets an id
 * is given `call_<n>`.
 */
export function createToolCallAccumulator(): ToolCallAccumulator {
	let content = "";
	let finishReason: string | null = null;
	let usage: CompletionUsage | undefined;
	const calls = new Map<number, { id?: string; name?: string; arguments: string }>();

	return {
		push(event) {
			if (event == null || typeof event !== "object") return "";
			const { choices, usage: eventUsage } = event as StreamEvent;
			if (eventUsage) usage = eventUsage;
			const choice = choices?.[0];
			if (!choice) return "";
			if (choice.finish_reason) finishReason = choice.finish_reason;

			const delta = choice.delta;
			(delta?.tool_calls ?? []).forEach((fragment, position) => {
				const index = typeof fragment.index === "number" ? fragment.index : position;
				const call = calls.get(index) ?? { arguments: "" };
				if (!call.id && fragment.id) call.id = fragment.id;
				if (!call.name && fragment.function?.name) call.name = fragment.function.name;
				if (fragment.function?.arguments) call.arguments += fragment.function.arguments;
				calls.set(index, call);
			});

			const text = typeof delta?.content === "string" ? delta.content : "";
			content += text;
			return text;
		},
		result() {
			const toolCalls = [...calls.entries()]
				.sort(([a], [b]) => a - b)
				.map(([, call], n) => ({
					id: call.id ?? `call_${n}`,
					name: call.name ?? "",
					arguments: call.arguments,
				}));
			return { content, toolCalls, finishReason, ...(usage ? { usage } : {}) };
		},
	};
}
