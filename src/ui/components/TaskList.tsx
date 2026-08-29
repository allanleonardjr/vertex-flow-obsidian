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
 *
 * A group carrying `rows` (the nested List view, §7.2) renders that indented
 * forest instead of `tasks` — with disclosure toggles and a muted "ghost" row
 * for any parent the filter excluded. Nested groups are drag-free; reordering a
 * sub-task stays a task-editor action.
 */

import { Fragment, type ReactNode } from "react";
import type { NestedRow } from "../../core/views";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Task, TaskField, WorkspaceSnapshot } from "../../core/types";
import { TaskRowContent } from "./TaskRow";

/** A titled run of tasks. A single group with no label renders as a flat list. */
export interface TaskListGroup {
	key: string;
	label?: string;
	/** Swatch beside the group label — a status colour, usually. */
	color?: string | null;
	tasks: Task[];
	collapsed?: boolean;
	/**
	 * The nested forest for this group (§7.2). When present it's rendered
	 * instead of `tasks`; `tasks` still carries the flat set for counts.
	 */
	rows?: NestedRow[];
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
	/** Collapse/expand a group by clicking its header. Omit for a fixed list. */
	onToggleGroupCollapse?: (groupKey: string) => void;
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
	/** Fields to hide from every row (§8.4). Omitted = show all. */
	hiddenFields?: readonly TaskField[];
	/** Placeholder inside an empty *group* (List's "Drop tasks here"). */
	emptyGroupLabel?: string;
	/** Nested List view: which parent rows have their subtree collapsed. */
	collapsedSubtrees?: ReadonlySet<string>;
	/** Nested List view: toggle a parent row's subtree. */
	onToggleSubtree?: (path: string) => void;
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
	hiddenFields,
	emptyGroupLabel,
	collapsedSubtrees,
	onToggleSubtree,
	className,
	children,
	containerRef,
}: TaskListProps) {
	return (
		<div className={`vf-list${className ? ` ${className}` : ""}`} ref={containerRef}>
			{groups.map((group) => {
				const dropIndex = interaction?.dropIndexFor?.(group.key) ?? null;
				const nested = group.rows != null;

				return (
					<Fragment key={group.key}>
						{grouped && group.label && (
							<GroupHeader
								group={group}
								onToggleCollapse={interaction?.onToggleGroupCollapse}
							/>
						)}

						{/* The section is the drop container, so an empty group is
						    still a target — that's how you move the last task out
						    of a status and back again. */}
						<div
							className={`vf-list-section${dropIndex !== null ? " is-drop-target" : ""}`}
							data-group-key={group.key}
						>
							{!group.collapsed &&
								(nested
									? group.rows!.map((row) => (
											<NestedListRow
												key={`${row.ghost ? "ghost:" : ""}${row.task.path}`}
												row={row}
												collapsed={
													collapsedSubtrees?.has(row.task.path) ?? false
												}
												onToggleSubtree={onToggleSubtree}
												snapshot={snapshot}
												taxonomies={taxonomies}
												interaction={row.ghost ? undefined : interaction}
												onOpenTask={onOpenTask}
												rowAction={row.ghost ? undefined : rowAction}
												hiddenFields={hiddenFields}
											/>
										))
									: group.tasks.map((task, index) => (
											<Fragment key={task.path}>
												{dropIndex === index && (
													<div className="vf-drop-indicator" />
												)}
												<TaskListRow
													task={task}
													groupKey={group.key}
													snapshot={snapshot}
													taxonomies={taxonomies}
													interaction={interaction}
													onOpenTask={onOpenTask}
													rowAction={rowAction}
													hiddenFields={hiddenFields}
												/>
											</Fragment>
										)))}

							{!nested && dropIndex === group.tasks.length && (
								<div className="vf-drop-indicator" />
							)}

							{emptyGroupLabel &&
								(nested ? group.rows!.length === 0 : group.tasks.length === 0) &&
								!group.collapsed && (
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

/**
 * A group's sticky header. Static text in a read-only list; a collapse toggle
 * (chevron + clickable row) when the List view supplies `onToggleCollapse`.
 */
function GroupHeader({
	group,
	onToggleCollapse,
}: {
	group: TaskListGroup;
	onToggleCollapse?: (groupKey: string) => void;
}) {
	const swatch = group.color && (
		<span className="vf-status-dot" style={{ backgroundColor: group.color }} />
	);
	const count = group.tasks.length;

	if (!onToggleCollapse) {
		return (
			<div className="vf-list-group">
				{swatch}
				<span>{group.label}</span>
				<span className="vf-count">{count}</span>
			</div>
		);
	}

	return (
		<button
			type="button"
			className="vf-list-group vf-list-group-toggle"
			aria-expanded={!group.collapsed}
			onClick={() => onToggleCollapse(group.key)}
		>
			<span
				className={`vf-section-chevron${group.collapsed ? "" : " is-open"}`}
				aria-hidden
			>
				›
			</span>
			{swatch}
			<span>{group.label}</span>
			<span className="vf-count">{count}</span>
		</button>
	);
}

/** One row of the nested forest — indentation, an optional disclosure toggle. */
function NestedListRow({
	row,
	collapsed,
	onToggleSubtree,
	snapshot,
	taxonomies,
	interaction,
	onOpenTask,
	rowAction,
	hiddenFields,
}: {
	row: NestedRow;
	collapsed: boolean;
	onToggleSubtree?: (path: string) => void;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	interaction?: TaskListInteraction;
	onOpenTask?: (path: string) => void;
	rowAction?: (task: Task) => ReactNode;
	hiddenFields?: readonly TaskField[];
}) {
	const { task, depth, hasChildren, ghost } = row;

	const disclosure = (
		<span
			className="vf-nest-disclosure"
			style={{ marginInlineStart: depth * 18 }}
			aria-hidden={!hasChildren}
		>
			{hasChildren && onToggleSubtree ? (
				<button
					type="button"
					className={`vf-section-chevron vf-nest-chevron${collapsed ? "" : " is-open"}`}
					aria-label={collapsed ? "Expand sub-tasks" : "Collapse sub-tasks"}
					aria-expanded={!collapsed}
					onClick={(event) => {
						event.stopPropagation();
						onToggleSubtree(task.path);
					}}
				>
					›
				</button>
			) : null}
		</span>
	);

	const content = (
		<>
			{disclosure}
			<TaskRowContent
				task={task}
				snapshot={snapshot}
				taxonomies={taxonomies}
				hiddenFields={hiddenFields}
			/>
		</>
	);

	const className = [
		"vf-row",
		"vf-row-nested",
		ghost ? "is-ghost" : "",
		!ghost && interaction?.isFocused?.(task) ? "is-focused" : "",
		!ghost && interaction?.isSelected?.(task) ? "is-selected" : "",
		task.archived ? "is-archived" : "",
		!ghost && rowAction ? "vf-row-with-action" : "",
	]
		.filter(Boolean)
		.join(" ");

	// Ghost rows never take part in selection or drag — they aren't results.
	if (ghost) {
		return (
			<div className={className} data-nested="true">
				<button
					className="vf-row-open"
					onClick={() => onOpenTask?.(task.path)}
				>
					{content}
				</button>
			</div>
		);
	}

	if (rowAction) {
		return (
			<div className={className} data-task-path={task.path} data-nested="true">
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
			data-nested="true"
			onClick={(event) => {
				if (interaction?.onRowClick) interaction.onRowClick(event, task);
				else onOpenTask?.(task.path);
			}}
		>
			{content}
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
	hiddenFields,
}: {
	task: Task;
	groupKey: string;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	interaction?: TaskListInteraction;
	onOpenTask?: (path: string) => void;
	rowAction?: (task: Task) => ReactNode;
	hiddenFields?: readonly TaskField[];
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

	const content = (
		<TaskRowContent
			task={task}
			snapshot={snapshot}
			taxonomies={taxonomies}
			hiddenFields={hiddenFields}
		/>
	);

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
