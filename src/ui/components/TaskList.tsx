/**
 * The task list — one module, used everywhere a set of tasks is shown as rows.
 *
 * The List view is the reference implementation of "what a task looks like in
 * a list": status dot, ID, title, sub-task marker, then the trailing meta
 * cluster of relations badge, progress, labels, priority, due date, assignee.
 * Anywhere else that lists tasks — a parent's sub-tasks, a task's `blockedBy`
 * relations — should look and behave identically rather than reinventing a
 * thinner version of the same row.
 *
 * The seam between "list" and "List view" is the optional `interaction` prop.
 * Drag-and-drop, multi-select, and keyboard focus are genuinely view-specific
 * concerns, so this module knows nothing about them; it just asks, per row and
 * per group, what state to reflect and what handlers to attach. `ListView`
 * supplies all of it. A relations list supplies none of it and gets a plain,
 * read-only list of the same rows for free.
 */

import { Fragment, type ReactNode } from "react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import { TaskRowContent } from "./TaskRow";

/** A titled run of tasks. A single group with no label renders as a flat list. */
export interface TaskListGroup {
	key: string;
	label?: string;
	/** Swatch beside the group label — a status colour, usually. */
	color?: string | null;
	tasks: Task[];
	collapsed?: boolean;
}

/**
 * Everything the List view layers on top of a plain list. All optional: a
 * caller that omits this gets rows that are clickable (via `onOpenTask`) and
 * nothing else.
 */
export interface TaskListInteraction {
	isFocused?: (task: Task) => boolean;
	isSelected?: (task: Task) => boolean;
	isDragging?: (task: Task) => boolean;
	onRowPointerDown?: (event: React.PointerEvent, task: Task, groupKey: string) => void;
	onRowClick?: (event: React.MouseEvent, task: Task) => void;
	/** Insert position for the drop indicator within a group, or null. */
	dropIndexFor?: (groupKey: string) => number | null;
}

export interface TaskListProps {
	groups: TaskListGroup[];
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	/** Render group headers. Off for a flat list like a relation's tasks. */
	grouped?: boolean;
	interaction?: TaskListInteraction;
	/** Plain click-to-open, for lists with no full interaction model. */
	onOpenTask?: (path: string) => void;
	/** Trailing per-row control — relations use it for "remove". */
	rowAction?: (task: Task) => ReactNode;
	/** Placeholder inside an empty *group* (List's "Drop tasks here"). */
	emptyGroupLabel?: string;
	className?: string;
	/** Extra content after the groups — List's drag preview portal. */
	children?: ReactNode;
	containerRef?: (element: HTMLDivElement | null) => void;
}

export function TaskList({
	groups,
	snapshot,
	taxonomies,
	grouped = false,
	interaction,
	onOpenTask,
	rowAction,
	emptyGroupLabel,
	className,
	children,
	containerRef,
}: TaskListProps) {
	return (
		<div className={`vf-list${className ? ` ${className}` : ""}`} ref={containerRef}>
			{groups.map((group) => {
				const dropIndex = interaction?.dropIndexFor?.(group.key) ?? null;

				return (
					<Fragment key={group.key}>
						{grouped && group.label && (
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

						{/* The section is the drop container, so an empty group is
						    still a target — that's how you move the last task out
						    of a status and back again. */}
						<div
							className={`vf-list-section${dropIndex !== null ? " is-drop-target" : ""}`}
							data-group-key={group.key}
						>
							{!group.collapsed &&
								group.tasks.map((task, index) => (
									<Fragment key={task.path}>
										{dropIndex === index && <div className="vf-drop-indicator" />}
										<TaskListRow
											task={task}
											groupKey={group.key}
											snapshot={snapshot}
											taxonomies={taxonomies}
											interaction={interaction}
											onOpenTask={onOpenTask}
											rowAction={rowAction}
										/>
									</Fragment>
								))}

							{dropIndex === group.tasks.length && <div className="vf-drop-indicator" />}

							{emptyGroupLabel && group.tasks.length === 0 && (
								<div className="vf-list-empty">{emptyGroupLabel}</div>
							)}
						</div>
					</Fragment>
				);
			})}

			{children}
		</div>
	);
}

function TaskListRow({
	task,
	groupKey,
	snapshot,
	taxonomies,
	interaction,
	onOpenTask,
	rowAction,
}: {
	task: Task;
	groupKey: string;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	interaction?: TaskListInteraction;
	onOpenTask?: (path: string) => void;
	rowAction?: (task: Task) => ReactNode;
}) {
	const className = [
		"vf-row",
		interaction?.isFocused?.(task) ? "is-focused" : "",
		interaction?.isSelected?.(task) ? "is-selected" : "",
		interaction?.isDragging?.(task) ? "is-dragging" : "",
		task.archived ? "is-archived" : "",
		rowAction ? "vf-row-with-action" : "",
	]
		.filter(Boolean)
		.join(" ");

	const content = <TaskRowContent task={task} snapshot={snapshot} taxonomies={taxonomies} />;

	// With a trailing action the row can't be one big click target — a button
	// inside a button is invalid, and the two would fight for the same click.
	// The row's content becomes its own button, the action sits beside it.
	if (rowAction) {
		return (
			<div
				className={className}
				data-task-path={task.path}
				onPointerDown={(event) =>
					interaction?.onRowPointerDown?.(event, task, groupKey)
				}
			>
				<button
					className="vf-row-open"
					onClick={(event) => {
						if (interaction?.onRowClick) interaction.onRowClick(event, task);
						else onOpenTask?.(task.path);
					}}
				>
					{content}
				</button>
				{rowAction(task)}
			</div>
		);
	}

	return (
		<div
			className={className}
			data-task-path={task.path}
			onPointerDown={(event) => interaction?.onRowPointerDown?.(event, task, groupKey)}
			onClick={(event) => {
				if (interaction?.onRowClick) interaction.onRowClick(event, task);
				else onOpenTask?.(task.path);
			}}
		>
			{content}
		</div>
	);
}
