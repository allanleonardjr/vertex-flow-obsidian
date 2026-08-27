/**
 * Cycles (§7.5) and Archiving (§7.7) — both opt-in, off by default, and both
 * live on the workspace config rather than anywhere per-task.
 */

import type { RolloverPolicy, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

const ROLLOVER_LABEL: Record<RolloverPolicy, string> = {
	"auto-rollover": "Auto-rollover (recommended)",
	"return-to-backlog": "Return to backlog",
	manual: "Manual",
};

export function CyclesSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const cycles = snapshot.workspace.cycles;

	const commit = (patch: Partial<typeof cycles>) => {
		void plugin.mutations.saveWorkspaceConfig({
			...snapshot.workspace,
			cycles: { ...cycles, ...patch },
		});
	};

	return (
		<section className="vf-settings-section">
			<h3>{cycles.termLabel}s</h3>
			<p className="vf-settings-description">
				Off by default — never required to use this workspace (§7.5).
			</p>

			<label className="vf-toggle">
				<input
					type="checkbox"
					checked={cycles.enabled}
					onChange={(event) => commit({ enabled: event.target.checked })}
				/>
				<span>Enable {cycles.termLabel.toLowerCase()}s</span>
			</label>

			{cycles.enabled && (
				<>
					<label className="vf-field">
						<span>Name</span>
						<input
							type="text"
							value={cycles.termLabel}
							onChange={(event) => commit({ termLabel: event.target.value || "Cycle" })}
						/>
						<small>Renameable — e.g. to "Sprint".</small>
					</label>

					<label className="vf-field">
						<span>When a {cycles.termLabel.toLowerCase()} ends</span>
						<select
							className="vf-select"
							value={cycles.rolloverPolicy}
							onChange={(event) =>
								commit({ rolloverPolicy: event.target.value as RolloverPolicy })
							}
						>
							{(Object.keys(ROLLOVER_LABEL) as RolloverPolicy[]).map((policy) => (
								<option key={policy} value={policy}>
									{ROLLOVER_LABEL[policy]}
								</option>
							))}
						</select>
					</label>
				</>
			)}
		</section>
	);
}

export function ArchivingSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const archiving = snapshot.workspace.archiving;

	const commit = (patch: Partial<typeof archiving>) => {
		void plugin.mutations.saveWorkspaceConfig({
			...snapshot.workspace,
			archiving: { ...archiving, ...patch },
		});
	};

	return (
		<section className="vf-settings-section">
			<h3>Archiving</h3>
			<p className="vf-settings-description">
				Archiving is manual by default (§7.7). Auto-archive is optional and
				off unless turned on here.
			</p>

			<label className="vf-toggle">
				<input
					type="checkbox"
					checked={archiving.autoArchiveEnabled}
					onChange={(event) => commit({ autoArchiveEnabled: event.target.checked })}
				/>
				<span>Auto-archive inactive tasks</span>
			</label>

			{archiving.autoArchiveEnabled && (
				<label className="vf-field">
					<span>After days of inactivity</span>
					<input
						type="number"
						className="vf-input"
						min={1}
						value={archiving.autoArchiveDays}
						onChange={(event) => {
							const days = Number.parseInt(event.target.value, 10);
							if (Number.isFinite(days) && days > 0) commit({ autoArchiveDays: days });
						}}
					/>
				</label>
			)}
		</section>
	);
}
