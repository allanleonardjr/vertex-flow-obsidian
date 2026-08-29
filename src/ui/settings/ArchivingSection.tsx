/**
 * Archiving (§7.7) — opt-in, off by default, and configured on the workspace
 * rather than anywhere per-task.
 */

import type { WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

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
				Archiving is manual by default. Auto-archive is optional and
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
