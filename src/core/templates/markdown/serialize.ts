/**
 * The inverse of `parse.ts`: a live workspace's settings → a
 * `type: vertex-flow-workspace-template` markdown file the New Workspace
 * gallery can offer.
 *
 * Settings only — no Projects, no Tasks, no `history` toggle, no `*` "me"
 * marker. `# Projects` and `# Tasks` are emitted empty, exactly like
 * `templates/blank-workspace.md`. `supportsExampleContent: false` always: there
 * is nothing to populate.
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

/* ------------------------------------------------------------- entry ----- */

export function serializeTemplateMarkdown(input: TemplateSerializeInput): string {
	const { meta, workspace, views, dashboards, queryContext } = input;

	const statuses = [...workspace.statuses].sort((a, b) => a.order - b.order);
	const priorities = [...workspace.priorities].sort((a, b) => a.order - b.order);

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
	frontmatter.supportsExampleContent = false;

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

	const yaml = stringifyYaml(frontmatter);
	return `---\n${yaml}---\n\n# Projects\n\n# Tasks\n`;
}
