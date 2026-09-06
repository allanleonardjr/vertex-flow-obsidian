/**
 * Activity history — opt-in, off by default, and flipped per workspace rather
 * than per entity. Phrasing everywhere is "activity history", not "audit log":
 * the log is a hand-editable local file, so it can't borrow compliance
 * authority.
 */

import type { WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

export function HistorySection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const history = snapshot.workspace.history;

	const commit = (patch: Partial<typeof history>) => {
		void plugin.mutations.saveWorkspaceConfig({
			...snapshot.workspace,
			history: { ...history, ...patch },
		});
	};

	return (
		<section className="vf-settings-section">
			<h3>Activity history</h3>
			<p className="vf-settings-description">
				Record every change in this workspace to an append-only log under
				its own <code>History/</code> folder — one Markdown file per month.
				It's activity history, not a formal audit log: the files are
				plain text you can read and edit, so it carries no compliance
				weight.
			</p>

			<label className="vf-toggle">
				<input
					type="checkbox"
					checked={history.enabled}
					onChange={(event) => commit({ enabled: event.target.checked })}
				/>
				<span>Record changes to this workspace</span>
			</label>
		</section>
	);
}