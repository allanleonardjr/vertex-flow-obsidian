/**
 * AI Chat (experimental) — a zero-install, in-browser model (WebLLM). No API
 * keys, no external server: whichever model is selected downloads once into
 * this browser's IndexedDB cache and stays there across Obsidian restarts.
 * Several models may be cached at once — only one is ever the *active* one
 * (see `AiEngineService`) — so each row below tracks its own install state
 * independently.
 */

import { useEffect, useState } from "react";
import {
	AI_MODEL_OPTIONS,
	AiEngineService,
	aiModelInfo,
	type AiEngineState,
} from "../../ai/AiEngineService";
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
	const [state, setState] = useState<AiEngineState | "checking">("checking");
	const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
	const [confirmingClear, setConfirmingClear] = useState(false);
	const info = aiModelInfo(id);

	const refresh = () => void plugin.aiEngine.getState(id).then(setState);
	useEffect(refresh, [plugin, id]);

	const install = () => {
		setProgress({ pct: 0, text: "Starting…" });
		void plugin.aiEngine
			.install(id, (report) =>
				setProgress({ pct: Math.round(report.progress * 100), text: report.text }),
			)
			.then((next) => {
				setProgress(null);
				setState(next);
			})
			.catch((error: unknown) => {
				setProgress(null);
				setState("not-installed");
				console.error("Vertex Flow: AI model install failed", error);
			});
	};

	// A click always both selects this model AND activates it — fast (a
	// worker `reload()` from cache, no network) if already installed,
	// otherwise this starts its own download with the progress row below.
	// Deliberately not an effect reacting to `selected`: that would fire on
	// every mount of the already-selected row too, silently starting a
	// multi-gigabyte download just from opening this settings screen.
	const handleSelect = () => {
		onSelect();
		install();
	};

	const clearCache = () => {
		setConfirmingClear(false);
		void plugin.aiEngine.clearCache(id).then(refresh);
	};

	const installLabel =
		progress != null
			? `Downloading… ${progress.pct}%`
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
					disabled={!supported}
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
				<button
					type="button"
					className="mod-cta"
					disabled={!supported || state === "installed" || progress != null}
					onClick={install}
				>
					{installLabel}
				</button>
				{state === "installed" && (
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
				</div>
			)}

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

			<div className="vf-ai-model-list">
				{AI_MODEL_OPTIONS.map((option) => (
					<AiModelRow
						key={option.id}
						id={option.id}
						label={option.label}
						selected={selectedModelId === option.id}
						supported={supported}
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
