/**
 * List view (§8.1) — dense, Linear-style rows, grouped by whatever the Saved
 * View groups by.
 */

import { Fragment } from "react";
import { childTasks, computeProgress, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { EvaluatedView } from "../../core/views";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import {
	Assignee,
	DueDate,
	Labels,
	ProgressBar,
	RelationBadge,
	StatusDot,
	TaxonomyChip,
} from "../components/TaskBits";
import { usePlugin } from "../context";
import { useSelection } from "../selection";

export function ListView({
	snapshot,
	evaluated,
	taxonomies,
}: {
	snapshot: WorkspaceSnapshot;
	evaluated: EvaluatedView;
	taxonomies: WorkspaceTaxonomies;
}) {
	if (evaluated.total === 0) {
		return (
			<div className="vf-empty-view">
				<p>Nothing here yet.</p>
				<p className="vf-empty-note">
					Press <kbd>c</kbd> to capture a task.
				</p>
			</div>
		);
	}

	const groups = evaluated.groups.filter((group) => !group.hidden);

	return (
		<div className="vf-list">
			{groups.map((group) => (
				<Fragment key={group.key}>
					{evaluated.view.groupBy !== "none" && (
						<div className="vf-list-group">
							{group.color && (
								<span
									className="vf-status-dot"
									style={{ backgroundColor: group.color }}
								/>
							)}
							<span>{group.label}</span>
							<span className="vf-count">{group.tasks.length}</span>
						</div>
					)}
					{!group.collapsed &&
						group.tasks.map((task) => (
							<TaskRow
								key={task.path}
								task={task}
								snapshot={snapshot}
								taxonomies={taxonomies}
							/>
						))}
				</Fragment>
			))}
		</div>
	);
}

function TaskRow({
	task,
	snapshot,
	taxonomies,
}: {
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	const plugin = usePlugin();
	const selection = useSelection();

	const scope = scopeOf(snapshot);
	const children = childTasks(scope, task.path);
	const progress = computeProgress(children, taxonomies.status);

	const focused = selection.focusedPath === task.path;
	const selected = selection.isSelected(task.path);

	return (
		<div
			className={[
				"vf-row",
				focused ? "is-focused" : "",
				selected ? "is-selected" : "",
				task.archived ? "is-archived" : "",
			]
				.filter(Boolean)
				.join(" ")}
			onClick={(event) =>
				selection.select(task.path, {
					toggle: event.metaKey || event.ctrlKey,
					range: event.shiftKey,
				})
			}
			onDoubleClick={() => void plugin.mutations.open(task.path)}
		>
			<StatusDot taxonomies={taxonomies} status={task.status} />

			<span className="vf-id">{task.id}</span>

			<span className="vf-row-title">
				{task.parent && <span className="vf-subtask-marker" title="Sub-task">↳</span>}
				{task.title}
			</span>

			<span className="vf-row-meta">
				<RelationBadge task={task} />
				<ProgressBar progress={progress} />
				<Labels taxonomies={taxonomies} labels={task.labels} />
				<TaxonomyChip taxonomies={taxonomies} kind="priority" id={task.priority} />
				<DueDate task={task} />
				<Assignee people={snapshot.workspace.people} assignee={task.assignee} />
			</span>
		</div>
	);
}
