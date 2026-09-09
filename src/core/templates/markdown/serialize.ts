/**
 * The inverse of `parse.ts`: a live workspace's settings → a
 * `type: vertex-flow-workspace-template` markdown file the New Workspace
 * gallery can offer.
 *
 * Configuration plus Projects — statuses, priorities, task types, labels, the
 * people roster, saved views, dashboards, and each (non-archived) Project as a
 * frontmatter entry (same shape as Views/Dashboards) carrying its title, icon,
 * description, status/priority/owner/labels and dates. No Tasks, no task
 * comments, no `history` toggle, no `*` "me" marker. `supportsExampleContent`
 * is truthful about all of that: `true` when the template carries Projects,
 * `false` (blank, like `blank-workspace.md`) when it has nothing to populate.
 *
 * Pure — no Obsidian import (Golden Rule); `yaml` is the one sanctioned
 * dependency, already used by `parse.ts` for the reverse direction.
 */

import { stringify as stringifyYaml } from "yaml";

import { printFilters, printQuery, type QueryContext } from "../../query";
import type {
	DashboardConfig,
	DashboardWidget,
	PriorityValue,
	Project,
	SavedView,
	StatusValue,
	TaskTypeValue,
	WorkspaceConfig,
} from "../../types";
import { viewDefinition } from "../../views/filter";
import { TEMPLATE_SCHEMA_VERSION } from "./parse";

export interface TemplateSerializeInput {
	meta: { id: string; name: string; description?: string; icon?: string; createdAt?: string };
	/** Source of the taxonomy and the people roster. */
	workspace: WorkspaceConfig;
	/** Every Saved View to carry over — the caller drops synthetic System Views. */
	views: SavedView[];
	dashboards: DashboardConfig[];
	/** The workspace's Projects; archived ones are dropped by the serializer. */
	projects: Project[];
	/** A project's body description — the part that doesn't live on the bare
	 *  `Project` record — keyed by `project.path`. */
	projectDescriptions?: Record<string, string>;
	/** For `printQuery` / `printFilters` — build it with `queryContext(snapshot)`. */
	queryContext: QueryContext;
}

/* ---------------------------------------------------------- taxonomy ------ */

function withDescription(head: string, description?: string): string {
	const trimmed = description?.trim();
	return trimmed ? `${head} - ${trimmed}` : head;
}

function statusShorthand(value: StatusValue): string {
	return withDescription(
		`${value.name} (${value.category}, ${value.color})`,
		value.description,
	);
}

function flatShorthand(value: PriorityValue | TaskTypeValue): string {
	return withDescription(`${value.name} (${value.color})`, value.description);
}

/* ---------------------------------------------------------- dashboards --- */

function widgetMap(
	widget: DashboardWidget,
	includeWeight: boolean,
): Record<string, unknown> {
	const fm = widget.fieldMapping;
	const map: Record<string, unknown> = {
		type: fm.chartType,
		title: widget.title.trim() || fm.chartType,
	};

	switch (fm.chartType) {
		case "bar":
		case "pie":
			map.groupBy = fm.groupBy;
			break;
		case "line":
		case "timeline":
			map.xField = fm.xField;
			map.bucket = fm.bucket;
			if (fm.groupBy) map.groupBy = fm.groupBy;
			break;
		case "kpi":
			map.metric = fm.metric;
			if (fm.scope) {
				map.scope = { field: fm.scope.field, value: fm.scope.value };
			}
			break;
	}

	// `weight` is a relative share within its row — the parser normalises it
	// against the row total, so the raw column width carries over directly.
	if (includeWeight) map.weight = widget.layout.w;
	return map;
}

/**
 * Group widgets into rows by their `y` band (widgets sharing a `y` are one
 * row), each row ordered by `x`. Some fidelity loss going grid → rows → grid is
 * expected and acceptable — dashboards are Phase 1 and row-share is already a
 * simplification.
 */
function widgetRows(dashboard: DashboardConfig): Record<string, unknown>[][] {
	const byY = new Map<number, DashboardWidget[]>();
	for (const widget of dashboard.widgets) {
		const row = byY.get(widget.layout.y) ?? [];
		row.push(widget);
		byY.set(widget.layout.y, row);
	}

	return [...byY.keys()]
		.sort((a, b) => a - b)
		.map((y) => {
			const row = byY.get(y)!.sort((a, b) => a.layout.x - b.layout.x);
			return row.map((widget) => widgetMap(widget, row.length > 1));
		});
}

function dashboardMap(
	dashboard: DashboardConfig,
	context: QueryContext,
): Record<string, unknown> {
	const map: Record<string, unknown> = { name: dashboard.name };
	if (dashboard.icon) map.icon = dashboard.icon;
	if (dashboard.description) map.description = dashboard.description;

	const filter = printFilters(dashboard.filters, context);
	if (filter) map.filter = filter;

	map.rows = widgetRows(dashboard);
	return map;
}

/* ------------------------------------------------------------- views ----- */

function viewMap(view: SavedView, context: QueryContext): Record<string, unknown> {
	const map: Record<string, unknown> = { name: view.name };
	if (view.icon) map.icon = view.icon;
	if (view.description) map.description = view.description;
	// A single `query:` line is a complete, battle-tested round-trip — the
	// grammar defines it to take precedence over every structured alternative.
	map.query = printQuery(viewDefinition(view), context);
	return map;
}

/* ----------------------------------------------------------- projects ------ */

/** A Project rides in frontmatter, same shape as Views/Dashboards, so every
 *  property survives the trip. References (status/priority/owner/labels) are
 *  written as *names* rather than ids — the parser re-resolves them against the
 *  same taxonomy this template ships, exactly as the old body field line did. */
function projectMap(
	project: Project,
	description: string | undefined,
	workspace: WorkspaceConfig,
): Record<string, unknown> {
	const nameById = (list: { id: string; name: string }[], id: string | null) =>
		list.find((v) => v.id === id)?.name;

	const map: Record<string, unknown> = { title: project.title };
	if (project.icon) map.icon = project.icon;
	if (description?.trim()) map.description = description.trim();

	const status = nameById(workspace.statuses, project.status);
	if (status) map.status = status;
	const priority = nameById(workspace.priorities, project.priority);
	if (priority) map.priority = priority;
	if (project.labels.length > 0) {
		map.labels = project.labels
			.map((id) => nameById(workspace.labels, id))
			.filter((n): n is string => Boolean(n));
	}
	const owner = nameById(workspace.people, project.owner);
	if (owner) map.owner = owner;

	if (project.startDate) map.start = project.startDate;
	if (project.dueDate) map.due = project.dueDate;
	if (project.createdAt) map.created = project.createdAt;
	if (project.updatedAt) map.updated = project.updatedAt;
	return map;
}

/* ------------------------------------------------------------- entry ----- */

export function serializeTemplateMarkdown(input: TemplateSerializeInput): string {
	const { meta, workspace, views, dashboards, projects, projectDescriptions, queryContext } =
		input;

	const statuses = [...workspace.statuses].sort((a, b) => a.order - b.order);
	const priorities = [...workspace.priorities].sort((a, b) => a.order - b.order);

	// Archived projects are workspace trash, not template payload.
	const activeProjects = projects.filter((p) => !p.archived);

	const frontmatter: Record<string, unknown> = {
		templateSchema: TEMPLATE_SCHEMA_VERSION,
		type: "vertex-flow-workspace-template",
		id: meta.id,
		name: meta.name,
		// The parser requires a non-empty description; fall back to the name.
		description: meta.description?.trim() || meta.name,
	};
	if (meta.icon) frontmatter.icon = meta.icon;
	if (meta.createdAt) frontmatter.createdAt = meta.createdAt;
	// Truthful: the toggle populates something only when Projects ride along.
	frontmatter.supportsExampleContent = activeProjects.length > 0;

	frontmatter.statuses = statuses.map(statusShorthand);
	frontmatter.priorities = priorities.map(flatShorthand);
	frontmatter.taskTypes = workspace.taskTypes.map(flatShorthand);
	frontmatter.labels = workspace.labels.map(flatShorthand);
	// Real names, full roster — but never the `*` "me" marker (§9): carrying it
	// would auto-assign the exporting device's identity to whoever creates a
	// workspace from this template.
	frontmatter.people = workspace.people.map((person) => person.name);

	if (views.length > 0) {
		frontmatter.views = views.map((view) => viewMap(view, queryContext));
	}
	if (dashboards.length > 0) {
		frontmatter.dashboards = dashboards.map((dashboard) =>
			dashboardMap(dashboard, queryContext),
		);
	}
	if (activeProjects.length > 0) {
		frontmatter.projects = activeProjects.map((project) =>
			projectMap(project, projectDescriptions?.[project.path], workspace),
		);
	}

	const yaml = stringifyYaml(frontmatter);

	// Projects ride in frontmatter, so the body is empty scaffolding — the
	// grammar a template's body conforms to is still exactly "# Projects" and
	// "# Tasks", and a hand-author adding `##` sections from there works.
	return `---\n${yaml}---\n\n# Projects\n\n# Tasks\n`;
}
