/**
 * Server-sent-events parsing and delta accumulation for a streamed OpenAI
 * `/chat/completions` response. Pure over strings and parsed JSON, so the
 * fiddly parts — events split across network chunks, tool-call arguments
 * arriving a few characters at a time, servers that repeat ids, reasoning
 * arriving in any of three shapes — are unit tested without a server. The
 * Node transport that feeds it lives in `src/ai/local-server-client.ts`.
 *
 * Reasoning ("thinking") is kept apart from the answer everywhere: it's shown
 * live and in the Steps timeline, but never becomes part of `content`, so it
 * never reaches the request history sent back to the model.
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
	/** The answer text, with any inline `<think>…</think>` blocks removed. */
	content: string;
	/** All reasoning from every source (`reasoning_content`, `reasoning`, inline `<think>`), concatenated. Display-only. */
	reasoning: string;
	toolCalls: AccumulatedToolCall[];
	finishReason: string | null;
	usage?: CompletionUsage;
}

/** The display fragments one stream event (or a flush) carried. */
export interface StreamFragments {
	content: string;
	reasoning: string;
}

export interface ToolCallAccumulator {
	/** Folds in one parsed stream event; returns the answer and reasoning fragments it carried (`""` for none). */
	push(event: unknown): StreamFragments;
	/** Releases text the `<think>` splitter held back as a possible partial tag. Call once, at stream end. */
	flush(): StreamFragments;
	/** The accumulated completion. Flushes the splitter first if `flush()` wasn't called. */
	result(): AccumulatedCompletion;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * Splits streamed content on inline `<think>…</think>` blocks (models whose
 * reasoning arrives in the content stream rather than a separate field).
 * Tags can straddle chunks (`"<thi"` + `"nk>"`), so only a suffix that could
 * still become the tag being looked for is held back; everything else is
 * released immediately. Only the exact lowercase `<think>` / `</think>` are
 * recognized, with no attributes. `flush()` releases whatever is held back at
 * stream end — into reasoning if a `<think>` was never closed.
 */
export function createThinkTagSplitter(): {
	push(text: string): StreamFragments;
	flush(): StreamFragments;
} {
	let inThink = false;
	let held = "";

	return {
		push(text) {
			let buffer = held + text;
			held = "";
			let content = "";
			let reasoning = "";
			const emit = (part: string) => {
				if (inThink) reasoning += part;
				else content += part;
			};
			while (buffer) {
				const tag = inThink ? THINK_CLOSE : THINK_OPEN;
				const at = buffer.indexOf(tag);
				if (at >= 0) {
					emit(buffer.slice(0, at));
					buffer = buffer.slice(at + tag.length);
					inThink = !inThink;
					continue;
				}
				let keep = 0;
				for (let k = Math.min(tag.length - 1, buffer.length); k > 0; k--) {
					if (tag.startsWith(buffer.slice(-k))) {
						keep = k;
						break;
					}
				}
				emit(buffer.slice(0, buffer.length - keep));
				held = buffer.slice(buffer.length - keep);
				buffer = "";
			}
			return { content, reasoning };
		},
		flush() {
			const rest = held;
			held = "";
			return inThink ? { content: "", reasoning: rest } : { content: rest, reasoning: "" };
		},
	};
}

interface ToolCallDelta {
	index?: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

interface StreamEvent {
	choices?: {
		delta?: {
			content?: string | null;
			/** LM Studio / Bionic, DeepSeek-style servers. */
			reasoning_content?: string | null;
			/** Ollama. */
			reasoning?: string | null;
			tool_calls?: ToolCallDelta[];
		};
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
 *
 * Reasoning is collected from `delta.reasoning_content`, `delta.reasoning`,
 * and inline `<think>` blocks in `delta.content` (via
 * `createThinkTagSplitter`), and kept out of `content`.
 */
export function createToolCallAccumulator(): ToolCallAccumulator {
	let content = "";
	let reasoning = "";
	let flushed = false;
	const splitter = createThinkTagSplitter();
	let finishReason: string | null = null;
	let usage: CompletionUsage | undefined;
	const calls = new Map<number, { id?: string; name?: string; arguments: string }>();

	const flush = (): StreamFragments => {
		if (flushed) return { content: "", reasoning: "" };
		flushed = true;
		const rest = splitter.flush();
		content += rest.content;
		reasoning += rest.reasoning;
		return rest;
	};

	return {
		push(event) {
			const none = { content: "", reasoning: "" };
			if (event == null || typeof event !== "object") return none;
			const { choices, usage: eventUsage } = event as StreamEvent;
			if (eventUsage) usage = eventUsage;
			const choice = choices?.[0];
			if (!choice) return none;
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

			let reasoningPart = "";
			if (typeof delta?.reasoning_content === "string") reasoningPart += delta.reasoning_content;
			if (typeof delta?.reasoning === "string") reasoningPart += delta.reasoning;
			const split = splitter.push(typeof delta?.content === "string" ? delta.content : "");
			reasoningPart += split.reasoning;
			content += split.content;
			reasoning += reasoningPart;
			return { content: split.content, reasoning: reasoningPart };
		},
		flush,
		result() {
			flush();
			const toolCalls = [...calls.entries()]
				.sort(([a], [b]) => a - b)
				.map(([, call], n) => ({
					id: call.id ?? `call_${n}`,
					name: call.name ?? "",
					arguments: call.arguments,
				}));
			return { content, reasoning, toolCalls, finishReason, ...(usage ? { usage } : {}) };
		},
	};
}
