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

import { computeWidgetData, type WidgetData } from "../dashboards/aggregate";
import { formatProgress, projectProgress, scopeOf, subtaskProgress } from "../hierarchy";
import { describeRecurrence } from "../recurrence/describe";
import { projectRecurrences } from "../recurrence/project";
import { recurringOverview } from "../recurrence/overview";
import { isCanceled, isCompleted, isOpen, workspaceTaxonomies } from "../taxonomy";
import type {
	Comment,
	DashboardConfig,
	IsoDate,
	LinkTarget,
	Progress,
	Project,
	SavedView,
	StatusValue,
	Task,
	ViewFilters,
	WorkspaceSnapshot,
} from "../types";
import { relationCount } from "../types";
import { snapshotContext } from "../views/context";
import { evaluateView } from "../views/evaluate";
import { applyFilters } from "../views/filter";
import { sortTasks, sortTasksMulti } from "../views/sort";
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

/** Progress rollup, serialized for the detail payloads. */
export interface McpProgress extends Progress {
	/** Compact form, e.g. `"6/10"` — completed against the non-canceled total. */
	text: string;
}

function mcpProgress(progress: Progress): McpProgress {
	return { ...progress, text: formatProgress(progress) };
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
	project: McpProjectRow & {
		description?: string;
		/** Top-level task rollup — see `projectProgress` (sub-tasks counted in
		 *  their own parent's bar, archived tasks excluded). */
		progress: McpProgress;
	};
} {
	const counts = countTasksByProject(snapshot);
	const row = projectRow(snapshot, project, counts);
	const taxonomies = workspaceTaxonomies(snapshot.workspace);
	const rollup = mcpProgress(
		projectProgress(scopeOf(snapshot), project.path, taxonomies.status),
	);
	return {
		project: {
			...row,
			progress: rollup,
			...(description ? { description } : {}),
		},
	};
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
	archivedAt: string | null;
	completedAt: string | null;
	subTaskCount: number;
	relationCount: number;
	commentCount: number;
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
		archivedAt: task.archivedAt,
		completedAt: task.completedAt,
		subTaskCount: subtaskCounts.get(task.path) ?? 0,
		relationCount: relationCount(task),
		commentCount: task.commentCount ?? 0,
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
			action: "open-task",
			path: task.path,
			target: "vf",
		}),
	};
}

/** Optional ordering for `taskRows`, mirroring a Saved View's sort clauses.
 *  Omitted entirely (or `sortBy: "rank"`), tasks stay in rank order — the same
 *  result the List view shows by default. */
export interface McpTaskSort {
	sortBy?: import("../types").SortField;
	sortDirection?: import("../types").SortDirection;
	tableSort?: import("../types").TableSortKey[];
	/** Honor the `show:recurring` clause: merge projected future occurrences
	 *  in (requires `today`). */
	recurringPreview?: boolean;
	today?: import("../types").IsoDate;
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
	sort: McpTaskSort = {},
): McpTaskRow[] {
	const context = snapshotContext(snapshot, me);
	const effective = showArchived
		? { ...filters, archived: "included" as const }
		: filters;
	let matched = applyFilters(snapshot.tasks, effective, context);

	if (sort.recurringPreview && sort.today) {
		matched = [...matched, ...projectRecurrences(snapshot, matched, sort.today)];
	}

	if (sort.tableSort && sort.tableSort.length > 0) {
		matched = sortTasksMulti(matched, sort.tableSort, context);
	} else if (sort.sortBy && sort.sortBy !== "rank") {
		matched = sortTasks(matched, sort.sortBy, sort.sortDirection ?? "asc", context);
	} else if (sort.sortDirection === "desc") {
		// Explicit descending rank — the only "rank" call that changes output.
		matched = sortTasks(matched, "rank", "desc", context);
	}

	const counts = countSubtasks(snapshot);
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
		/** Direct sub-task completion rollup — see `subtaskProgress`. Empty for
		 *  a leaf task (`total: 0`), which is meaningfully different from 0%. */
		subtaskProgress: McpProgress;
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
	const rollup = mcpProgress(
		subtaskProgress(scopeOf(snapshot), task, taxonomies.status),
	);
	return {
		task: {
			...taskRowWithUri(counts, task),
			subtaskProgress: rollup,
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

/* ------------------------------------------- counts, summary and stats ---- */

/** One bucket of a count breakdown. */
export interface McpNameCount {
	id: string;
	/** True when this is the "(none)" bucket — no value set, not an entity id. */
	isNone?: boolean;
	name: string;
	count: number;
}

export interface McpCounts {
	/** Tasks the filter matched (before the 200-row list cap — counts are uncapped). */
	total: number;
	/** The matched tasks that are neither completed nor canceled, ignoring archived. */
	open: number;
	/** Archived tasks pulled in by `showArchived` (0 when it wasn't set). */
	archived: number;
	byStatus?: McpNameCount[];
	byPriority?: McpNameCount[];
	byTaskType?: McpNameCount[];
	byLabel?: McpNameCount[];
	byAssignee?: McpNameCount[];
	byProject?: McpNameCount[];
}

export type McpCountBy =
	| "status"
	| "priority"
	| "taskType"
	| "label"
	| "assignee"
	| "project";

function aggregateByName(
	tasks: Task[],
	keyOf: (t: Task) => string | null,
	nameOf: (key: string | null) => string,
): McpNameCount[] {
	const tallies = new Map<string | null, number>();
	for (const task of tasks) {
		const key = keyOf(task);
		tallies.set(key, (tallies.get(key) ?? 0) + 1);
	}
	return [...tallies.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] ?? "").localeCompare(b[0] ?? ""))
		.map(([key, count]) => ({
			id: key ?? "",
			isNone: key == null,
			name: nameOf(key),
			count,
		}));
}

/** The full count surface behind `count_tasks` — a pure sibling of `taskRows`. */
export function countTasks(
	snapshot: WorkspaceSnapshot,
	filters: ViewFilters = {},
	me: string | null = null,
	showArchived = false,
	by: McpCountBy[] = [],
): McpCounts {
	const context = snapshotContext(snapshot, me);
	const effective = showArchived
		? { ...filters, archived: "included" as const }
		: filters;
	const matched = applyFilters(snapshot.tasks, effective, context);
	const visible = matched.filter((t) => !t.archived);
	const statuses = workspaceTaxonomies(snapshot.workspace).status;

	const out: McpCounts = {
		total: matched.length,
		open: visible.filter((t) => isOpen(statuses, t.status)).length,
		archived: matched.filter((t) => t.archived).length,
	};

	const taxonomies = workspaceTaxonomies(snapshot.workspace);
	const taxonomyNames = (field: "status" | "priority" | "taskType") =>
		new Map(taxonomies[field].values.map((v) => [v.id, v.name]));
	const labelNames = new Map(
		snapshot.workspace.labels.map((l) => [l.id, l.name]),
	);
	const projectTitles = new Map(snapshot.projects.map((p) => [p.path, p.title]));
	const nameOf = (names: Map<string, string>) => (key: string | null) =>
		key != null ? (names.get(key) ?? key) : "(none)";

	const add = (field: McpCountBy, keyOf: (t: Task) => string | null, names: Map<string, string>) => {
		const key = `by${field[0].toUpperCase()}${field.slice(1)}` as keyof McpCounts;
		(out[key] as McpNameCount[]) = aggregateByName(
			matched,
			keyOf,
			nameOf(names),
		);
	};

	for (const field of by) {
		switch (field) {
			case "status":
				add("status", (t) => t.status, taxonomyNames("status"));
				break;
			case "priority":
				add("priority", (t) => t.priority, taxonomyNames("priority"));
				break;
			case "taskType":
				add("taskType", (t) => t.taskType, taxonomyNames("taskType"));
				break;
			case "label": {
				// Labels are multi-valued — a task counts under every label it
				// carries, and a task with none lands in the `(none)` bucket.
				const tally = new Map<string | null, number>();
				for (const t of matched) {
					if (t.labels.length === 0) {
						tally.set(null, (tally.get(null) ?? 0) + 1);
					} else {
						for (const id of t.labels) {
							tally.set(id, (tally.get(id) ?? 0) + 1);
						}
					}
				}
				out.byLabel = [...tally.entries()]
					.sort((a, b) => b[1] - a[1])
					.map(([key, count]) => ({
						id: key ?? "",
						isNone: key == null,
						name: nameOf(labelNames)(key),
						count,
					}));
				break;
			}
			case "assignee":
				{
					const personNames = new Map(
						snapshot.workspace.people.map((p) => [p.id, p.name]),
					);
					add("assignee", (t) => t.assignee, personNames);
				}
				break;
			case "project":
				add("project", (t) => t.project, projectTitles);
				break;
		}
	}
	return out;
}

export interface McpProjectCounts {
	total: number;
	archived: number;
	byStatus?: McpNameCount[];
}

/** `count_projects` — a status breakdown by the shared status taxonomy. */
export function countProjects(
	snapshot: WorkspaceSnapshot,
	showArchived = false,
	byStatus = false,
): McpProjectCounts {
	const included = showArchived
		? snapshot.projects
		: snapshot.projects.filter((p) => !p.archived);
	const out: McpProjectCounts = {
		total: included.length,
		archived: snapshot.projects.filter((p) => p.archived).length,
	};
	if (byStatus) {
		const statuses = workspaceTaxonomies(snapshot.workspace).status;
		const names = new Map(statuses.values.map((v) => [v.id, v.name]));
		const tally = new Map<string | null, number>();
		for (const project of included) {
			tally.set(project.status, (tally.get(project.status) ?? 0) + 1);
		}
		out.byStatus = [...tally.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([key, count]) => ({
				id: key ?? "",
				isNone: key == null,
				name: key != null ? (names.get(key) ?? key) : "(none)",
				count,
			}));
	}
	return out;
}

/** The works-spanning picture one `get_summary` call should answer at a glance. */
export interface McpSummary {
	tasks: {
		total: number;
		open: number;
		completed: number;
		canceled: number;
		archived: number;
		subtasks: number;
		overdue: number;
		dueToday: number;
	};
	projects: { total: number; open: number; archived: number };
	people: number;
	labels: number;
	views: number;
	dashboards: number;
	recurring: { seriesCount: number };
}

export function getSummary(
	snapshot: WorkspaceSnapshot,
	today: IsoDate,
): McpSummary {
	const statuses = workspaceTaxonomies(snapshot.workspace).status;
	const tasks = snapshot.tasks.filter((t) => !t.archived);

	let completed = 0;
	let canceled = 0;
	let overdue = 0;
	let dueToday = 0;
	for (const task of tasks) {
		const category = task.status ? isCompleted(statuses, task.status) : false;
		if (isCanceled(statuses, task.status)) canceled++;
		else if (category) completed++;
		if (isOpen(statuses, task.status)) {
			if (task.dueDate && task.dueDate < today) overdue++;
			if (task.dueDate === today) dueToday++;
		}
	}

	return {
		tasks: {
			total: tasks.length,
			open: tasks.filter((t) => isOpen(statuses, t.status)).length,
			completed,
			canceled,
			archived: snapshot.tasks.filter((t) => t.archived).length,
			subtasks: tasks.filter((t) => t.parent != null).length,
			overdue,
			dueToday,
		},
		projects: {
			total: snapshot.projects.filter((p) => !p.archived).length,
			open: snapshot.projects.filter(
				(p) => !p.archived && isOpen(statuses, p.status),
			).length,
			archived: snapshot.projects.filter((p) => p.archived).length,
		},
		people: snapshot.workspace.people.length,
		labels: snapshot.workspace.labels.length,
		views: snapshot.views.length,
		dashboards: snapshot.dashboards.length,
		recurring: { seriesCount: recurringOverview(snapshot, today).length },
	};
}

export interface McpTaskStats {
	total: number;
	open: number;
	completed: number;
	canceled: number;
	archived: number;
	withDueDate: number;
	estimated: number;
	estimateSum: number;
	estimateAvg: number;
	withComments: number;
	overdue: number;
	dueToday: number;
	newest: { id: string; title: string; createdAt: IsoDate } | null;
	oldest: { id: string; title: string; createdAt: IsoDate } | null;
	mostCommented: { id: string; title: string; commentCount: number }[];
}

export interface McpStats {
	tasks: McpTaskStats;
	comments: {
		total: number;
		perAuthor: McpNameCount[];
	};
	subtaskProgress: { total: number; completed: number; percent: number };
}

/**
 * Workspace stats for a fully-loaded snapshot. `commentTally` is the
 * per-author tally across every task's body, injected from the index's cache
 * (the pure module can't read bodies); everything else is derived in-core.
 */
export function getStats(
	snapshot: WorkspaceSnapshot,
	today: IsoDate,
	commentTally: Record<string, number> = {},
): McpStats {
	const statuses = workspaceTaxonomies(snapshot.workspace).status;
	const tasks = snapshot.tasks.filter((t) => !t.archived);

	let completed = 0;
	let canceled = 0;
	let overdue = 0;
	let dueToday = 0;
	let withComments = 0;
	let estimateSum = 0;
	let estimated = 0;
	for (const task of tasks) {
		if (isCompleted(statuses, task.status)) completed++;
		else if (isCanceled(statuses, task.status)) canceled++;
		if (isOpen(statuses, task.status)) {
			if (task.dueDate && task.dueDate < today) overdue++;
			if (task.dueDate === today) dueToday++;
		}
		if ((task.commentCount ?? 0) > 0) withComments++;
		if (task.estimate != null) {
			estimated++;
			estimateSum += task.estimate;
		}
	}

	const byCreated = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const newest = byCreated[byCreated.length - 1] ?? null;
	const oldest = byCreated[0] ?? null;

	const mostCommented = [...tasks]
		.sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0))
		.slice(0, 5)
		.filter((t) => (t.commentCount ?? 0) > 0)
		.map((t) => ({
			id: t.id,
			title: t.title,
			commentCount: t.commentCount ?? 0,
		}));

	const personNames = new Map(
		snapshot.workspace.people.map((p) => [p.id, p.name]),
	);
	const perAuthor = Object.entries(commentTally)
		.map(([id, count]) => ({
			id,
			name: personNames.get(id) ?? id,
			count,
		}))
		.sort((a, b) => b.count - a.count);

	const completedCount = tasks.filter((t) => t.parent == null);
	return {
		tasks: {
			total: tasks.length,
			open: tasks.filter((t) => isOpen(statuses, t.status)).length,
			completed,
			canceled,
			archived: snapshot.tasks.filter((t) => t.archived).length,
			withDueDate: tasks.filter((t) => t.dueDate != null).length,
			estimated,
			estimateSum,
			estimateAvg: estimated > 0 ? estimateSum / estimated : 0,
			withComments,
			overdue,
			dueToday,
			newest: newest
				? { id: newest.id, title: newest.title, createdAt: newest.createdAt }
				: null,
			oldest: oldest
				? { id: oldest.id, title: oldest.title, createdAt: oldest.createdAt }
				: null,
			mostCommented,
		},
		comments: {
			total: Object.values(commentTally).reduce((a, b) => a + b, 0),
			perAuthor,
		},
		subtaskProgress: {
			total: completedCount.length,
			completed: completedCount.filter((t) =>
				isCompleted(statuses, t.status),
			).length,
			percent:
				completedCount.length > 0
					? Math.round(
							(completedCount.filter((t) =>
								isCompleted(statuses, t.status),
							).length /
								completedCount.length) *
								100,
						)
					: 0,
		},
	};
}

/* -------------------------------------------------------------- recurring --- */

export interface McpRecurringRow {
	taskId: string;
	title: string;
	path: string;
	trigger: "on-date" | "on-close";
	frequency: string;
	interval: number;
	nextDate: IsoDate | null;
	chainLength: number;
	/** Human one-liner, e.g. "every week, starts today (on close)". */
	summary: string;
	vaultUri: string;
}

export interface McpRecurringList {
	seriesCount: number;
	results: McpRecurringRow[];
}

/** Every live recurrence series in a workspace, one row each. */
export function recurringRows(
	snapshot: WorkspaceSnapshot,
	today: IsoDate,
	statuses?: readonly StatusValue[],
): McpRecurringList {
	const taxonomies = workspaceTaxonomies(snapshot.workspace);
	const rows = recurringOverview(snapshot, today).map((row) => ({
		taskId: row.task.id,
		title: row.task.title,
		path: row.task.path,
		trigger: row.recurrence.trigger,
		frequency: row.recurrence.freq,
		interval: row.recurrence.interval,
		nextDate: row.nextDate,
		chainLength: row.chainLength,
		summary: describeRecurrence(
			row.recurrence,
			statuses ?? taxonomies.status.values,
		),
		vaultUri: buildVaultUri({
			action: "open-task",
			path: row.task.path,
			target: "vf",
		}),
	}));
	return { seriesCount: rows.length, results: rows };
}

/* -------------------------------------------------------------- run_view --- */

export interface McpGroupedTasks {
	key: string;
	label: string;
	results: McpTaskRow[];
	total: number;
	truncated: boolean;
}

export interface McpRunView {
	viewId: string;
	name: string;
	viewType: string;
	/** How many tasks the view's filters matched, never capped. */
	total: number;
	/** How many of the workspace's tasks the filters excluded. */
	filteredOut: number;
	results: McpTaskRow[];
	truncated: boolean;
	groups?: McpGroupedTasks[];
}

/**
 * Evaluate a real Saved View against a snapshot — verified against the plugin's
 * own `evaluateView` (same filter/sort/group engine), so "what does this view
 * show?" has one authoritative answer. `today` enables the `show:recurring`
 * projection when the view has `recurringPreview` on. Rows are capped like
 * `list_tasks` (see `total`/`truncated`); `total`/`filteredOut` stay uncapped.
 */
export function runView(
	snapshot: WorkspaceSnapshot,
	view: SavedView,
	me: string | null = null,
	today?: IsoDate,
	withGroups = false,
): McpRunView {
	const context = snapshotContext(snapshot, me);
	const evaluated = evaluateView(snapshot, view, context, today);
	const counts = countSubtasks(snapshot);
	const rows = evaluated.tasks.map((t) => taskRow(counts, t));
	return {
		viewId: view.id,
		name: view.name,
		viewType: view.viewType,
		filteredOut: evaluated.filteredOut,
		// `pageList` carries `total` = the full matched list, uncapped by the
		// row slice — same number as `evaluated.total`.
		...pageList(rows),
		...(withGroups
			? {
					groups: evaluated.groups.map((group) => ({
						key: group.key,
						label: group.label,
						...pageList(group.tasks.map((t) => taskRow(counts, t))),
					})),
				}
			: {}),
	};
}

/* ------------------------------------------------------------ dashboards --- */

export interface McpDashboardDataRow {
	id: string;
	chartType: string;
	title: string;
	data: WidgetData;
}

export interface McpDashboardData {
	dashboard: McpDashboardRow;
	/** How many tasks the dashboard-wide filter matched. */
	total: number;
	widgets: McpDashboardDataRow[];
}

/**
 * The chart-ready data behind every widget — the same `computeWidgetData` the
 * Dashboard view renders, so a model can read actual numbers ("the bar chart
 * split by status") rather than just the widget's config.
 */
export function readDashboard(
	snapshot: WorkspaceSnapshot,
	dashboard: DashboardConfig,
	me: string | null = null,
): McpDashboardData {
	const context = snapshotContext(snapshot, me);
	const tasks = applyFilters(snapshot.tasks, dashboard.filters, context);
	return {
		dashboard: dashboardRow(snapshot.workspace.root, dashboard),
		total: tasks.length,
		widgets: dashboard.widgets.map((widget) => ({
			id: widget.id,
			chartType: widget.chartType,
			title: widget.title,
			data: computeWidgetData(widget, tasks, context),
		})),
	};
}