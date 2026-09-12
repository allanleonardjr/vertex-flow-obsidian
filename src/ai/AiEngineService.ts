/**
 * Thin wrapper around WebLLM's worker engine: zero-install, in-browser
 * inference with no API keys and no user-managed local model. Model download
 * and lifecycle (cache check, install, clear, switch) are fully automated
 * here — exactly one model is ever active in the worker at a time, though
 * several may sit cached in IndexedDB simultaneously.
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

export interface AiModelOption {
	id: string;
	label: string;
}

/**
 * Three real candidates pulled from the installed `@mlc-ai/web-llm` package's
 * own `prebuiltAppConfig.model_list` (verified against v0.2.85, the latest
 * published version — see `aiModelInfo` below, which reads vram/context from
 * that same list rather than duplicating numbers here). They differ in size
 * and quality, not context window: no chat model in that list, of any family,
 * ships past a 4096-token context — the query-on-demand architecture in
 * `AiChatView` (facts layer + on-demand `searchTasks`/`countTasks`, never a
 * full snapshot injection) is what actually keeps this working at any
 * workspace size, regardless of which of these is active.
 */
export const AI_MODEL_OPTIONS: AiModelOption[] = [
	{ id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Fast (small)" },
	{ id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Balanced" },
	{ id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", label: "Most capable (needs more VRAM)" },
];

export const DEFAULT_AI_MODEL_ID = AI_MODEL_OPTIONS[0].id;

/** VRAM/context for a model id, read live from the package's own config — never hand-copied, so it can't drift from what's actually installed. */
export function aiModelInfo(modelId: string): { vramMB: number | null; contextWindow: number | null } {
	const entry = prebuiltAppConfig.model_list.find((candidate) => candidate.model_id === modelId);
	return {
		vramMB: entry?.vram_required_MB ?? null,
		contextWindow: entry?.overrides?.context_window_size ?? null,
	};
}

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
	private loadedModelId: string | null = null;
	private loading: Promise<void> | null = null;

	constructor(private readonly workerUrl: string) {}

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

	/** The model id currently loaded into the worker, or `null` if none is. Several other models may still be cached on disk without being this. */
	get activeModelId(): string | null {
		return this.loadedModelId;
	}

	/**
	 * Combines feature detection with a cache check for one specific model —
	 * the settings UI needs each model row's own state independently, since a
	 * user may have several cached at once even though only one is active.
	 * Cheap: it never touches the worker, it only asks IndexedDB.
	 */
	async getState(modelId: string): Promise<AiEngineState> {
		if (!AiEngineService.supportsWebGPU()) return "unsupported";
		const cached = await hasModelInCache(modelId, this.appConfig);
		return cached ? "installed" : "not-installed";
	}

	async isInstalled(modelId: string): Promise<boolean> {
		return (await this.getState(modelId)) === "installed";
	}

	/**
	 * Downloads (first run) or loads-from-cache (every run after) the given
	 * model into the worker engine, making it the active one. Idempotent and
	 * safe to call every time the chat screen mounts — a cached model loads in
	 * seconds with no network activity. Reports "unsupported" rather than
	 * throwing when WebGPU is absent, since that's an expected environment,
	 * not a failure.
	 */
	async install(modelId: string, onProgress?: InitProgressCallback): Promise<AiEngineState> {
		if (!AiEngineService.supportsWebGPU()) return "unsupported";
		if (this.loadedModelId !== modelId || !this.engine) {
			if (!this.loading) {
				this.loading = this.load(modelId, onProgress);
			}
			await this.loading;
		}
		return "installed";
	}

	private async load(modelId: string, onProgress?: InitProgressCallback): Promise<void> {
		try {
			if (this.engine) {
				// Same worker, swap the active model — `reload()` handles both
				// "already cached" (fast, no network) and "needs downloading"
				// (same progress callback as a first-ever install) itself.
				this.engine.setInitProgressCallback(onProgress ?? (() => {}));
				await this.engine.reload(modelId);
			} else {
				const worker = new Worker(this.workerUrl);
				this.engine = await CreateWebWorkerMLCEngine(worker, modelId, {
					appConfig: this.appConfig,
					initProgressCallback: onProgress,
				});
			}
			this.loadedModelId = modelId;
		} finally {
			this.loading = null;
		}
	}

	/**
	 * Removes one model's cached weights/config/wasm. Unloads the live engine
	 * only if that model was the active one — clearing a different, inactive
	 * model's cache never disturbs whatever is currently loaded.
	 */
	async clearCache(modelId: string): Promise<void> {
		if (this.loadedModelId === modelId && this.engine) {
			await this.engine.unload();
			this.engine = null;
			this.loadedModelId = null;
			this.loading = null;
		}
		await deleteModelAllInfoInCache(modelId, this.appConfig);
	}

	/**
	 * Interrupts whichever generation is currently in flight (worker-bridged —
	 * `WebWorkerMLCEngine.interruptGenerate()` posts the interrupt across to
	 * the actual engine). A no-op if nothing is generating. Only meaningful
	 * against a streaming `chat()` call — WebLLM's interrupt handling is only
	 * documented as reliable for streaming generation.
	 */
	interrupt(): void {
		this.engine?.interruptGenerate();
	}

	/** Streams the assistant's reply token-by-token, returning the full text once done. Uses whichever model `install()` most recently activated. */
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
