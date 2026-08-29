/**
 * The viewport header: a title row (name, count, quick capture) and a
 * persistent control bar beneath it. Nothing on the bar is hidden behind a
 * button and nothing is styled as one — the layout, grouping, ordering,
 * visibility switches, and every active filter are always on screen as flat
 * text; only a control's value list opens on click.
 */

import { useState } from "react";
import type { EvaluatedView } from "../../core/views";
import { BUILT_IN_VIEW_ID, newView, setColumnsCollapsed } from "../../core/views";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type {
	SavedView,
	ViewColumnState,
	ViewFilters,
	WorkspaceSnapshot,
} from "../../core/types";
import { joinPath } from "../../core/links";
import { withExtension } from "../../obsidian/note-io";
import { VIEWS_NOTE } from "../../obsidian/index-store";
import { usePlugin, useSettingsWriter } from "../context";
import { DescriptionSection } from "../components/DescriptionSection";
import { EditableTitle } from "../components/EditableTitle";
import { Icon } from "../components/Icon";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useSelection } from "../selection";
import {
	EmptyColumnsChip,
	FieldsControl,
	GroupChip,
	LayoutToggle,
	SortChip,
} from "./DisplayControls";
import { FilterControls } from "./FilterControls";
import { QueryBar } from "./QueryBar";
import type { ViewDraft } from "./useViewDraft";

export function ViewControls({
	snapshot,
	view,
	savedView,
	draft,
	taxonomies,
	evaluated,
	onSelectView,
	onNewTask,
	hideTitle = false,
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
	/** Create a task seeded from this view's filters (see `TaskViewport`). */
	onNewTask: () => void;
	/**
	 * Drop the title row (name, count, "New task"). Set when an outer header
	 * already names the thing being viewed — the Project Detail screen — so the
	 * bar isn't preceded by a redundant second heading. Bulk-selection controls
	 * still appear here when something is selected.
	 */
	hideTitle?: boolean;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const selection = useSelection();
	const [savingAs, setSavingAs] = useState(false);
	const queryOpen = plugin.settings.queryBarOpen;

	const selectedCount = selection.selectedPaths.length;
	const showSubtasks = !view.filters.topLevelOnly;

	// "Save" (overwrite in place) only makes sense for a real Saved View. The
	// built-in "Tasks" and a synthesised label view aren't in `_views.md`, so an
	// ad-hoc filter there becomes a *new* view or nothing at all.
	const canOverwrite = snapshot.views.some((v) => v.id === savedView.id);

	// The name/icon are editable inline for any real Saved View (the built-in
	// included); a synthesised label view isn't one and stays a plain heading.
	const titleEditable = canOverwrite;
	// The description section is offered for real user views only — not the
	// built-in "All Tasks", and not synthesised label views.
	const showDescription =
		!hideTitle && canOverwrite && savedView.id !== BUILT_IN_VIEW_ID;
	const descCollapsed = plugin.settings.descriptionCollapsed;

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
			hiddenFields: view.hiddenFields,
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
			{(!hideTitle || selectedCount > 0) && (
				<div className="vf-view-title">
					{!hideTitle && (
						<>
							{titleEditable ? (
								<EditableTitle
									key={savedView.id}
									icon={savedView.icon}
									iconFallback={
										savedView.viewType === "board" ? "columns-3" : "list"
									}
									name={savedView.name}
									suffix={`(${snapshot.workspace.idPrefix})`}
									placeholder="View name"
									onRename={(name) =>
										plugin.mutations.updateView(snapshot, {
											...savedView,
											name,
										})
									}
									onIconChange={(icon) =>
										void plugin.mutations.updateView(snapshot, {
											...savedView,
											icon,
										})
									}
								/>
							) : (
								<h2>
									<span className="vf-view-title-icon" aria-hidden>
										<Icon
											id={view.icon}
											fallback={
												view.viewType === "board" ? "columns-3" : "list"
											}
											size={16}
										/>
									</span>
									{view.name}
									<span className="vf-view-title-code">
										({snapshot.workspace.idPrefix})
									</span>
								</h2>
							)}
							<span className="vf-count">
								{evaluated.total} {evaluated.total === 1 ? "task" : "tasks"}
							</span>
						</>
					)}

					<span className="vf-view-title-spacer" />

					{selectedCount > 0 && (
						<>
							<span className="vf-count">{selectedCount} selected</span>
							<BulkStatus snapshot={snapshot} evaluated={evaluated} />
							<button onClick={() => selection.clearSelection()}>Clear</button>
						</>
					)}

					{!hideTitle && (
						<button className="mod-cta" onClick={onNewTask}>
							New task
						</button>
					)}
				</div>
			)}

			<div className="vf-view-bar">
				<LayoutToggle view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<GroupChip view={view} onChange={editView} />
				{view.groupBy !== "none" && view.viewType === "board" && (
					<EmptyColumnsChip view={view} onChange={editView} />
				)}
				{view.groupBy !== "none" && view.viewType === "list" && (
					<CollapseAllToggle
						view={view}
						evaluated={evaluated}
						onColumnsChange={draft.setColumns}
					/>
				)}
				<span className="vf-bar-divider" />
				<SortChip view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<FieldsControl view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<FilterControls
					snapshot={snapshot}
					view={view}
					taxonomies={taxonomies}
					onChange={editView}
				/>

				<button
					type="button"
					className={`vf-bar-item vf-query-toggle${queryOpen ? " is-on" : ""}`}
					aria-expanded={queryOpen}
					aria-controls="vf-query-row"
					title="Edit this view as a text query"
					onClick={() => writeSettings({ queryBarOpen: !queryOpen })}
				>
					<span
						className={`vf-section-chevron${queryOpen ? " is-open" : ""}`}
						aria-hidden
					>
						›
					</span>
					Query
				</button>

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

			{queryOpen && (
				<div id="vf-query-row">
					<QueryBar snapshot={snapshot} view={view} onChange={editView} />
				</div>
			)}

			{showDescription && (
				<div className="vf-view-description">
					<DescriptionSection
						collapsed={descCollapsed}
						onToggleCollapsed={() =>
							writeSettings({ descriptionCollapsed: !descCollapsed })
						}
						value={savedView.description ?? ""}
						editorKey={savedView.id}
						sourcePath={withExtension(
							joinPath(snapshot.workspace.root, VIEWS_NOTE),
						)}
						onSave={(text) =>
							void plugin.mutations.updateView(snapshot, {
								...savedView,
								description: text.trim() || undefined,
							})
						}
					/>
				</div>
			)}

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

/**
 * List-view "collapse all" / "expand all" for grouped rows. Flips based on
 * current state: if every visible group is already collapsed it expands, else
 * it collapses. Writes straight to disk like the per-group toggle (§8.2).
 */
function CollapseAllToggle({
	view,
	evaluated,
	onColumnsChange,
}: {
	view: SavedView;
	evaluated: EvaluatedView;
	onColumnsChange: (columns: ViewColumnState) => void;
}) {
	const keys = evaluated.groups
		.filter((group) => !group.hidden)
		.map((group) => group.key);
	if (keys.length === 0) return null;

	const allCollapsed = evaluated.groups
		.filter((group) => !group.hidden)
		.every((group) => group.collapsed);

	return (
		<button
			type="button"
			className="vf-bar-item"
			onClick={() =>
				onColumnsChange(
					setColumnsCollapsed(view, keys, !allCollapsed).columns,
				)
			}
		>
			{allCollapsed ? "Expand all" : "Collapse all"}
		</button>
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
