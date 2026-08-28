/**
 * The viewport header: a title row (name, count, quick capture) and a
 * persistent control bar beneath it. Nothing on the bar is hidden behind a
 * button and nothing is styled as one — the layout, grouping, ordering,
 * visibility switches, and every active filter are always on screen as flat
 * text; only a control's value list opens on click.
 */

import { useState } from "react";
import type { EvaluatedView } from "../../core/views";
import { BUILT_IN_VIEW_ID, newView } from "../../core/views";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { SavedView, ViewFilters, WorkspaceSnapshot } from "../../core/types";
import { useCreateTask } from "../actions";
import { usePlugin, useSettingsWriter } from "../context";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useSelection } from "../selection";
import { GroupChip, LayoutToggle, SortChip } from "./DisplayControls";
import { FilterControls } from "./FilterControls";
import type { ViewDraft } from "./useViewDraft";

export function ViewControls({
	snapshot,
	view,
	savedView,
	draft,
	taxonomies,
	evaluated,
	onSelectView,
}: {
	snapshot: WorkspaceSnapshot;
	/** The view being rendered — the draft when one is pending. */
	view: SavedView;
	/** What's actually on disk, for the "unsaved" comparison and Save-as seed. */
	savedView: SavedView;
	draft: ViewDraft;
	taxonomies: WorkspaceTaxonomies;
	evaluated: EvaluatedView;
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const selection = useSelection();
	const createTask = useCreateTask();
	const [savingAs, setSavingAs] = useState(false);

	const selectedCount = selection.selectedPaths.length;
	const showSubtasks = !view.filters.topLevelOnly;

	// "Save" (overwrite in place) only makes sense for a real Saved View. The
	// built-in "Tasks" and a synthesised label view aren't in `_views.md`, so an
	// ad-hoc filter there becomes a *new* view or nothing at all.
	const canOverwrite = snapshot.views.some((v) => v.id === savedView.id);

	const editView = draft.edit;

	const setShowSubtasks = (next: boolean) => {
		const filters: ViewFilters = { ...view.filters };
		if (next) delete filters.topLevelOnly;
		else filters.topLevelOnly = true;
		editView({ ...view, filters });
	};

	const saveAs = (name: string, icon: string | undefined) => {
		const created: SavedView = {
			...newView(`view-${Date.now().toString(36)}`, name, view.viewType, icon),
			filters: view.filters,
			groupBy: view.groupBy,
			sortBy: view.sortBy,
			sortDirection: view.sortDirection,
			emptyColumnBehavior: view.emptyColumnBehavior,
		};
		void plugin.mutations.addView(snapshot, created).then(() => {
			// Drop the draft before switching, or it would follow us to the new
			// view and immediately read as unsaved again.
			draft.reset();
			onSelectView(created.id);
		});
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
				<LayoutToggle view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<GroupChip view={view} onChange={editView} />
				<SortChip view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<FilterControls
					snapshot={snapshot}
					view={view}
					taxonomies={taxonomies}
					onChange={editView}
				/>

				{draft.dirty && (
					<>
						<span className="vf-bar-divider" />
						<button
							type="button"
							className="vf-bar-item vf-bar-reset"
							title="Discard unsaved changes to this view"
							onClick={draft.reset}
						>
							Reset
						</button>
						{canOverwrite && (
							<button
								type="button"
								className="vf-bar-item vf-bar-save"
								title={`Save these changes to "${savedView.name}"`}
								onClick={draft.save}
							>
								Save
							</button>
						)}
						<button
							type="button"
							className="vf-bar-item vf-bar-save"
							onClick={() => setSavingAs(true)}
						>
							Save view as…
						</button>
					</>
				)}

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

			{savingAs && (
				<NamedIconDialog
					title="Save view as"
					initialName={
						canOverwrite
							? `${savedView.name} copy`
							: savedView.id === BUILT_IN_VIEW_ID
								? "New view"
								: savedView.name
					}
					initialIcon={view.icon}
					iconFallback={view.viewType === "board" ? "columns-3" : "list"}
					confirmLabel="Create view"
					onConfirm={saveAs}
					onClose={() => setSavingAs(false)}
				/>
			)}
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
