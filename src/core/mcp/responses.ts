/**
 * JSON payload builders for the MCP tools.
 *
 * Every tool returns structured JSON (the surface decision: plain objects, not
 * flattened prose), and every payload is built here as a pure function over a
 * `WorkspaceSnapshot` or lighter core values — no Obsidian import, so the whole
 * response surface is unit-tested like the rest of core.
 *
 * List results share one shape: `{ results, total, truncated }` — a hard cap,
 * never pagination (no cursor state for a stateless protocol), with `total`
 * counting what the filter *would* have returned so an LLM can see it was cut
 * off and narrow its query.
 *
 * Errors share the `{ error: { code, message } }` shape; the glue layer turns
 * that into an MCP `isError` result.
 */

import { workspaceTaxonomies } from "../taxonomy";
import type {
	Comment,
	DashboardConfig,
	LinkTarget,
	Project,
	SavedView,
	Task,
	ViewFilters,
	WorkspaceSnapshot,
} from "../types";
import { snapshotContext } from "../views/context";
import { applyFilters } from "../views/filter";
import { buildVaultUri } from "./uris";

/** Every list tool returns at most this many rows. */
export const MCP_MAX_RESULTS = 200;

export interface McpListPayload<T> {
	results: T[];
	/** The number of rows the filter matched, before the cap was applied. */
	total: number;
	/** True when `results` was cut down from a longer `total`. */
	truncated: boolean;
}

export interface McpErrorPayload {
	error: { code: string; message: string };
}

export function errorPayload(code: string, message: string): McpErrorPayload {
	return { error: { code, message } };
}

/** Apply the shared cap and annotate. */
export function pageList<T>(rows: T[]): McpListPayload<T> {
	return {
		results: rows.slice(0, MCP_MAX_RESULTS),
		total: rows.length,
		truncated: rows.length > MCP_MAX_RESULTS,
	};
}

/* ------------------------------------------------------------- workspace --- */

export interface McpWorkspaceRow {
	id: string;
	root: string;
	name: string;
	idPrefix: string;
	icon?: string;
	projectCount: number;
	taskCount: number;
	viewCount: number;
	dashboardCount: number;
	personCount: number;
	labelCount: number;
}

export function workspaceRow(snapshot: WorkspaceSnapshot): McpWorkspaceRow {
	return {
		id: snapshot.workspace.root,
		root: snapshot.workspace.root,
		name: snapshot.workspace.name,
		idPrefix: snapshot.workspace.idPrefix,
		icon: snapshot.workspace.icon,
		projectCount: snapshot.projects.length,
		taskCount: snapshot.tasks.length,
		viewCount: snapshot.views.length,
		dashboardCount: snapshot.dashboards.length,
		personCount: snapshot.workspace.people.length,
		labelCount: snapshot.workspace.labels.length,
	};
}

export function workspaceDetail(
	snapshot: WorkspaceSnapshot,
): {
	workspace: McpWorkspaceRow;
	statuses: { id: string; name: string; color: string; category?: string }[];
	priorities: { id: string; name: string; color: string; order?: number }[];
	taskTypes: { id: string; name: string; color: string }[];
	labels: { id: string; name: string; color: string; description?: string }[];
	people: string[];
	projects: McpProjectRow[];
	views: McpViewRow[];
	dashboards: McpDashboardRow[];
} {
	const taxonomies = workspaceTaxonomies(snapshot.workspace);
	const projectCounts = countTasksByProject(snapshot);
	return {
		workspace: workspaceRow(snapshot),
		statuses: taxonomies.status.values.map((v) => ({
			id: v.id,
			name: v.name,
			color: v.color,
			category: v.category,
		})),
		priorities: taxonomies.priority.values.map((v) => ({
			id: v.id,
			name: v.name,
			color: v.color,
			order: v.order,
		})),
		taskTypes: taxonomies.taskType.values.map((v) => ({
			id: v.id,
			name: v.name,
			color: v.color,
		})),
		labels: snapshot.workspace.labels.map((v) => ({
			id: v.id,
			name: v.name,
			color: v.color,
			description: v.description,
		})),
		people: snapshot.workspace.people.map((p) => p.name),
		projects: snapshot.projects.map((p) => projectRow(snapshot, p, projectCounts)),
		views: snapshot.views.map((v) => viewRow(snapshot.workspace.root, v)),
		dashboards: snapshot.dashboards.map((d) =>
			dashboardRow(snapshot.workspace.root, d),
		),
	};
}

/* -------------------------------------------------------------- project --- */

export interface McpProjectRow {
	id: string;
	title: string;
	icon?: string;
	status: string | null;
	priority: string | null;
	owner: string | null;
	labels: string[];
	startDate: string | null;
	dueDate: string | null;
	taskCount: number;
	archived: boolean;
}

export function countTasksByProject(
	snapshot: WorkspaceSnapshot,
): Map<LinkTarget, number> {
	const counts = new Map<LinkTarget, number>();
	for (const task of snapshot.tasks) {
		if (!task.project) continue;
		counts.set(task.project, (counts.get(task.project) ?? 0) + 1);
	}
	return counts;
}

export function projectRow(
	snapshot: WorkspaceSnapshot,
	project: Project,
	counts: Map<LinkTarget, number>,
): McpProjectRow {
	void snapshot;
	return {
		id: project.path,
		title: project.title,
		icon: project.icon,
		status: project.status,
		priority: project.priority,
		owner: project.owner,
		labels: project.labels,
		startDate: project.startDate,
		dueDate: project.dueDate,
		taskCount: counts.get(project.path) ?? 0,
		archived: project.archived,
	};
}

export function projectDetail(
	snapshot: WorkspaceSnapshot,
	project: Project,
	description: string,
): {
	project: McpProjectRow & { description?: string };
} {
	const counts = countTasksByProject(snapshot);
	const row = projectRow(snapshot, project, counts);
	return { project: { ...row, ...(description ? { description } : {}) } };
}

export function projectRows(
	snapshot: WorkspaceSnapshot,
	filters: { status?: string | null; archived?: boolean } = {},
): McpProjectRow[] {
	const counts = countTasksByProject(snapshot);
	return snapshot.projects
		.filter((p) => {
			if (filters.status !== undefined && filters.status !== null) {
				if (p.status !== filters.status) return false;
			}
			if (filters.archived === true && !p.archived) return false;
			return true;
		})
		.map((p) => projectRow(snapshot, p, counts));
}

/* ---------------------------------------------------------------- task ---- */

export interface McpTaskRow {
	id: string;
	title: string;
	path: string;
	status: string | null;
	priority: string | null;
	taskType: string | null;
	assignee: string | null;
	project: LinkTarget | null;
	parent: LinkTarget | null;
	labels: string[];
	estimate: number | null;
	startDate: string | null;
	dueDate: string | null;
	archived: boolean;
	subTaskCount: number;
	createdAt: string;
	updatedAt: string;
}

export function countSubtasks(
	snapshot: WorkspaceSnapshot,
): Map<LinkTarget, number> {
	const counts = new Map<LinkTarget, number>();
	for (const task of snapshot.tasks) {
		if (!task.parent) continue;
		counts.set(task.parent, (counts.get(task.parent) ?? 0) + 1);
	}
	return counts;
}

/** A task's summary row, with `vaultUri` (open in the plugin editor). */
export function taskRow(
	subtaskCounts: Map<LinkTarget, number>,
	task: Task,
): McpTaskRow {
	return {
		id: task.id,
		title: task.title,
		path: task.path,
		status: task.status,
		priority: task.priority,
		taskType: task.taskType,
		assignee: task.assignee,
		project: task.project,
		parent: task.parent,
		labels: task.labels,
		estimate: task.estimate,
		startDate: task.startDate,
		dueDate: task.dueDate,
		archived: task.archived,
		subTaskCount: subtaskCounts.get(task.path) ?? 0,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
	};
}

/**
 * A task's summary row plus the deep-link that opens it in the plugin.
 * Kept a separate shape from the list row so get_task can merge its extras
 * without carrying `vaultUri` on a 200-row list.
 */
export function taskRowWithUri(
	subtaskCounts: Map<LinkTarget, number>,
	task: Task,
): McpTaskRow & { vaultUri: string } {
	return {
		...taskRow(subtaskCounts, task),
		vaultUri: buildVaultUri({
			action: "open-note",
			path: task.path,
			target: "vf",
		}),
	};
}

/**
 * Filter + cap a workspace's tasks. `filters` rides the real Saved View filter
 * engine (`applyFilters`), resolved against a context that names people and
 * projects — so `{ status: ["todo"], assignee: [SELF], project: [path] }` all
 * behave exactly the way the UI does. Like every view, archived tasks are
 * hidden unless `showArchived` widens the archive mode to `"included"`.
 */
export function taskRows(
	snapshot: WorkspaceSnapshot,
	filters: ViewFilters = {},
	me: string | null = null,
	showArchived = false,
): McpTaskRow[] {
	const counts = countSubtasks(snapshot);
	const context = snapshotContext(snapshot, me);
	const effective = showArchived
		? { ...filters, archived: "included" as const }
		: filters;
	const matched = applyFilters(snapshot.tasks, effective, context);
	return matched.map((t) => taskRow(counts, t));
}

export interface McpRelation {
	id: string;
	title: string;
}

/**
 * A task's full detail: the summary row plus resolved names (statuses, labels,
 * assignee, project/parent titles, relation targets), its description, and the
 * deep-link that opens it in the plugin.
 */
export function taskDetail(
	snapshot: WorkspaceSnapshot,
	task: Task,
	description: string,
	me: string | null = null,
): {
	task: McpTaskRow & {
		parentTitle?: string;
		projectTitle?: string;
		assigneeName?: string;
		statusName?: string;
		priorityName?: string;
		taskTypeName?: string;
		labelNames?: string[];
		relations: {
			blocks: McpRelation[];
			blockedBy: McpRelation[];
			related: McpRelation[];
			duplicateOf: McpRelation | null;
		};
		mentions?: string[];
		/** A ready-to-use `list_tasks` query for this task's sub-tasks, present
		 *  only when subTaskCount > 0 — so a client that just learned a count
		 *  from this response doesn't have to already know the query grammar
		 *  to actually fetch them. */
		subtasksQuery?: string;
		description?: string;
		recurrence?: {
			trigger: string;
			frequency: string;
			interval: number;
			nextDate: string;
		};
		vaultUri: string;
	};
} {
	const taxonomies = workspaceTaxonomies(snapshot.workspace);
	const titlesByPath = new Map<LinkTarget, string>();
	for (const p of snapshot.projects) titlesByPath.set(p.path, p.title);
	for (const t of snapshot.tasks) titlesByPath.set(t.path, t.id);

	const statusName = task.status
		? taxonomies.status.values.find((v) => v.id === task.status)?.name
		: undefined;
	const priorityName = task.priority
		? taxonomies.priority.values.find((v) => v.id === task.priority)?.name
		: undefined;
	const taskTypeName = task.taskType
		? taxonomies.taskType.values.find((v) => v.id === task.taskType)?.name
		: undefined;
	const labelNames = task.labels
		.map((id) => taxonomies.label.values.find((v) => v.id === id)?.name)
		.filter((name): name is string => Boolean(name));

	const resolveRelations = (paths: LinkTarget[]) =>
		paths.map((path) => ({
			id: path,
			title: titlesByPath.get(path) ?? path,
		}));

	const counts = countSubtasks(snapshot);
	const subTaskCount = counts.get(task.path) ?? 0;
	return {
		task: {
			...taskRowWithUri(counts, task),
			...(subTaskCount > 0 ? { subtasksQuery: `parent:${task.id}` } : {}),
			parentTitle: task.parent
				? titlesByPath.get(task.parent) ?? task.parent
				: undefined,
			projectTitle: task.project
				? titlesByPath.get(task.project) ?? task.project
				: undefined,
			assigneeName: task.assignee
				? snapshot.workspace.people.find((p) => p.id === task.assignee)?.name
				: undefined,
			statusName,
			priorityName,
			taskTypeName,
			...(labelNames.length > 0 ? { labelNames } : {}),
			relations: {
				blocks: resolveRelations(task.relations?.blocks ?? []),
				blockedBy: resolveRelations(task.relations?.blockedBy ?? []),
				related: resolveRelations(task.relations?.related ?? []),
				duplicateOf: task.relations?.duplicateOf
					? {
							id: task.relations.duplicateOf,
							title: titlesByPath.get(task.relations.duplicateOf) ??
								task.relations.duplicateOf,
						}
					: null,
			},
			...(task.mentions.length > 0 ? { mentions: task.mentions } : {}),
			...(description ? { description } : {}),
			...(task.recurrence
				? {
						recurrence: {
							trigger: task.recurrence.trigger,
							frequency: task.recurrence.freq,
							interval: task.recurrence.interval,
							nextDate: task.recurrence.nextDate,
						},
					}
				: {}),
		},
	};
}

/* ----------------------------------------------------------------- view ---- */

export interface McpViewRow {
	id: string;
	name: string;
	path: string;
	icon?: string;
	viewType: string;
	groupBy: string;
	sortBy: string;
	sortDirection: string;
	recurringPreview: boolean;
	vaultUri: string;
}

export function viewRow(root: string, view: SavedView): McpViewRow {
	return {
		id: view.id,
		name: view.name,
		path: view.path,
		icon: view.icon,
		viewType: view.viewType,
		groupBy: view.groupBy,
		sortBy: view.sortBy,
		sortDirection: view.sortDirection,
		recurringPreview: view.recurringPreview,
		vaultUri: buildVaultUri({ action: "open-view", viewId: view.id, root }),
	};
}

export interface McpViewDetail extends McpViewRow {
	description?: string;
	filters: ViewFilters;
	hiddenFields: string[];
	emptyColumnBehavior: string;
	subtaskDisplay: string;
	calendarDateField: string;
	tableSort: { field: string; direction: string }[];
}

export function viewDetail(root: string, view: SavedView): McpViewDetail {
	const row = viewRow(root, view);
	return {
		...row,
		description: view.description,
		...deserializeColumnState(view.columns),
		filters: view.filters,
		hiddenFields: view.hiddenFields,
		emptyColumnBehavior: view.emptyColumnBehavior,
		subtaskDisplay: view.subtaskDisplay,
		calendarDateField: view.calendarDateField,
		tableSort: view.tableSort.map((key) => ({
			field: key.field,
			direction: key.direction,
		})),
	};
}

/** View column chrome — `ViewColumnState` shorthand without the nesting. */
function deserializeColumnState(columns: SavedView["columns"]) {
	if (!columns?.collapsed && !columns?.hidden) return {};
	return {
		collapsedColumns: columns.collapsed,
		hiddenColumns: columns.hidden,
	};
}

/* ------------------------------------------------------------ dashboard ---- */

export interface McpDashboardRow {
	id: string;
	name: string;
	path: string;
	icon?: string;
	widgetCount: number;
	vaultUri: string;
}

export function dashboardRow(root: string, dashboard: DashboardConfig): McpDashboardRow {
	return {
		id: dashboard.id,
		name: dashboard.name,
		path: dashboard.path,
		icon: dashboard.icon,
		widgetCount: dashboard.widgets.length,
		vaultUri: buildVaultUri({ action: "open-view", viewId: dashboard.id, root }),
	};
}

export interface McpDashboardDetail extends McpDashboardRow {
	description?: string;
	filters: ViewFilters;
	widgets: { type: string; title?: string }[];
}

export function dashboardDetail(
	root: string,
	dashboard: DashboardConfig,
): McpDashboardDetail {
	const row = dashboardRow(root, dashboard);
	return {
		...row,
		description: dashboard.description,
		filters: dashboard.filters,
		widgets: dashboard.widgets.map((w) => ({
			type: w.chartType,
			...(w.title ? { title: w.title } : {}),
		})),
	};
}

/* -------------------------------------------------------------- taxonomy --- */

export interface McpLabelRow {
	id: string;
	name: string;
	color: string;
	description?: string;
	taskCount: number;
}

export function labelRows(snapshot: WorkspaceSnapshot): McpLabelRow[] {
	return snapshot.workspace.labels.map((label) => ({
		id: label.id,
		name: label.name,
		color: label.color,
		description: label.description,
		taskCount: snapshot.tasks.filter((t) => t.labels.includes(label.id)).length,
	}));
}

export function labelDetail(
	snapshot: WorkspaceSnapshot,
	labelId: string,
): { label: McpLabelRow } {
	const row = labelRows(snapshot).find((l) => l.id === labelId);
	if (!row) throw new Error(`label ${labelId} not found`);
	return { label: row };
}

/* ---------------------------------------------------------------- people --- */

export interface McpPersonRow {
	id: string;
	name: string;
	aliases: string[];
	openTaskCount: number;
	totalTaskCount: number;
}

export function personRows(snapshot: WorkspaceSnapshot): McpPersonRow[] {
	return snapshot.workspace.people.map((p) => {
		const assigned = snapshot.tasks.filter((t) => t.assignee === p.id);
		return {
			id: p.id,
			name: p.name,
			aliases: p.aliases ?? [],
			openTaskCount: assigned.filter((t) => !t.archived).length,
			totalTaskCount: assigned.length,
		};
	});
}

export function personDetail(
	snapshot: WorkspaceSnapshot,
	personId: string,
): { person: McpPersonRow | undefined } {
	return { person: personRows(snapshot).find((p) => p.id === personId) };
}

/* --------------------------------------------------------------- comments -- */

export interface McpCommentRow {
	id: string;
	author: string;
	date: string;
	editedAt: string | null;
	replyTo: string | null;
	body: string;
	reactions: Record<string, number>;
}

export function commentRows(comments: Comment[]): McpCommentRow[] {
	return comments.map((c) => ({
		id: c.id,
		author: c.author,
		date: c.date,
		editedAt: c.editedAt,
		replyTo: c.replyTo,
		body: c.body,
		reactions: c.reactions,
	}));
}