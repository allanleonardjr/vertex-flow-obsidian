/**
 * AI Chat (experimental) — a zero-install, in-browser model (WebLLM). No API
 * keys, no external server: the model downloads once into this browser's
 * IndexedDB cache and stays there across Obsidian restarts.
 */

import { useEffect, useState } from "react";
import { AiEngineService, type AiEngineState } from "../../ai/AiEngineService";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { usePlugin } from "../context";

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

export function AiChatSection() {
	const plugin = usePlugin();
	const supported = AiEngineService.supportsWebGPU();

	const [state, setState] = useState<AiEngineState | "checking">("checking");
	const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
	const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
	const [confirmingClear, setConfirmingClear] = useState(false);

	const refresh = () => {
		void plugin.aiEngine.getState().then(setState);
		void AiEngineService.storageEstimate().then(setStorage);
	};

	useEffect(refresh, [plugin]);

	const install = () => {
		setProgress({ pct: 0, text: "Starting…" });
		void plugin.aiEngine
			.install((report) =>
				setProgress({ pct: Math.round(report.progress * 100), text: report.text }),
			)
			.then((next) => {
				setProgress(null);
				setState(next);
				void AiEngineService.storageEstimate().then(setStorage);
			})
			.catch((error: unknown) => {
				setProgress(null);
				setState("not-installed");
				console.error("Vertex Flow: AI model install failed", error);
			});
	};

	const clearCache = () => {
		setConfirmingClear(false);
		void plugin.aiEngine.clearCache().then(refresh);
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
		<section className="vf-settings-section" id="vf-settings-ai-chat">
			<h3>AI Chat (experimental)</h3>
			<p className="vf-settings-description">
				A local, in-browser AI model — no API keys and nothing sent over the
				network. It's a multi-gigabyte one-time download that stays cached in
				this browser.
			</p>

			{!supported && (
				<div className="vf-settings-callout">
					This device/browser doesn't support WebGPU, so AI Chat isn't
					available here.
				</div>
			)}

			<label className="vf-field">
				<span>Model</span>
				<button
					type="button"
					className="mod-cta"
					disabled={!supported || state === "installed" || progress != null}
					onClick={install}
				>
					{installLabel}
				</button>
			</label>

			{progress != null && (
				<div className="vf-ai-progress-wrap">
					<div className="vf-ai-progress">
						<div className="vf-ai-progress-fill" style={{ width: `${progress.pct}%` }} />
					</div>
					<span className="vf-ai-progress-label">{progress.text}</span>
				</div>
			)}

			<label className="vf-field">
				<span>Cache</span>
				<button
					type="button"
					disabled={!supported || state !== "installed"}
					onClick={() => setConfirmingClear(true)}
				>
					Clear cache
				</button>
			</label>

			{storage && (
				<p className="vf-settings-description">
					Browser storage in use: {formatBytes(storage.usage)} of{" "}
					{formatBytes(storage.quota)}
				</p>
			)}

			{confirmingClear && (
				<ConfirmDeleteDialog
					title="Clear the AI model cache?"
					body="Removes the downloaded model from this browser. Reinstalling just downloads it again."
					confirmLabel="Clear cache"
					destructive={false}
					onConfirm={clearCache}
					onCancel={() => setConfirmingClear(false)}
				/>
			)}
		</section>
	);
}
