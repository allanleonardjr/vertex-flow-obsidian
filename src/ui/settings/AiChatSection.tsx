/**
 * AI Chat (experimental) — two providers, one active at a time:
 *
 * - **Built-in:** a zero-install, in-browser model (WebLLM). No API keys, no
 *   external server: whichever model is selected downloads once into this
 *   browser's IndexedDB cache and stays there across Obsidian restarts.
 *   Several models may be cached at once — only one is ever the *active* one
 *   (see `AiEngineService`) — so each row below tracks its own cache state
 *   independently, while download progress and load failures come from the
 *   service (`useAiEngineStatus`) and survive this screen unmounting.
 * - **Local model server** (desktop only): an OpenAI-compatible server the
 *   user runs themselves — LM Studio / Bionic, Ollama, Jan, llama.cpp — which
 *   answers through the MCP tool set (see `LocalServerChatView`). Only the
 *   base URL and model id are synced settings; the optional API key is
 *   per-device (`local-server-key.ts`).
 */

import { Platform } from "obsidian";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
	AI_MODEL_OPTIONS,
	AiEngineService,
	AiInstallCancelledError,
	aiModelInfo,
	type AiEngineState,
} from "../../ai/AiEngineService";
import { listModels } from "../../ai/local-server-client";
import {
	describeLocalServerError,
	effectiveAiProvider,
	LOCAL_SERVER_PRESETS,
	normalizeBaseUrl,
	presetForUrl,
	toLocalServerErrorLike,
	type AiProvider,
	type LocalServerPresetId,
} from "../../core/ai/local-server";
import { getLocalServerKey, setLocalServerKey } from "../../obsidian/local-server-key";
import { useAiChatSession } from "../ai-chat/ai-chat-session";
import { useAiEngineStatus } from "../ai-chat/useAiEngineStatus";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { usePlugin, useSettingsWriter } from "../context";
import { Select } from "../components/Select";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function AiModelRow({
	id,
	label,
	selected,
	supported,
	onSelect,
}: {
	id: string;
	label: string;
	selected: boolean;
	supported: boolean;
	onSelect: () => void;
}) {
	const plugin = usePlugin();
	const { inFlight, getLoadError } = useAiEngineStatus();
	const [state, setState] = useState<AiEngineState | "checking">("checking");
	const [confirmingClear, setConfirmingClear] = useState(false);
	const info = aiModelInfo(id);

	// Progress is the service's, not this row's — so leaving Settings
	// mid-download and coming back still shows it live.
	const progress = inFlight?.modelId === id ? inFlight : null;
	const otherInFlight = inFlight != null && progress == null;
	const loadError = progress == null ? getLoadError(id) : null;

	const refresh = () => void plugin.aiEngine.getState(id).then(setState);
	// Also re-checks whenever this row's download starts or settles —
	// whichever screen started it, and including a cancel, which leaves a
	// partial (resumable) cache that still reads as not installed.
	useEffect(refresh, [plugin, id, progress != null]);

	/** Resolves `true` once the model is actually loaded; a failure (shown under the row) or a cancel (quiet) resolves `false`. */
	const install = (): Promise<boolean> =>
		plugin.aiEngine
			.install(id)
			.then((next) => {
				setState(next);
				return next === "installed";
			})
			.catch((error: unknown) => {
				if (!(error instanceof AiInstallCancelledError)) {
					console.error("Vertex Flow: AI model install failed", error);
				}
				refresh();
				return false;
			});

	// A click both activates this model AND selects it — fast (a worker
	// `reload()` from cache, no network) if already installed, otherwise this
	// starts its own download with the progress row below. The setting is
	// written only once the install succeeds (same order as the chat view's
	// `switchModel`), so a failed or cancelled install leaves the previous
	// selection untouched. Deliberately not an effect reacting to `selected`:
	// that would fire on every mount of the already-selected row too,
	// silently starting a multi-gigabyte download just from opening this
	// settings screen.
	const handleSelect = () => {
		void install().then((ok) => {
			if (ok) onSelect();
		});
	};

	const clearCache = () => {
		setConfirmingClear(false);
		void plugin.aiEngine.clearCache(id).then(refresh);
	};

	// Downloaded but failed to load (`getState` only checks the cache) — keep
	// the "Installed" status visible and turn the button into a retry.
	const installedButFailed = state === "installed" && loadError != null;

	const installLabel =
		progress != null
			? `Downloading… ${progress.pct}%`
			: installedButFailed
				? "Retry load"
				: state === "installed"
					? "Installed"
					: state === "unsupported"
						? "Unsupported"
						: "Install";

	return (
		<div className="vf-ai-model-row">
			<label className="vf-toggle">
				<input
					type="radio"
					name="vf-ai-model"
					checked={selected}
					disabled={!supported || otherInFlight}
					onChange={handleSelect}
				/>
				<span>
					{label}
					{info.vramMB != null && info.contextWindow != null && (
						<span className="vf-ai-model-meta">
							{" "}
							— {formatBytes(info.vramMB * 1024 * 1024)} VRAM, {info.contextWindow}-token context
						</span>
					)}
				</span>
			</label>

			<div className="vf-ai-model-row-actions">
				{installedButFailed && <span className="vf-ai-model-status">Installed</span>}
				<button
					type="button"
					className="mod-cta"
					disabled={
						!supported ||
						progress != null ||
						otherInFlight ||
						(state === "installed" && !installedButFailed)
					}
					onClick={() => void install()}
				>
					{installLabel}
				</button>
				{state === "installed" && progress == null && (
					<button type="button" onClick={() => setConfirmingClear(true)}>
						Clear cache
					</button>
				)}
			</div>

			{progress != null && (
				<div className="vf-ai-progress-wrap">
					<div className="vf-ai-progress">
						<div className="vf-ai-progress-fill" style={{ width: `${progress.pct}%` }} />
					</div>
					<span className="vf-ai-progress-label">{progress.text}</span>
					<button
						type="button"
						className="vf-ai-progress-cancel"
						onClick={() => plugin.aiEngine.cancelInstall()}
					>
						Cancel
					</button>
				</div>
			)}

			{loadError != null && <p className="vf-ai-model-error">{loadError}</p>}

			{confirmingClear && (
				<ConfirmDeleteDialog
					title={`Clear the "${label}" model cache?`}
					body="Removes the downloaded model from this browser. Reinstalling just downloads it again."
					confirmLabel="Clear cache"
					destructive={false}
					onConfirm={clearCache}
					onCancel={() => setConfirmingClear(false)}
				/>
			)}
		</div>
	);
}

/** How many model ids "Test connection" names before summarizing the rest. */
const TEST_MODELS_SHOWN = 3;

type ConnectionTest =
	| { kind: "idle" }
	| { kind: "testing" }
	| { kind: "ok" | "error"; text: string };

/**
 * The local model server's connection settings. The base URL commits on blur
 * or Enter (never per keystroke — every settings write re-renders the whole
 * plugin via `plugin.index.touch()`); the preset select only ever fills in the
 * URL, and shows whichever preset the stored URL matches.
 */
function LocalServerSettings({ enabled }: { enabled: boolean }) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const storedUrl = plugin.settings.localServerBaseUrl;

	const [draftUrl, setDraftUrl] = useState(storedUrl);
	const [urlError, setUrlError] = useState<string | null>(null);
	// Picking "Custom" while the stored URL still matches a preset: keep the
	// select on Custom until the user commits a URL of their own.
	const [customPicked, setCustomPicked] = useState(false);
	const [apiKey, setApiKey] = useState(getLocalServerKey);
	const [test, setTest] = useState<ConnectionTest>({ kind: "idle" });

	useEffect(() => {
		setDraftUrl(storedUrl);
		setUrlError(null);
	}, [storedUrl]);

	const presetValue: LocalServerPresetId = customPicked ? "custom" : presetForUrl(storedUrl);

	/** Validates and saves the typed URL; returns the URL now in effect, or `null` if it's invalid. */
	const commitUrl = (): string | null => {
		const result = normalizeBaseUrl(draftUrl);
		if ("error" in result) {
			setUrlError(result.error);
			return null;
		}
		setUrlError(null);
		setDraftUrl(result.url);
		setCustomPicked(false);
		if (result.url !== storedUrl) writeSettings({ localServerBaseUrl: result.url });
		return result.url;
	};

	const pickPreset = (id: LocalServerPresetId) => {
		const preset = LOCAL_SERVER_PRESETS.find((candidate) => candidate.id === id);
		setTest({ kind: "idle" });
		if (!preset?.baseUrl) {
			setCustomPicked(true);
			return;
		}
		setCustomPicked(false);
		setUrlError(null);
		setDraftUrl(preset.baseUrl);
		if (preset.baseUrl !== storedUrl) writeSettings({ localServerBaseUrl: preset.baseUrl });
	};

	const testConnection = () => {
		const url = commitUrl();
		if (!url) return;
		setTest({ kind: "testing" });
		listModels(url, apiKey).then(
			(ids) => {
				const named = ids.slice(0, TEST_MODELS_SHOWN).join(", ");
				const more = ids.length > TEST_MODELS_SHOWN ? ", …" : "";
				setTest({
					kind: "ok",
					text:
						ids.length === 0
							? "Connected, but the server lists no models. Download or load one in your server app."
							: `Connected, ${ids.length} model${ids.length === 1 ? "" : "s"}: ${named}${more}`,
				});
			},
			(error: unknown) =>
				setTest({
					kind: "error",
					text: describeLocalServerError(toLocalServerErrorLike(error), url),
				}),
		);
	};

	const onUrlKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			commitUrl();
		}
	};

	return (
		<div className={`vf-local-server-settings${enabled ? "" : " is-disabled"}`}>
			<label className="vf-field">
				<span>Server</span>
				<Select
					className="vf-select"
					wrapClassName="vf-select-wrap-block"
					value={presetValue}
					onChange={(event) => pickPreset(event.target.value as LocalServerPresetId)}
				>
					{LOCAL_SERVER_PRESETS.map((preset) => (
						<option key={preset.id} value={preset.id}>
							{preset.label}
						</option>
					))}
				</Select>
			</label>

			<label className="vf-field">
				<span>Base URL</span>
				<input
					type="text"
					className="vf-input"
					value={draftUrl}
					spellCheck={false}
					placeholder="http://localhost:1234/v1"
					onChange={(event) => setDraftUrl(event.target.value)}
					onBlur={() => void commitUrl()}
					onKeyDown={onUrlKeyDown}
				/>
				{urlError && <small className="vf-local-server-error">{urlError}</small>}
			</label>

			<label className="vf-field">
				<span>API key (optional)</span>
				<input
					type="password"
					className="vf-input"
					value={apiKey}
					autoComplete="off"
					placeholder="Only if your server requires one"
					onChange={(event) => {
						setApiKey(event.target.value);
						setLocalServerKey(event.target.value);
					}}
				/>
				<small>Stored on this device only, never in synced settings.</small>
			</label>

			<div className="vf-local-server-test">
				<button type="button" disabled={test.kind === "testing"} onClick={testConnection}>
					{test.kind === "testing" ? "Testing…" : "Test connection"}
				</button>
				{(test.kind === "ok" || test.kind === "error") && (
					<span
						className={`vf-local-server-test-result${test.kind === "error" ? " is-error" : ""}`}
					>
						{test.text}
					</span>
				)}
			</div>

			<p className="vf-settings-description">
				Using LM Studio or Bionic? Turn on Local Model API → Local API server. The
				CORS setting doesn't matter for Vertex Flow.
			</p>
		</div>
	);
}

export function AiChatSection() {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const supported = AiEngineService.supportsWebGPU();
	const selectedModelId = plugin.settings.selectedAiModelId;
	const enabled = plugin.settings.aiChatEnabled;
	const { messages, resetConversation } = useAiChatSession();
	const provider = effectiveAiProvider(plugin.settings.aiProvider, Platform.isDesktop);
	// A provider switch waiting on "Start a new conversation?" confirmation.
	const [pendingProvider, setPendingProvider] = useState<AiProvider | null>(null);

	const applyProvider = (next: AiProvider) => {
		setPendingProvider(null);
		// The two providers keep different history shapes, so a switch
		// always starts a fresh conversation (and closes the MCP bridge).
		resetConversation();
		writeSettings({ aiProvider: next });
		// Free the in-browser model's VRAM for the local server's own model.
		if (next === "local-server") void plugin.aiEngine.unloadFromMemory();
	};

	const chooseProvider = (next: AiProvider) => {
		if (next === provider) return;
		if (messages.length > 0) setPendingProvider(next);
		else applyProvider(next);
	};

	const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
	useEffect(() => {
		void AiEngineService.storageEstimate().then(setStorage);
	}, []);

	return (
		<section className="vf-settings-section" id="vf-settings-ai-chat">
			<h3>AI Chat (experimental)</h3>
			<p className="vf-settings-description">
				Chat with an AI about your workspaces. The built-in models run right
				in this browser: no API keys and nothing sent over the network, just a
				one-time download per model that stays cached here. On desktop you can
				instead use a model server running on your own machine, like LM Studio
				or Ollama.
			</p>

			{provider === "builtin" && !supported && (
				<div className="vf-settings-callout">
					This device/browser doesn't support WebGPU, so AI Chat isn't
					available here.
				</div>
			)}

			<label className="vf-toggle">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(event) => {
						const next = event.target.checked;
						writeSettings({ aiChatEnabled: next });
						// Free the loaded model's memory the instant it's turned off,
						// rather than waiting for the next place that would have
						// loaded/used it — the cached download is untouched, so
						// turning it back on and selecting the same model reloads
						// from cache with no re-download.
						if (!next) void plugin.aiEngine.unloadFromMemory();
					}}
				/>
				<span>Enable AI Chat</span>
			</label>

			{Platform.isDesktop && (
				<div
					className={`vf-ai-provider-group${enabled ? "" : " is-disabled"}`}
					role="radiogroup"
					aria-label="AI Chat provider"
				>
					<label className="vf-toggle">
						<input
							type="radio"
							name="vf-ai-provider"
							checked={provider === "builtin"}
							onChange={() => chooseProvider("builtin")}
						/>
						<span>Built-in (in-browser)</span>
					</label>
					<label className="vf-toggle">
						<input
							type="radio"
							name="vf-ai-provider"
							checked={provider === "local-server"}
							onChange={() => chooseProvider("local-server")}
						/>
						<span>Local model server</span>
					</label>
				</div>
			)}

			{provider === "local-server" ? (
				<LocalServerSettings enabled={enabled} />
			) : (
				<>
					<div className={`vf-ai-model-list${enabled ? "" : " is-disabled"}`}>
						{AI_MODEL_OPTIONS.map((option) => (
							<AiModelRow
								key={option.id}
								id={option.id}
								label={option.label}
								selected={selectedModelId === option.id}
								supported={supported && enabled}
								onSelect={() => writeSettings({ selectedAiModelId: option.id })}
							/>
						))}
					</div>

					{storage && (
						<p className="vf-settings-description">
							Browser storage in use: {formatBytes(storage.usage)} of{" "}
							{formatBytes(storage.quota)}
						</p>
					)}
				</>
			)}

			{pendingProvider && (
				<ConfirmDeleteDialog
					title="Start a new conversation?"
					body="Switching AI providers clears the current AI Chat conversation."
					confirmLabel="Switch and start over"
					destructive={false}
					onConfirm={() => applyProvider(pendingProvider)}
					onCancel={() => setPendingProvider(null)}
				/>
			)}
		</section>
	);
}
