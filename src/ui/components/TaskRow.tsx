/**
 * One task, rendered as a List-view row.
 *
 * Extracted from `ListView` so the same row — status dot, ID, title,
 * sub-task marker, and the whole trailing meta cluster — renders identically
 * wherever a task is listed: the List view itself, a parent's sub-tasks, and
 * a task's relations. Previously relations were bare chips showing only a
 * filename, which told you nothing about the thing you were linking to.
 */

import { scopeOf, subtaskProgress } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import {
	emptyProgress,
	type Task,
	type TaskField,
	type WorkspaceSnapshot,
} from "../../core/types";
import {
	Assignee,
	DueDate,
	Labels,
	ProgressBar,
	RelationBadge,
	StatusDot,
	TaxonomyChip,
} from "./TaskBits";

/**
 * The row's contents, with no interaction of its own — the caller supplies
 * the wrapper, so this works equally inside List's draggable `<div>`, the
 * drag preview, and a plain clickable button.
 */
export function TaskRowContent({
	task,
	snapshot,
	taxonomies,
	hiddenFields,
	dense = false,
}: {
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	/** Fields this view hides (§8.4). Omitted (relations lists, pickers) shows all. */
	hiddenFields?: readonly TaskField[];
	/**
	 * Compact single-line render for tight containers (Calendar day chips):
	 * status dot + title only, no ID and no trailing meta cluster. The
	 * `hiddenFields` list still applies to whatever a caller chooses to show.
	 */
	dense?: boolean;
}) {
	const off = (field: TaskField) => hiddenFields?.includes(field) ?? false;

	const scope = scopeOf(snapshot);
	const progress =
		dense || off("progress")
			? emptyProgress()
			: subtaskProgress(scope, task, taxonomies.status);

	if (dense) {
		return (
			<>
				<StatusDot taxonomies={taxonomies} status={task.status} />
				<span className="vf-row-title">
					{task.parent && (
						<span className="vf-subtask-marker" title="Sub-task">
							↳
						</span>
					)}
					{task.title}
				</span>
			</>
		);
	}

	return (
		<>
			<StatusDot taxonomies={taxonomies} status={task.status} />

			<span className="vf-id">{task.id}</span>

			<span className="vf-row-title">
				{task.parent && (
					<span className="vf-subtask-marker" title="Sub-task">
						↳
					</span>
				)}
				{task.title}
			</span>

			<span className="vf-row-meta">
				{!off("relations") && <RelationBadge task={task} />}
				{!off("progress") && <ProgressBar progress={progress} />}
				{!off("labels") && <Labels taxonomies={taxonomies} labels={task.labels} />}
				{!off("priority") && (
					<TaxonomyChip taxonomies={taxonomies} kind="priority" id={task.priority} />
				)}
				{!off("dueDate") && <DueDate task={task} />}
				{!off("assignee") && (
					<Assignee people={snapshot.workspace.people} assignee={task.assignee} />
				)}
			</span>
		</>
	);
}

/**
 * A relation pointing at something the index can't resolve — a note outside
 * any workspace, or one deleted while the link survived. Shown rather than
 * hidden: a dangling relation the user can see and remove beats one that
 * silently disappears from the UI but stays in the file.
 */
export function MissingTaskRow({
	label,
	onRemove,
	removeTitle,
}: {
	label: string;
	onRemove?: () => void;
	removeTitle?: string;
}) {
	// Same `vf-row-with-action` shape as a real row carrying a trailing
	// control, so a dangling relation lines up with the resolved ones above it.
	return (
		<div className="vf-row vf-row-with-action">
			<span className="vf-row-missing">
				<span className="vf-row-title">{label}</span>
				<span className="vf-row-meta">
					<span className="vf-blocked">not found</span>
				</span>
			</span>
			{onRemove && (
				<button className="vf-icon-button vf-row-remove" title={removeTitle} onClick={onRemove}>
					✕
				</button>
			)}
		</div>
	);
}
