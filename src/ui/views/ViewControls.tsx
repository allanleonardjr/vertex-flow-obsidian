/**
 * The viewport header: a title row (name, count, quick capture) and a
 * persistent control bar beneath it. Nothing on the bar is hidden behind a
 * button and nothing is styled as one — the layout, grouping, ordering,
 * visibility switches, and every active filter are always on screen as flat
 * text; only a control's value list opens on click.
 */

import type { EvaluatedView } from "../../core/views";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { SavedView, ViewFilters, WorkspaceSnapshot } from "../../core/types";
import { useCreateTask } from "../actions";
import { usePlugin, useSettingsWriter } from "../context";
import { useSelection } from "../selection";
import { GroupChip, LayoutToggle, SortChip } from "./DisplayControls";
import { FilterControls } from "./FilterControls";
import { useViewWriter } from "./useViewWriter";

export function ViewControls({
	snapshot,
	view,
	taxonomies,
	evaluated,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	taxonomies: WorkspaceTaxonomies;
	evaluated: EvaluatedView;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const writeView = useViewWriter(snapshot, view);
	const selection = useSelection();
	const createTask = useCreateTask();

	const selectedCount = selection.selectedPaths.length;
	const showSubtasks = !view.filters.topLevelOnly;

	const setShowSubtasks = (next: boolean) => {
		const filters: ViewFilters = { ...view.filters };
		if (next) delete filters.topLevelOnly;
		else filters.topLevelOnly = true;
		writeView({ ...view, filters });
	};

	return (
		<header className="vf-view-header">
			<div className="vf-view-title">
				<h2>
					{snapshot.workspace.name}{" "}
					<span className="vf-view-title-code">
						({snapshot.workspace.idPrefix})
					</span>
				</h2>
				<span className="vf-count">
					{evaluated.total} {evaluated.total === 1 ? "task" : "tasks"}
				</span>

				<span className="vf-view-title-spacer" />

				{selectedCount > 0 && (
					<>
						<span className="vf-count">{selectedCount} selected</span>
						<BulkStatus snapshot={snapshot} evaluated={evaluated} />
						<button onClick={() => selection.clearSelection()}>Clear</button>
					</>
				)}

				<button className="mod-cta" onClick={() => void createTask(snapshot)}>
					New task
				</button>
			</div>

			<div className="vf-view-bar">
				<LayoutToggle view={view} onChange={writeView} />
				<span className="vf-bar-divider" />
				<GroupChip view={view} onChange={writeView} />
				<SortChip view={view} onChange={writeView} />
				<span className="vf-bar-divider" />
				<FilterControls
					snapshot={snapshot}
					view={view}
					taxonomies={taxonomies}
					onChange={writeView}
				/>

				<span className="vf-bar-spacer" />

				<label className="vf-toggle">
					<input
						type="checkbox"
						checked={showSubtasks}
						onChange={(event) => setShowSubtasks(event.target.checked)}
					/>
					<span>Show sub-tasks</span>
				</label>
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
