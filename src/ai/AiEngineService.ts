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
	type InitProgressCallback,
	type ModelRecord,
	type WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import { estimateTokens } from "../core/ai/snapshot";

export interface AiModelOption {
	id: string;
	label: string;
}

/**
 * Plugin-owned augmentations applied on top of the installed
 * `@mlc-ai/web-llm` package's own `prebuiltAppConfig.model_list`. The MLC
 * builders ship every chat model with a conservative 4096-token KV cache;
 * the models themselves are natively far longer-context (Qwen2.5 → 128K,
 * Llama 3.1 → 128K), so we raise the runtime window here. That costs VRAM
 * linearly — `2 · layers · kv_heads · head_dim · 2 bytes` per token — which
 * is why `kvBytesPerToken` per model also feeds the `vram_required_MB`
 * recompute below instead of letting the settings row under-report the
 * bigger window's real need.
 *
 * Targets are chosen to stay within ≈8 GB total: 16K on the Qwen2.5 options,
 * and 8K on Llama-3.1-8B (128 KB/token kv — the priciest of the three).
 */
const MODEL_AUGMENTATIONS: Record<string, { contextWindow: number; kvBytesPerToken: number }> = {
	"Qwen2.5-3B-Instruct-q4f16_1-MLC": { contextWindow: 16384, kvBytesPerToken: 73_728 },
	"Qwen2.5-7B-Instruct-q4f16_1-MLC": { contextWindow: 16384, kvBytesPerToken: 57_344 },
	"Llama-3.1-8B-Instruct-q4f32_1-MLC": { contextWindow: 8192, kvBytesPerToken: 131_072 },
};

/**
 * The plugin's effective model list: the package's prebuilt records with the
 * augmentations above applied. Single source of truth for both the engine's `appConfig` and `aiModelInfo()` so
 * the settings row, the chat context meter, and `chat()`'s `max_tokens`
 * budget all agree on the window actually running in the worker.
 */
export const AI_MODEL_LIST: ModelRecord[] = [
	...prebuiltAppConfig.model_list.map((record) => {
		const augmentation = MODEL_AUGMENTATIONS[record.model_id];
		if (!augmentation) return record;
		const baseContext = record.overrides?.context_window_size ?? 4096;
		const addedKvPerMb = augmentation.kvBytesPerToken / (1024 * 1024);
		return {
			...record,
			vram_required_MB:
				(record.vram_required_MB ?? 0) +
				Math.max(0, augmentation.contextWindow - baseContext) * addedKvPerMb,
			overrides: {
				...record.overrides,
				context_window_size: augmentation.contextWindow,
			},
		};
	}),
];

/**
 * The three selectable options, all package prebuilts (Qwen2.5-3B,
 * Qwen2.5-7B, Llama-3.1-8B) carrying the raised context windows above. The
 * query-on-demand architecture in `AiChatView` (facts layer + on-demand
 * `searchTasks`/`countTasks`, never a full snapshot injection) is what keeps
 * even the smallest option usable at any workspace size.
 */
export const AI_MODEL_OPTIONS: AiModelOption[] = [
	{ id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Fast (small)" },
	{ id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Balanced" },
	{ id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", label: "Most capable (needs more VRAM)" },
];

export const DEFAULT_AI_MODEL_ID = AI_MODEL_OPTIONS[0].id;

/** A persisted model id that's no longer offered (e.g. a retired option) falls back to the default instead of being loaded blind. */
export function resolveAiModelId(modelId: string): string {
	return AI_MODEL_OPTIONS.some((option) => option.id === modelId) ? modelId : DEFAULT_AI_MODEL_ID;
}

/**
 * `chat()`'s `max_tokens` sizing — an explicit cap on the *completion*,
 * separate from (and never a substitute for) the adaptive truncation on the
 * *prompt* side (`query-action.ts`'s `executeQueryAction`). `estimateTokens`
 * is a heuristic (chars/4), not an exact tokenizer, so these are deliberately
 * round, conservative numbers rather than a computed exact boundary.
 */
const COMPLETION_TOKEN_SAFETY_MARGIN = 64;
/** Always leave room for at least a short reply — e.g. a "this conversation is too long" style answer — even against a prompt that's nearly filled the window. */
const MIN_COMPLETION_TOKENS = 64;
/** No ordinary chat reply needs more than this; caps `max_tokens` even when the raw remaining budget would technically allow more. */
const MAX_COMPLETION_TOKENS = 1024;

/** VRAM/context for a model id, read from `AI_MODEL_LIST` — the same list the engine runs — never a hard-coded copy that could drift from it. */
export function aiModelInfo(modelId: string): { vramMB: number | null; contextWindow: number | null } {
	const entry = AI_MODEL_LIST.find((candidate) => candidate.model_id === modelId);
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
		// The plugin's effective list: prebuilt records plus the raised
		// context windows — the same list `aiModelInfo` reads.
		model_list: AI_MODEL_LIST,
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
	 * Unloads the active model from the worker (frees its RAM/VRAM) without
	 * touching its cached weights on disk — unlike `clearCache`, this is
	 * meant to be cheap and reversible: the next `install()` for the same
	 * model reloads instantly from cache, no network involved.
	 */
	async unloadFromMemory(): Promise<void> {
		if (this.engine) {
			await this.engine.unload();
			this.engine = null;
			this.loadedModelId = null;
			this.loading = null;
		}
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

	/**
	 * Streams the assistant's reply token-by-token, returning the full text
	 * once done. Uses whichever model `install()` most recently activated.
	 *
	 * Always passes an explicit `max_tokens`: left unset, WebLLM defaults it
	 * to `Infinity` internally, an unbounded completion-length reservation
	 * that can combine with an otherwise well-under-budget prompt to exceed
	 * the model's real context window. Sized from `estimateTokens()` over the
	 * prompt against `aiModelInfo`'s `contextWindow` for whichever model is
	 * currently loaded, clamped to a sane min (room for at least a short
	 * reply) and max (no normal reply needs more, however large the raw
	 * remaining budget is) — see the constants above `chat()`'s definition.
	 */
	async chat(
		messages: AiChatMessage[],
		onToken: (token: string) => void,
	): Promise<string> {
		if (!this.engine) {
			throw new Error("AI model is not loaded — call install() first.");
		}

		const contextWindow = this.loadedModelId
			? aiModelInfo(this.loadedModelId).contextWindow
			: null;
		const promptTokens = messages.reduce(
			(sum, message) => sum + estimateTokens(message.content),
			0,
		);
		const maxTokens = contextWindow
			? Math.min(
					MAX_COMPLETION_TOKENS,
					Math.max(
						MIN_COMPLETION_TOKENS,
						contextWindow - promptTokens - COMPLETION_TOKEN_SAFETY_MARGIN,
					),
				)
			: MAX_COMPLETION_TOKENS;

		const stream = await this.engine.chat.completions.create({
			messages,
			stream: true,
			max_tokens: maxTokens,
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
