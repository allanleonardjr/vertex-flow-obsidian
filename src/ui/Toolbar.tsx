/**
 * View header: counts, the archived toggle, bulk actions, and quick capture.
 */

import type { EvaluatedView } from "../core/views";
import type { SavedView, WorkspaceSnapshot } from "../core/types";
import { usePlugin, useSettingsWriter } from "./context";
import { QuickCaptureModal } from "./modals/QuickCaptureModal";
import { useSelection } from "./selection";

export function Toolbar({
	snapshot,
	view,
	evaluated,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	evaluated: EvaluatedView;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const selection = useSelection();
	const selectedCount = selection.selectedPaths.length;

	return (
		<header className="vf-toolbar">
			<div className="vf-toolbar-title">
				<h2>{view.name}</h2>
				<span className="vf-count">
					{evaluated.total} {evaluated.total === 1 ? "task" : "tasks"}
				</span>
			</div>

			<div className="vf-toolbar-actions">
				{selectedCount > 0 && (
					<>
						<span className="vf-count">{selectedCount} selected</span>
						<BulkStatus snapshot={snapshot} evaluated={evaluated} />
						<button onClick={() => selection.clearSelection()}>Clear</button>
					</>
				)}

				<label className="vf-toggle">
					<input
						type="checkbox"
						checked={plugin.settings.showArchived}
						onChange={(event) =>
							writeSettings({ showArchived: event.target.checked })
						}
					/>
					<span>Show archived</span>
				</label>

				<button
					className="mod-cta"
					onClick={() => new QuickCaptureModal(plugin.app, plugin, snapshot).open()}
				>
					New task
				</button>
			</div>
		</header>
	);
}

/** Bulk status edit across the multi-selection (§9.3). */
function BulkStatus({
	snapshot,
	evaluated,
}: {
	snapshot: WorkspaceSnapshot;
	evaluated: EvaluatedView;
}) {
	const plugin = usePlugin();
	const selection = useSelection();

	return (
		<select
			className="vf-bulk-select"
			value=""
			onChange={(event) => {
				const status = event.target.value;
				if (!status) return;
				void plugin.mutations.bulkUpdate(selection.targets(evaluated.tasks), {
					status,
				});
			}}
		>
			<option value="">Set status…</option>
			{snapshot.workspace.statuses.map((status) => (
				<option key={status.id} value={status.id}>
					{status.name}
				</option>
			))}
		</select>
	);
}
