/**
 * WebLLM's worker-side handler. Runs entirely off the main thread so model
 * inference never blocks the Obsidian UI. Bundled as its own esbuild entry
 * point (see esbuild.config.mjs) into `webllm.worker.js`, loaded via
 * `new Worker(url)` from `AiEngineService`.
 */

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

/**
 * WebLLM's cache layer does a bare `fetch` per weight shard and throws on the
 * first non-2xx response — so one rate-limited shard out of ~60 aborts a
 * multi-gigabyte download that was otherwise fine. Hugging Face throttles
 * readily under its parallel fetching, which made installs fail at a different
 * shard every attempt. Retrying transient statuses here fixes it at the point
 * of failure, rather than tearing down and restarting the whole engine init.
 */
const MAX_FETCH_ATTEMPTS = 5;

function isTransient(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const nativeFetch = self.fetch.bind(self);

self.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
		try {
			const response = await nativeFetch(input, init);
			// A non-transient status (404, 403, …) is the caller's to interpret —
			// retrying it just delays a failure that won't resolve itself.
			if (response.ok || !isTransient(response.status)) return response;

			lastError = new Error(`HTTP ${response.status} for ${String(input)}`);
			console.warn(
				`Vertex Flow: retrying ${String(input)} after HTTP ${response.status} (attempt ${attempt}/${MAX_FETCH_ATTEMPTS})`,
			);
		} catch (error) {
			// An aborted request was cancelled deliberately — never retry it.
			if (init?.signal?.aborted) throw error;
			lastError = error;
			console.warn(
				`Vertex Flow: retrying ${String(input)} after network error (attempt ${attempt}/${MAX_FETCH_ATTEMPTS})`,
				error,
			);
		}

		if (attempt < MAX_FETCH_ATTEMPTS) await delay(250 * 2 ** attempt);
	}

	throw lastError;
};

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
	handler.onmessage(msg);
};
