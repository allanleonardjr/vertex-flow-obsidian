/**
 * Thin wrapper around WebLLM's worker engine: zero-install, in-browser
 * inference with no API keys and no user-managed local model. Model download
 * and lifecycle (cache check, install, clear) are fully automated here.
 *
 * Not under `src/core/` — it takes a real runtime dependency
 * (`@mlc-ai/web-llm`), which the Golden Rule's core-purity allowlist doesn't
 * permit. It also touches no Obsidian API, so it stays independently
 * testable; the plugin resolves the worker script's URL (an Obsidian
 * resource path) and hands it in as a plain string.
 */

import {
	CreateWebWorkerMLCEngine,
	deleteModelAllInfoInCache,
	hasModelInCache,
	prebuiltAppConfig,
	type AppConfig,
	type ChatCompletionMessageParam,
	type InitProgressCallback,
	type WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";

export const DEFAULT_AI_MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

export type AiEngineState = "unsupported" | "not-installed" | "installed";

export interface AiChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export class AiEngineService {
	private readonly appConfig: AppConfig = {
		...prebuiltAppConfig,
		// More predictable quota behavior than the Cache API default for
		// multi-gigabyte model weights.
		cacheBackend: "indexeddb",
	};

	private engine: WebWorkerMLCEngine | null = null;
	private loading: Promise<void> | null = null;

	constructor(
		private readonly workerUrl: string,
		private readonly modelId: string = DEFAULT_AI_MODEL_ID,
	) {}

	/** WebGPU is unavailable on mobile and some desktop browsers — feature-detect rather than let a Worker crash surface as an unhandled error. */
	static supportsWebGPU(): boolean {
		return (
			typeof navigator !== "undefined" &&
			(navigator as Navigator & { gpu?: unknown }).gpu != null
		);
	}

	/** `null` where the Storage API isn't available. */
	static async storageEstimate(): Promise<{ usage: number; quota: number } | null> {
		if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
		const { usage, quota } = await navigator.storage.estimate();
		if (usage == null || quota == null) return null;
		return { usage, quota };
	}

	/**
	 * Combines feature detection with a cache check — the one call the
	 * settings UI needs to decide what its Install row should say. Cheap: it
	 * never spins up the worker, it only asks IndexedDB whether the weights
	 * are already there.
	 */
	async getState(): Promise<AiEngineState> {
		if (!AiEngineService.supportsWebGPU()) return "unsupported";
		if (this.engine) return "installed";
		const cached = await hasModelInCache(this.modelId, this.appConfig);
		return cached ? "installed" : "not-installed";
	}

	async isInstalled(): Promise<boolean> {
		return (await this.getState()) === "installed";
	}

	/**
	 * Downloads (first run) or loads-from-cache (every run after) the model
	 * into a worker engine. Idempotent and safe to call every time the chat
	 * screen mounts — a cached model loads in seconds with no network
	 * activity. Reports "unsupported" rather than throwing when WebGPU is
	 * absent, since that's an expected environment, not a failure.
	 */
	async install(onProgress?: InitProgressCallback): Promise<AiEngineState> {
		if (!AiEngineService.supportsWebGPU()) return "unsupported";
		if (!this.engine) {
			if (!this.loading) {
				this.loading = this.load(onProgress);
			}
			await this.loading;
		}
		return "installed";
	}

	private async load(onProgress?: InitProgressCallback): Promise<void> {
		try {
			const worker = new Worker(this.workerUrl);
			this.engine = await CreateWebWorkerMLCEngine(worker, this.modelId, {
				appConfig: this.appConfig,
				initProgressCallback: onProgress,
			});
		} finally {
			this.loading = null;
		}
	}

	/** Removes the model's cached weights/config/wasm and unloads the live engine, if any. */
	async clearCache(): Promise<void> {
		if (this.engine) {
			await this.engine.unload();
			this.engine = null;
		}
		this.loading = null;
		await deleteModelAllInfoInCache(this.modelId, this.appConfig);
	}

	/** Streams the assistant's reply token-by-token, returning the full text once done. */
	async chat(
		messages: AiChatMessage[],
		onToken: (token: string) => void,
	): Promise<string> {
		if (!this.engine) {
			throw new Error("AI model is not loaded — call install() first.");
		}

		const stream = await this.engine.chat.completions.create({
			messages: messages as ChatCompletionMessageParam[],
			stream: true,
		});

		let full = "";
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta?.content ?? "";
			if (delta) {
				full += delta;
				onToken(delta);
			}
		}
		return full;
	}
}
