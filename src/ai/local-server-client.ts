/**
 * HTTP client for an OpenAI-compatible local model server (LM Studio, Ollama,
 * Jan, llama.cpp server, …): `GET /models` and a streamed
 * `POST /chat/completions`.
 *
 * Node `http`/`https`, not `fetch`: a request from Obsidian's renderer via
 * `fetch` is a cross-origin browser request, so it would depend on the
 * server's CORS setting. Node's client doesn't, so the CORS toggle in LM
 * Studio and friends is irrelevant here.
 *
 * Mobile safety: the same pattern as `src/mcp/server.ts`. Every function that
 * touches Node checks `Platform.isDesktop` as its very first statement, and
 * `node:http`/`node:https` are only ever `require`d after that guard, so the
 * module graph that loads on mobile never evaluates a Node builtin. The
 * stream parsing itself is pure and lives in `src/core/ai/openai-stream.ts`.
 */

import { Platform } from "obsidian";
import {
	createToolCallAccumulator,
	parseSseChunk,
	type AccumulatedCompletion,
} from "../core/ai/openai-stream";

/** What a pending request rejects with when its `AbortSignal` fires (Stop). */
export class LocalServerAbortError extends Error {
	constructor() {
		super("The request was stopped.");
		this.name = "LocalServerAbortError";
	}
}

/** A non-2xx response. `status` feeds `describeLocalServerError`; `message` is the server's own error text when it sent one. */
export class LocalServerHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "LocalServerHttpError";
	}
}

type IncomingMessage = import("node:http").IncomingMessage;
type ClientRequest = import("node:http").ClientRequest;
type NodeTransport = Pick<typeof import("node:http"), "request">;

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function desktopOnly(): Error {
	return new Error("Local model servers are only available in Obsidian on desktop.");
}

/** Joins the base URL (already stripped of a trailing `/`) and an API path. */
function endpoint(baseUrl: string, path: string): URL {
	return new URL(`${baseUrl.replace(/\/+$/, "")}${path}`);
}

function headers(apiKey: string, extra: Record<string, string>): Record<string, string> {
	return apiKey ? { ...extra, Authorization: `Bearer ${apiKey}` } : extra;
}

/** Collects a whole (small) response body as text. */
function readBody(response: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let text = "";
		response.setEncoding("utf8");
		response.on("data", (chunk: string) => {
			text += chunk;
		});
		response.on("end", () => resolve(text));
		response.on("error", reject);
	});
}

/** The server's own error message from an error body (`{ error: { message } }`, `{ error: "…" }`, or `{ message }`), else a generic status line. */
function httpError(status: number, body: string): LocalServerHttpError {
	let message = `The server answered with HTTP ${status}.`;
	try {
		const parsed = JSON.parse(body) as {
			error?: string | { message?: unknown };
			message?: unknown;
		};
		const candidate =
			typeof parsed.error === "string"
				? parsed.error
				: typeof parsed.error?.message === "string"
					? parsed.error.message
					: typeof parsed.message === "string"
						? parsed.message
						: null;
		if (candidate) message = candidate;
	} catch {
		const trimmed = body.trim();
		if (trimmed && trimmed.length < 300) message = trimmed;
	}
	return new LocalServerHttpError(status, message);
}

/**
 * Opens a request and resolves with the response once headers arrive. The
 * caller owns the returned `ClientRequest` for aborting. `transport` is
 * `node:http` or `node:https`, `require`d by the caller behind its own
 * `Platform.isDesktop` guard.
 */
function open(
	transport: NodeTransport,
	url: URL,
	method: "GET" | "POST",
	requestHeaders: Record<string, string>,
	body: Uint8Array | null,
): { request: ClientRequest; response: Promise<IncomingMessage> } {
	let request!: ClientRequest;
	const response = new Promise<IncomingMessage>((resolve, reject) => {
		request = transport.request(
			url,
			{
				method,
				headers: body ? { ...requestHeaders, "Content-Length": String(body.byteLength) } : requestHeaders,
			},
			resolve,
		);
		request.on("error", reject);
		if (body) request.write(body);
		request.end();
	});
	return { request, response };
}

/**
 * `node:https` for an `https:` URL, else `node:http`. Takes the two lazily
 * `require`d modules from the caller, which must have passed its own
 * `Platform.isDesktop` guard first.
 */
function transportFor(
	url: URL,
	http: () => NodeTransport,
	https: () => NodeTransport,
): NodeTransport {
	return url.protocol === "https:" ? https() : http();
}

/** Model ids the server lists (`GET {baseUrl}/models` → `data[].id`). */
export async function listModels(baseUrl: string, apiKey: string): Promise<string[]> {
	if (!Platform.isDesktop) throw desktopOnly();
	const url = endpoint(baseUrl, "/models");
	// A literal dynamic `import()` of a bare "node:" specifier fails in
	// Obsidian's CJS plugin sandbox — `require` works because esbuild's `cjs`
	// output wraps this bundle with a real CJS `require`, and the builtins are
	// left untouched by the `external` list in esbuild.config.mjs. Same as
	// `src/mcp/server.ts`.
	const transport = transportFor(
		url,
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- see comment above
		() => require("node:http") as typeof import("node:http"),
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- see comment above
		() => require("node:https") as typeof import("node:https"),
	);
	const { response } = open(
		transport,
		url,
		"GET",
		headers(apiKey, { Accept: "application/json" }),
		null,
	);
	const res = await response;
	const text = await readBody(res);
	const status = res.statusCode ?? 0;
	if (status < 200 || status >= 300) throw httpError(status, text);
	let parsed: { data?: { id?: unknown }[] };
	try {
		parsed = JSON.parse(text) as { data?: { id?: unknown }[] };
	} catch {
		throw new Error("The server's model list wasn't valid JSON. Is this an OpenAI-compatible /v1 URL?");
	}
	return (parsed.data ?? [])
		.map((model) => model.id)
		.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export interface StreamChatCompletionOptions {
	baseUrl: string;
	apiKey: string;
	/** The request body minus `stream`/`stream_options`, which are always set here. */
	body: Record<string, unknown>;
	onContentDelta: (text: string) => void;
	signal: AbortSignal;
}

/**
 * Streams one `/chat/completions` round, feeding content fragments to
 * `onContentDelta` as they arrive and resolving with the accumulated content,
 * tool calls, finish reason and usage. There is deliberately no timeout: a
 * server may load the model just in time on the first request, so a slow
 * first token is normal. `signal` destroys the request and rejects with
 * `LocalServerAbortError`.
 */
export async function streamChatCompletion({
	baseUrl,
	apiKey,
	body,
	onContentDelta,
	signal,
}: StreamChatCompletionOptions): Promise<AccumulatedCompletion> {
	if (!Platform.isDesktop) throw desktopOnly();
	if (signal.aborted) throw new LocalServerAbortError();

	const payload = new TextEncoder().encode(
		JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
	);
	const url = endpoint(baseUrl, "/chat/completions");
	const transport = transportFor(
		url,
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- see listModels()'s identical node:http comment
		() => require("node:http") as typeof import("node:http"),
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- see listModels()'s identical node:http comment
		() => require("node:https") as typeof import("node:https"),
	);
	const { request, response } = open(
		transport,
		url,
		"POST",
		headers(apiKey, { "Content-Type": "application/json", Accept: "text/event-stream" }),
		payload,
	);

	return new Promise<AccumulatedCompletion>((resolve, reject) => {
		let settled = false;
		const finish = (outcome: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			outcome();
		};
		const onAbort = () => {
			request.destroy();
			finish(() => reject(new LocalServerAbortError()));
		};
		signal.addEventListener("abort", onAbort);

		response.then(
			(res) => {
				const status = res.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					void readBody(res).then(
						(text) => finish(() => reject(httpError(status, text))),
						(error: unknown) => finish(() => reject(asError(error))),
					);
					return;
				}

				const accumulator = createToolCallAccumulator();
				let buffer = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					if (settled) return;
					const parsed = parseSseChunk(buffer + chunk);
					buffer = parsed.rest;
					for (const event of parsed.events) {
						const text = accumulator.push(event);
						if (text) onContentDelta(text);
					}
					if (parsed.done) {
						finish(() => resolve(accumulator.result()));
						res.destroy();
					}
				});
				res.on("end", () => {
					// A final event without the trailing blank line still counts.
					for (const event of parseSseChunk(`${buffer}\n\n`).events) {
						const text = accumulator.push(event);
						if (text) onContentDelta(text);
					}
					finish(() => resolve(accumulator.result()));
				});
				res.on("error", (error) => finish(() => reject(error)));
			},
			(error: unknown) => finish(() => reject(asError(error))),
		);
	});
}
