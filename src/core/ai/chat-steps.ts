/**
 * The Steps timeline for one local-server AI Chat answer — each model round
 * and each tool call, with timings — plus the pure text summaries the chat
 * shows for them: the live one-line activity status under the thinking dots,
 * compact tool-argument and tool-result summaries, and elapsed times.
 *
 * Display-only, like reasoning itself: steps are never sent back to the
 * model and never written to disk. Pure (no Obsidian API, no Node), so every
 * summary is unit tested.
 */

export type ChatStep =
	| {
			kind: "model";
			/** 1-based round number within the answer. */
			round: number;
			/** ms since epoch. */
			startedAt: number;
			/** The first content OR reasoning fragment. Unset while the server is still processing the prompt. */
			firstTokenAt?: number;
			endedAt?: number;
			reasoning: string;
	  }
	| {
			kind: "tool";
			name: string;
			argsSummary: string;
			startedAt: number;
			endedAt?: number;
			outcome?: { isError: boolean; summary: string };
	  };

const ARG_VALUE_MAX = 40;
const ARGS_SUMMARY_MAX = 120;
const RESULT_ERROR_MAX = 80;
/** Results longer than this also report their size in the summary. */
const LONG_RESULT_CHARS = 2000;

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function summarizeValue(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value ? clip(value, ARG_VALUE_MAX) : null;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		const parts = value
			.map((item) => (typeof item === "object" && item != null ? "{…}" : String(item)))
			.filter((item) => item !== "");
		return parts.length > 0 ? clip(parts.join("/"), ARG_VALUE_MAX) : null;
	}
	if (typeof value === "object") return Object.keys(value).length > 0 ? "{…}" : null;
	return null;
}

/** `query: is:open, showArchived: true` — compact `key: value` pairs, empty values omitted. `""` for no arguments. */
export function summarizeToolArgs(args: Record<string, unknown>): string {
	const pairs = Object.entries(args)
		.map(([key, value]) => {
			const summary = summarizeValue(value);
			return summary == null ? null : `${key}: ${summary}`;
		})
		.filter((pair): pair is string => pair != null);
	return clip(pairs.join(", "), ARGS_SUMMARY_MAX);
}

/** `42 results`, `error: No workspace matches…`, `done` — one short phrase for a tool's outcome. */
export function summarizeToolResult(text: string, isError: boolean): string {
	let payload: unknown = null;
	try {
		payload = JSON.parse(text);
	} catch {
		// Not JSON — fall through to the plain-text summaries below.
	}
	if (payload != null && typeof payload === "object" && !Array.isArray(payload)) {
		const record = payload as {
			error?: { message?: unknown };
			total?: unknown;
			truncated?: unknown;
			results?: unknown;
		};
		const message = record.error?.message;
		if (typeof message === "string" && message) return `error: ${clip(message, RESULT_ERROR_MAX)}`;
		if (typeof record.total === "number") {
			const shown =
				record.truncated === true
					? `, showing ${Array.isArray(record.results) ? record.results.length : 200}`
					: "";
			return `${record.total} result${record.total === 1 ? "" : "s"}${shown}`;
		}
	}
	if (isError) {
		const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
		return firstLine ? `error: ${clip(firstLine.trim(), RESULT_ERROR_MAX)}` : "error";
	}
	return text.length > LONG_RESULT_CHARS ? `done, ${text.length.toLocaleString("en-US")} chars` : "done";
}

/** `0.8s` under 10 seconds, `14s` under a minute, `1m 05s` above. */
export function formatElapsed(ms: number): string {
	const safe = Math.max(0, ms);
	if (safe < 10_000) return `${(safe / 1000).toFixed(1)}s`;
	const seconds = Math.floor(safe / 1000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** The last model round in `steps`, if any. */
export function lastModelStep(
	steps: ChatStep[],
): Extract<ChatStep, { kind: "model" }> | undefined {
	for (let i = steps.length - 1; i >= 0; i--) {
		const step = steps[i];
		if (step.kind === "model") return step;
	}
	return undefined;
}

/** How long a model round has been thinking: from its first fragment to its end, or to `now` while it's still open. */
export function thinkingElapsed(step: Extract<ChatStep, { kind: "model" }>, now: number): number {
	return (step.endedAt ?? now) - (step.firstTokenAt ?? step.startedAt);
}

/** The live one-line status under the thinking dots, from the answer's last step. */
export function describeActivity(steps: ChatStep[], now: number, hasAnswerText: boolean): string {
	const last = steps[steps.length - 1];
	if (!last) return "Sending…";
	if (last.kind === "model") {
		if (last.firstTokenAt == null) {
			return `Waiting for the model · ${formatElapsed(now - last.startedAt)}`;
		}
		if (!hasAnswerText && last.reasoning) {
			return `Thinking · ${formatElapsed(thinkingElapsed(last, now))}`;
		}
		return "Writing answer…";
	}
	if (last.outcome) return `${last.name}: ${last.outcome.summary}`;
	if (last.endedAt == null) return `Running ${last.name}…`;
	return `${last.name}: done`;
}

/** The whole answer's span: the first step's start to the latest end. */
export function totalElapsed(steps: ChatStep[]): number {
	if (steps.length === 0) return 0;
	const start = steps[0].startedAt;
	const end = Math.max(...steps.map((step) => step.endedAt ?? step.startedAt));
	return end - start;
}
