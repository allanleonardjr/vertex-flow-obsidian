/**
 * `ParsedTemplate` + `TemplateBuildContext` → `TemplateContent`.
 *
 * The parser deals in symbols — anchors, taxonomy *names*, day offsets. This
 * file turns them into the same concrete shape `buildExampleContent()` returns
 * for a hand-written TypeScript template, so nothing downstream
 * (`instantiateTemplate`, the gallery, the snapshot fixtures) can tell the two
 * authoring styles apart.
 *
 * Object construction goes through `helpers.ts` rather than being rebuilt here:
 * a markdown template and a TS template must produce byte-identical defaults
 * for every field neither of them mentions, and the only way to guarantee that
 * is to share the constructors.
 *
 * Order matters, and it is the reason this is a separate pass from parsing:
 * taxonomy and people first, then projects, then tasks (so relations and
 * `deriveMentions` have every path available), and only then the view `query:`
 * and dashboard `filter:` strings — those resolve names against the *finished*
 * workspace, so they cannot run any earlier.
 */

import { slugify } from "../../ids";
import { joinPath } from "../../links";
import { queryContext, type QueryContext } from "../../query/context";
import { parseQuery } from "../../query/parse";
import { lex } from "../../query/lex";
import { createWorkspaceConfig } from "../../serialization/workspace";
import {
	DEFAULT_LABELS,
	DEFAULT_PRIORITIES,
	DEFAULT_STATUSES,
	DEFAULT_TASK_TYPES,
} from "../../taxonomy/defaults";
import type {
	Comment,
	DashboardConfig,
	DashboardFieldMapping,
	DashboardWidget,
	IsoDate,
	LinkTarget,
	Person,
	Project,
	SavedView,
	TaxonomyValue,
	Task,
	TaskRelations,
	ViewFilters,
	WorkspaceConfig,
} from "../../types";
import {
	makeDashboard,
	makeProject,
	makeTask,
	makeView,
	makeWidget,
	rankSeq,
} from "../helpers";
import type { TemplateBuildContext, TemplateContent } from "../types";
import {
	TemplateParseError,
	type ParsedDashboard,
	type ParsedDate,
	type ParsedTask,
	type ParsedTemplate,
	type ParsedView,
	type ParsedWidget,
} from "./types";

function fail(message: string, line?: number): never {
	throw new TemplateParseError(message, line);
}

/* --------------------------------------------------------- name lookup ---- */

function looseKey(input: string): string {
	return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve a written reference to a taxonomy value id.
 *
 * Three passes, narrowing: exact name, then exact id, then the punctuation- and
 * case-insensitive key. The last one is what lets `status: todo` and
 * `status: in-progress` reach values named "To Do" and "In Progress" — authors
 * write the shape they see in frontmatter elsewhere in the vault, and the
 * format shouldn't make them guess which spelling this particular field wants.
 */
function makeResolver(
	kind: string,
	values: readonly TaxonomyValue[],
): (raw: string, line: number) => string {
	const byName = new Map<string, string>();
	const byId = new Map<string, string>();
	const byLoose = new Map<string, string>();
	for (const value of values) {
		byName.set(value.name.toLowerCase(), value.id);
		byId.set(value.id.toLowerCase(), value.id);
		if (!byLoose.has(looseKey(value.name))) byLoose.set(looseKey(value.name), value.id);
		if (!byLoose.has(looseKey(value.id))) byLoose.set(looseKey(value.id), value.id);
	}

	return (raw: string, line: number) => {
		const value = raw.trim();
		const hit =
			byName.get(value.toLowerCase()) ??
			byId.get(value.toLowerCase()) ??
			byLoose.get(looseKey(value));
		if (!hit) {
			fail(
				`Unknown ${kind} "${value}" — this template defines ${
					values.length > 0
						? values.map((v) => `"${v.name}"`).join(", ")
						: "no " + kind + " values"
				}`,
				line,
			);
		}
		return hit;
	};
}

function makePersonResolver(
	people: readonly Person[],
): (raw: string, line: number) => string {
	const index = new Map<string, string>();
	for (const person of people) {
		index.set(looseKey(person.name), person.id);
		index.set(looseKey(person.id), person.id);
		for (const alias of person.aliases ?? []) index.set(looseKey(alias), person.id);
	}
	return (raw: string, line: number) => {
		const hit = index.get(looseKey(raw));
		if (!hit) {
			fail(
				`Unknown person "${raw.trim()}" — add them to the template's "people" list`,
				line,
			);
		}
		return hit;
	};
}

/* --------------------------------------------------------------- dates ---- */

function resolveDateTime(
	date: ParsedDate,
	ctx: TemplateBuildContext,
): IsoDate {
	return date.kind === "relative" ? ctx.iso(date.days) : date.iso;
}

/** Date-only fields (`startDate`/`dueDate`) store `YYYY-MM-DD`, matching what
 *  every hand-written template and the task editor produce. */
function resolveDay(date: ParsedDate, ctx: TemplateBuildContext): IsoDate {
	return date.kind === "relative" ? ctx.day(date.days) : date.iso.slice(0, 10);
}

function resolveArchived(
	archived: ParsedDate | boolean | undefined,
	ctx: TemplateBuildContext,
): { archived: boolean; archivedAt: IsoDate | null } {
	if (archived === undefined || archived === false) {
		return { archived: false, archivedAt: null };
	}
	if (archived === true) return { archived: true, archivedAt: ctx.iso(0) };
	return { archived: true, archivedAt: resolveDateTime(archived, ctx) };
}

/* ------------------------------------------------------ query validation -- */

/** Clause tokens a dashboard `filter:` may not carry — they configure a *view*,
 *  and a dashboard has no layout to configure. */
const NON_FILTER_CLAUSES = new Set([
	"view",
	"layout",
	"group",
	"sort",
	"hide",
	"date",
	"subtasks",
	"empty",
]);

function definitionFromQuery(
	query: string,
	context: QueryContext,
	where: string,
): ReturnType<typeof parseQuery>["definition"] {
	const result = parseQuery(query, context);
	if (!result.ok) {
		const errors = result.issues
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.message);
		fail(`${where} — query "${query}" is invalid: ${errors.join("; ")}`);
	}
	return result.definition;
}

function filtersFromQuery(
	query: string,
	context: QueryContext,
	where: string,
): ViewFilters {
	const offending = lex(query)
		.tokens.filter(
			(token) => token.kind === "clause" && NON_FILTER_CLAUSES.has(token.field),
		)
		.map((token) => (token.kind === "clause" ? `${token.field}:` : ""));

	if (offending.length > 0) {
		fail(
			`${where} — a dashboard filter can only narrow which tasks are counted, but "${query}" uses ${[
				...new Set(offending),
			].join(", ")}`,
		);
	}

	return definitionFromQuery(query, context, where).filters;
}

/* ------------------------------------------------------------ dashboards -- */

/** Row height. `kpi` widgets are a single big number and get the shorter box
 *  every hand-written template already gives them; everything else is a chart
 *  and takes the standard height. */
function widgetHeight(chartType: ParsedWidget["chartType"]): number {
	return chartType === "kpi" ? 3 : 4;
}

const GRID_COLUMNS = 12;

/**
 * Widths for one row, from the widgets' weights.
 *
 * A single-widget row always spans the grid regardless of weight. Otherwise
 * each widget takes `round(12 * weight / total)`, and the last one absorbs the
 * rounding remainder so a row always sums to exactly 12 — a row summing to 11
 * would leave a visible gap and one summing to 13 would wrap the last widget.
 */
function rowWidths(widgets: ParsedWidget[]): number[] {
	if (widgets.length === 1) return [GRID_COLUMNS];

	const total = widgets.reduce((sum, w) => sum + (w.weight ?? 1), 0);
	const widths = widgets.map((w) =>
		Math.max(1, Math.round((GRID_COLUMNS * (w.weight ?? 1)) / total)),
	);

	let used = widths.slice(0, -1).reduce((sum, w) => sum + w, 0);
	// Leave at least one column for the final widget even if rounding was unkind.
	if (used >= GRID_COLUMNS) {
		used = GRID_COLUMNS - 1;
		let excess = widths.slice(0, -1).reduce((sum, w) => sum + w, 0) - used;
		for (let i = widths.length - 2; i >= 0 && excess > 0; i -= 1) {
			const take = Math.min(excess, widths[i] - 1);
			widths[i] -= take;
			excess -= take;
		}
	}
	widths[widths.length - 1] = GRID_COLUMNS - used;
	return widths;
}

function fieldMappingFor(
	widget: ParsedWidget,
	resolveScope: (field: string, value: string, line: number) => string,
): DashboardFieldMapping {
	switch (widget.chartType) {
		case "bar":
			return { chartType: "bar", groupBy: widget.groupBy! };
		case "pie":
			return { chartType: "pie", groupBy: widget.groupBy! };
		case "line":
			return {
				chartType: "line",
				xField: widget.xField!,
				bucket: widget.bucket!,
				groupBy: widget.groupBy ?? null,
			};
		case "timeline":
			return {
				chartType: "timeline",
				xField: widget.xField!,
				bucket: widget.bucket!,
				groupBy: widget.groupBy ?? null,
			};
		case "kpi":
			return {
				chartType: "kpi",
				metric: widget.metric!,
				scope: widget.scope
					? {
							field: widget.scope.field,
							value: resolveScope(
								widget.scope.field,
								widget.scope.value,
								widget.line,
							),
						}
					: null,
			};
	}
}

/* --------------------------------------------------------------- entry ---- */

export function resolveTemplateContent(
	parsed: ParsedTemplate,
	ctx: TemplateBuildContext,
): TemplateContent {
	const overrides = parsed.workspaceOverrides;
	const statuses = overrides.statuses ?? DEFAULT_STATUSES;
	const priorities = overrides.priorities ?? DEFAULT_PRIORITIES;
	const taskTypes = overrides.taskTypes ?? DEFAULT_TASK_TYPES;
	const labels = overrides.labels ?? DEFAULT_LABELS;
	const people = overrides.people ?? [];

	const resolveStatus = makeResolver("status", statuses);
	const resolvePriority = makeResolver("priority", priorities);
	const resolveTaskType = makeResolver("task type", taskTypes);
	const resolveLabel = makeResolver("label", labels);
	const resolvePerson = makePersonResolver(people);

	// --- anchors → paths ---------------------------------------------------
	// Both maps are built before a single entity is constructed, because a task
	// can name a task that appears later in the file (and often does — `blocks:`
	// points forward as readily as back).

	const projectPath = new Map<string, LinkTarget>();
	const projectPathByTitle = new Map<string, LinkTarget>();
	for (const project of parsed.projects) {
		const path = joinPath(ctx.root, "Projects", project.title);
		projectPath.set(project.anchor, path);
		const titleKey = project.title.toLowerCase();
		if (projectPathByTitle.has(titleKey)) {
			fail(
				`Two Projects are both titled "${project.title}" — Project titles are their filenames, so they must be unique`,
				project.line,
			);
		}
		projectPathByTitle.set(titleKey, path);
	}

	const taskPath = new Map<string, LinkTarget>();
	parsed.tasks.forEach((task, index) => {
		taskPath.set(task.anchor, ctx.taskPath(index + 1));
	});

	const anchorPath = new Map<string, LinkTarget>([...projectPath, ...taskPath]);

	function resolveAnchor(
		field: string,
		value: string,
		line: number,
	): LinkTarget {
		const hit = anchorPath.get(value.trim());
		if (!hit) {
			fail(
				`"${field}: ${value.trim()}" does not name any Project or Task in this template`,
				line,
			);
		}
		return hit;
	}

	function resolveProjectRef(value: string, line: number): LinkTarget {
		const key = value.trim();
		return (
			projectPath.get(key) ??
			projectPathByTitle.get(key.toLowerCase()) ??
			fail(
				`"project: ${key}" does not name any Project in this template — use the Project's title or its {#anchor}`,
				line,
			)
		);
	}

	// --- projects ------------------------------------------------------------

	const projectDescriptions = new Map<string, string>();
	const projects: Project[] = parsed.projects.map((parsedProject) => {
		const archived = resolveArchived(parsedProject.archived, ctx);
		const project = makeProject(ctx, parsedProject.title, {
			status: parsedProject.status
				? resolveStatus(parsedProject.status, parsedProject.line)
				: statuses[0].id,
			priority: parsedProject.priority
				? resolvePriority(parsedProject.priority, parsedProject.line)
				: null,
			owner: parsedProject.owner
				? resolvePerson(parsedProject.owner, parsedProject.line)
				: null,
			labels: (parsedProject.labels ?? []).map((l) =>
				resolveLabel(l, parsedProject.line),
			),
			startDate: parsedProject.start ? resolveDay(parsedProject.start, ctx) : null,
			dueDate: parsedProject.due ? resolveDay(parsedProject.due, ctx) : null,
			createdAt: parsedProject.created
				? resolveDateTime(parsedProject.created, ctx)
				: ctx.iso(-30),
			updatedAt: parsedProject.updated
				? resolveDateTime(parsedProject.updated, ctx)
				: ctx.iso(-1),
			...archived,
		});
		if (parsedProject.description) {
			projectDescriptions.set(project.path, `${parsedProject.description}\n`);
		}
		return project;
	});

	// --- tasks ---------------------------------------------------------------

	const byAnchor = new Map<string, ParsedTask>();
	for (const task of parsed.tasks) byAnchor.set(task.anchor, task);

	/** A sub-task with no `project:` of its own belongs to whichever Project its
	 *  nearest ancestor belongs to — stated once at the top of a hierarchy
	 *  rather than repeated on every child. */
	function inheritedProject(task: ParsedTask): string | undefined {
		let current: ParsedTask | undefined = task;
		const seen = new Set<string>();
		while (current) {
			if (current.project) return current.project;
			if (seen.has(current.anchor)) break;
			seen.add(current.anchor);
			const parentAnchor: string | null =
				current.parent ?? current.headingParent;
			current = parentAnchor ? byAnchor.get(parentAnchor) : undefined;
		}
		return undefined;
	}

	const rank = rankSeq(parsed.tasks.length);
	const comments = new Map<string, Comment[]>();
	const descriptions = new Map<string, string>();

	const tasks: Task[] = parsed.tasks.map((parsedTask, index) => {
		const line = parsedTask.line;
		const archived = resolveArchived(parsedTask.archived, ctx);
		const projectRef = inheritedProject(parsedTask);
		const parentAnchor = parsedTask.parent ?? parsedTask.headingParent;

		const task = makeTask(ctx, index + 1, rank, {
			title: parsedTask.title,
			taskType: parsedTask.type ? resolveTaskType(parsedTask.type, line) : null,
			status: parsedTask.status
				? resolveStatus(parsedTask.status, line)
				: statuses[0].id,
			priority: parsedTask.priority
				? resolvePriority(parsedTask.priority, line)
				: null,
			project: projectRef ? resolveProjectRef(projectRef, line) : null,
			parent: parentAnchor ? resolveAnchor("parent", parentAnchor, line) : null,
			assignee: parsedTask.assignee
				? resolvePerson(parsedTask.assignee, line)
				: null,
			estimate: parsedTask.estimate ?? null,
			labels: (parsedTask.labels ?? []).map((l) => resolveLabel(l, line)),
			startDate: parsedTask.start ? resolveDay(parsedTask.start, ctx) : null,
			dueDate: parsedTask.due ? resolveDay(parsedTask.due, ctx) : null,
			createdAt: parsedTask.created
				? resolveDateTime(parsedTask.created, ctx)
				: ctx.iso(-10),
			updatedAt: parsedTask.updated
				? resolveDateTime(parsedTask.updated, ctx)
				: ctx.iso(-1),
			...archived,
			relations: {
				blocks: (parsedTask.blocks ?? []).map((a) => resolveAnchor("blocks", a, line)),
				blockedBy: (parsedTask.blockedBy ?? []).map((a) =>
					resolveAnchor("blockedBy", a, line),
				),
				related: (parsedTask.related ?? []).map((a) =>
					resolveAnchor("related", a, line),
				),
				duplicateOf: parsedTask.duplicateOf
					? resolveAnchor("duplicateOf", parsedTask.duplicateOf, line)
					: null,
			},
		});

		if (parsedTask.description) {
			descriptions.set(task.path, `${parsedTask.description}\n`);
		}
		if (parsedTask.comments.length > 0) {
			comments.set(
				task.path,
				parsedTask.comments.map((comment, n) => ({
					id: `cmt_${String(n + 1).padStart(2, "0")}`,
					author: resolvePerson(comment.author, comment.line),
					date: resolveDateTime(comment.date, ctx),
					body: comment.body,
					// Reactions aren't part of the template format — nothing authors
					// them and nothing in the app would round-trip them from here.
					reactions: {},
				})),
			);
		}

		return task;
	});

	syncBlockRelations(parsed, tasks, taskPath);

	// --- views and dashboards ------------------------------------------------
	// Built last: their `query:` / `filter:` strings name statuses, labels,
	// people and projects, so they need the finished taxonomy and entity set.

	const workspace: WorkspaceConfig = createWorkspaceConfig(
		"Template",
		ctx.idPrefix,
		ctx.root,
	);
	if (overrides.statuses) workspace.statuses = overrides.statuses.map((v) => ({ ...v }));
	if (overrides.priorities)
		workspace.priorities = overrides.priorities.map((v) => ({ ...v }));
	if (overrides.taskTypes)
		workspace.taskTypes = overrides.taskTypes.map((v) => ({ ...v }));
	if (overrides.labels) workspace.labels = overrides.labels.map((v) => ({ ...v }));
	if (overrides.people) workspace.people = overrides.people.map((v) => ({ ...v }));

	const context = queryContext({
		workspace,
		tasks,
		projects,
		views: [],
		dashboards: [],
		trash: [],
	});

	const views = resolveViews(parsed.views, context);
	const dashboards = resolveDashboards(parsed.dashboards, context, {
		resolveStatus,
		resolvePriority,
		resolveTaskType,
		resolveLabel,
		resolvePerson,
		resolveProjectRef,
	});

	return {
		workspace: overrides,
		views,
		dashboards: dashboards.length > 0 ? dashboards : undefined,
		projects,
		tasks,
		comments: comments.size > 0 ? comments : undefined,
		descriptions: descriptions.size > 0 ? descriptions : undefined,
		projectDescriptions:
			projectDescriptions.size > 0 ? projectDescriptions : undefined,
	};
}

/* -------------------------------------------------------- relation sync --- */

/**
 * `blocks` and `blockedBy` are two views of one edge, but a template author
 * writes whichever reads better at that point in the file. So: declare either
 * side and the other is synthesized; declare both and they must agree.
 *
 * "Agree" is deliberately asymmetric about absence — `A blocks B` is satisfied
 * by B either naming A in `blockedBy` or not declaring `blockedBy` at all. Only
 * a `blockedBy` list that exists and omits A is a contradiction, because that
 * is the one case where the author has stated something incompatible rather
 * than merely stated less.
 */
function syncBlockRelations(
	parsed: ParsedTemplate,
	tasks: Task[],
	taskPath: Map<string, LinkTarget>,
): void {
	const byPath = new Map<LinkTarget, Task>();
	tasks.forEach((task) => byPath.set(task.path, task));

	const declared = new Map<
		LinkTarget,
		{ blocks?: Set<LinkTarget>; blockedBy?: Set<LinkTarget>; line: number }
	>();

	parsed.tasks.forEach((parsedTask, index) => {
		const path = tasks[index].path;
		const entry: {
			blocks?: Set<LinkTarget>;
			blockedBy?: Set<LinkTarget>;
			line: number;
		} = { line: parsedTask.line };
		if (parsedTask.blocks) {
			entry.blocks = new Set(parsedTask.blocks.map((a) => taskPath.get(a) ?? a));
		}
		if (parsedTask.blockedBy) {
			entry.blockedBy = new Set(
				parsedTask.blockedBy.map((a) => taskPath.get(a) ?? a),
			);
		}
		declared.set(path, entry);
	});

	const title = (path: LinkTarget) => byPath.get(path)?.title ?? path;

	for (const [path, entry] of declared) {
		for (const target of entry.blocks ?? []) {
			const other = declared.get(target);
			if (other?.blockedBy && !other.blockedBy.has(path)) {
				fail(
					`"${title(path)}" declares it blocks "${title(target)}", but "${title(
						target,
					)}" declares a blockedBy list that doesn't include it`,
					entry.line,
				);
			}
		}
		for (const target of entry.blockedBy ?? []) {
			const other = declared.get(target);
			if (other?.blocks && !other.blocks.has(path)) {
				fail(
					`"${title(path)}" declares it is blocked by "${title(target)}", but "${title(
						target,
					)}" declares a blocks list that doesn't include it`,
					entry.line,
				);
			}
		}
	}

	// Contradiction-free: fill in whichever half each edge is missing.
	const add = (task: Task | undefined, key: keyof TaskRelations, value: LinkTarget) => {
		if (!task) return;
		const list = task.relations[key] as LinkTarget[];
		if (!list.includes(value)) list.push(value);
	};

	for (const task of tasks) {
		for (const target of [...task.relations.blocks]) {
			add(byPath.get(target), "blockedBy", task.path);
		}
		for (const target of [...task.relations.blockedBy]) {
			add(byPath.get(target), "blocks", task.path);
		}
	}
}

/* --------------------------------------------------------------- views ---- */

function resolveViews(parsed: ParsedView[], context: QueryContext): SavedView[] {
	const ids: string[] = [];

	return parsed.map((view) => {
		const id = slugify(view.name, ids);
		ids.push(id);

		// A `query:` is the whole definition, not a set of extra hints: mixing it
		// with the structured shorthand would leave two sources of truth for the
		// same field with no obvious winner, so the query simply wins outright.
		const definition = view.query
			? definitionFromQuery(view.query, context, `View "${view.name}"`)
			: null;

		const saved = makeView(id, view.name, {
			icon: view.icon,
			viewType: definition?.viewType ?? view.viewType,
			filters: definition?.filters,
			groupBy: definition?.groupBy ?? view.groupBy,
			sortBy: definition?.sortBy ?? view.sortBy,
			sortDirection: definition?.sortDirection ?? view.sortDirection,
			subtaskDisplay: definition?.subtaskDisplay,
		});

		if (definition) {
			saved.emptyColumnBehavior = definition.emptyColumnBehavior;
			saved.hiddenFields = [...definition.hiddenFields];
			saved.calendarDateField = definition.calendarDateField;
		}
		if (view.description) saved.description = view.description;
		return saved;
	});
}

/* ---------------------------------------------------------- dashboards ---- */

interface ScopeResolvers {
	resolveStatus: (raw: string, line: number) => string;
	resolvePriority: (raw: string, line: number) => string;
	resolveTaskType: (raw: string, line: number) => string;
	resolveLabel: (raw: string, line: number) => string;
	resolvePerson: (raw: string, line: number) => string;
	resolveProjectRef: (raw: string, line: number) => string;
}

function resolveDashboards(
	parsed: ParsedDashboard[],
	context: QueryContext,
	resolvers: ScopeResolvers,
): DashboardConfig[] {
	const ids: string[] = [];

	return parsed.map((dashboard) => {
		const id = slugify(dashboard.name, ids);
		ids.push(id);

		const widgetIds: string[] = [];
		const widgets: DashboardWidget[] = [];
		let y = 0;

		for (const row of dashboard.rows) {
			const widths = rowWidths(row);
			const height = Math.max(...row.map((w) => widgetHeight(w.chartType)));
			let x = 0;

			row.forEach((widget, i) => {
				const widgetId = slugify(widget.title, widgetIds);
				widgetIds.push(widgetId);
				widgets.push(
					makeWidget(
						widgetId,
						widget.chartType,
						widget.title,
						fieldMappingFor(widget, (field, value, line) =>
							resolveScopeValue(field, value, line, resolvers),
						),
						{ x, y, w: widths[i], h: height },
					),
				);
				x += widths[i];
			});

			y += height;
		}

		const config = makeDashboard(id, dashboard.name, widgets, dashboard.icon);
		if (dashboard.filter) {
			config.filters = filtersFromQuery(
				dashboard.filter,
				context,
				`Dashboard "${dashboard.name}"`,
			);
		}
		if (dashboard.description) config.description = dashboard.description;
		return config;
	});
}

function resolveScopeValue(
	field: string,
	value: string,
	line: number,
	resolvers: ScopeResolvers,
): string {
	switch (field) {
		case "status":
			return resolvers.resolveStatus(value, line);
		case "priority":
			return resolvers.resolvePriority(value, line);
		case "taskType":
			return resolvers.resolveTaskType(value, line);
		case "label":
			return resolvers.resolveLabel(value, line);
		case "assignee":
			return resolvers.resolvePerson(value, line);
		case "project":
			return resolvers.resolveProjectRef(value, line);
		default:
			return value;
	}
}
