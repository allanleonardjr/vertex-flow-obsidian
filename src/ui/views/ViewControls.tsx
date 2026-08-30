/**
 * The viewport header: a title row (name, count, quick capture) and a
 * persistent control bar beneath it. Nothing on the bar is hidden behind a
 * button and nothing is styled as one — the layout, grouping, ordering,
 * visibility switches, and every active filter are always on screen as flat
 * text; only a control's value list opens on click.
 */

import { useState } from "react";
import type { EvaluatedView } from "../../core/views";
import {
	BUILT_IN_VIEW_ID,
	INBOX_VIEW_ID,
	layoutIcon,
	newView,
	setColumnsCollapsed,
} from "../../core/views";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type {
	SavedView,
	ViewColumnState,
	WorkspaceSnapshot,
} from "../../core/types";
import { newConfigId } from "../../core/ids";
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
	SubtasksChip,
} from "./DisplayControls";
import {
	AddFilterTrigger,
	FilterControls,
	shownFilterKeys,
	useFilterClauseState,
} from "./FilterControls";
import { activeReadonlyFilterKeys } from "./viewOptions";
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

	// `pending`/`editing` are shared by the Row 1 "+ Filter" trigger and the
	// Row 2 chip list — see `FilterControls`.
	const filterClause = useFilterClauseState();
	// The filters row is mounted only when it has something to show: a clause
	// with a value, a query-only clause, or a just-added clause awaiting one.
	const hasFilterRow =
		shownFilterKeys(view.filters, filterClause.pending).length +
			activeReadonlyFilterKeys(view.filters).length >
		0;

	const selectedCount = selection.selectedPaths.length;

	// The two permanent views (All Tasks, Inbox) are fixed fixtures: their
	// name/icon and their purpose are not the user's to change, so no inline
	// title editing and no description section. A synthesised label/project
	// view isn't in `_views.md` at all.
	const permanentView =
		savedView.id === BUILT_IN_VIEW_ID || savedView.id === INBOX_VIEW_ID;
	const inSavedViews = snapshot.views.some((v) => v.id === savedView.id);

	// "Save" (overwrite in place) works for any view backed by `_views.md` —
	// the two permanent views included (filter/group/sort tweaks persist just
	// like a user view). A synthesised label view isn't backed, so an ad-hoc
	// filter there becomes a *new* view or nothing at all.
	const canOverwrite = inSavedViews;

	// Name/icon and the description section: real user views only.
	const canEditIdentity = inSavedViews && !permanentView;
	const titleEditable = canEditIdentity;
	const showDescription = !hideTitle && canEditIdentity;
	const descCollapsed = plugin.settings.descriptionCollapsed;
	const descSourceMode = plugin.settings.descriptionSourceMode;

	const editView = draft.edit;

	const saveAs = (name: string, icon: string | undefined) => {
		const created: SavedView = {
			...newView(newConfigId("view"), name, view.viewType, icon),
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
									iconFallback={layoutIcon(savedView.viewType)}
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
											fallback={layoutIcon(view.viewType)}
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

			{/* Row 1 — always on screen: layout + every display control + the
			    action triggers (+ Filter, Query) that must stay reachable even
			    when Row 2 doesn't exist. */}
			<div className="vf-view-bar vf-view-bar-display">
				<LayoutToggle view={view} onChange={editView} />
				{/* Timeline and Calendar ignore grouping entirely (a day grid has no
				    columns to group), so the control is hidden for both. */}
				{view.viewType !== "timeline" && view.viewType !== "calendar" && (
					<>
						<span className="vf-bar-divider" />
						<GroupChip view={view} onChange={editView} />
						{view.groupBy !== "none" && view.viewType === "board" && (
							<EmptyColumnsChip view={view} onChange={editView} />
						)}
						{/* List and Board share one collapsed-column set, so the bulk
						    toggle has to be reachable from both — otherwise a board
						    inherits a "collapse all" done on the list with no way
						    back. */}
						{view.groupBy !== "none" && (
							<CollapseAllToggle
								view={view}
								evaluated={evaluated}
								onColumnsChange={draft.setColumns}
							/>
						)}
					</>
				)}
				<span className="vf-bar-divider" />
				<SortChip view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<SubtasksChip view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<FieldsControl view={view} onChange={editView} />
				<span className="vf-bar-divider" />
				<AddFilterTrigger view={view} clause={filterClause} />

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

				<span className="vf-bar-spacer" />

				{draft.dirty && (
					<>
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
			</div>

			{/* Row 2 — the active filter chips. Not rendered at all when there
			    are none, so an unfiltered view reserves no height for it. */}
			{hasFilterRow && (
				<div className="vf-view-bar vf-view-bar-filters">
					<FilterControls
						snapshot={snapshot}
						view={view}
						taxonomies={taxonomies}
						onChange={editView}
						clause={filterClause}
					/>
				</div>
			)}

			{/* Row 3 — the text query editor. */}
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
						sourceMode={descSourceMode}
						onToggleSourceMode={() =>
							writeSettings({ descriptionSourceMode: !descSourceMode })
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
						permanentView
							? "New view"
							: canOverwrite
								? `${savedView.name} copy`
								: savedView.name
					}
					initialIcon={view.icon}
					iconFallback={layoutIcon(view.viewType)}
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
 * it collapses. Writes straight to disk like the per-group toggle.
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

/** Bulk status edit across the multi-selection. */
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
