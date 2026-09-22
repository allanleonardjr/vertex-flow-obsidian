/**
 * AI Chat (experimental) — a zero-install, in-browser model (WebLLM). No API
 * keys, no external server: whichever model is selected downloads once into
 * this browser's IndexedDB cache and stays there across Obsidian restarts.
 * Several models may be cached at once — only one is ever the *active* one
 * (see `AiEngineService`) — so each row below tracks its own cache state
 * independently, while download progress and load failures come from the
 * service (`useAiEngineStatus`) and survive this screen unmounting.
 */

import { useEffect, useState } from "react";
import {
	AI_MODEL_OPTIONS,
	AiEngineService,
	AiInstallCancelledError,
	aiModelInfo,
	type AiEngineState,
} from "../../ai/AiEngineService";
import { useAiEngineStatus } from "../ai-chat/useAiEngineStatus";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { usePlugin, useSettingsWriter } from "../context";

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

export function AiChatSection() {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const supported = AiEngineService.supportsWebGPU();
	const selectedModelId = plugin.settings.selectedAiModelId;
	const enabled = plugin.settings.aiChatEnabled;

	const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
	useEffect(() => {
		void AiEngineService.storageEstimate().then(setStorage);
	}, []);

	return (
		<section className="vf-settings-section" id="vf-settings-ai-chat">
			<h3>AI Chat (experimental)</h3>
			<p className="vf-settings-description">
				A local, in-browser AI model — no API keys and nothing sent over the
				network. Pick a model below; it's a one-time download per model that
				stays cached in this browser.
			</p>

			{!supported && (
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
		</section>
	);
}
