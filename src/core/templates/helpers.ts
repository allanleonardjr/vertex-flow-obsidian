/**
 * Small builders shared by the template files, so each template reads as data
 * rather than boilerplate. Pure functions over plain objects — no Obsidian.
 */

import { joinPath } from "../links";
import { initialRanks } from "../ranking/lexorank";
import {
	emptyRelations,
	type ChartType,
	type DashboardConfig,
	type DashboardFieldMapping,
	type DashboardWidget,
	type DashboardWidgetLayout,
	type GroupByField,
	type Project,
	type SavedView,
	type SortField,
	type Task,
	type ViewFilters,
	type ViewType,
} from "../types";
import type { TemplateBuildContext } from "./types";

/**
 * A rank dispenser. Tasks created through the returned function land in call
 * order under the global `rank` — matching how the app itself seeds a batch.
 */
export function rankSeq(count: number): () => string {
	const ranks = initialRanks(count);
	let i = 0;
	return () => ranks[i++] ?? ranks[ranks.length - 1];
}

export function makeProject(
	ctx: TemplateBuildContext,
	title: string,
	overrides: Partial<Project> = {},
): Project {
	const path = joinPath(ctx.root, "Projects", title);
	return {
		type: "project",
		title,
		status: "in-progress",
		// New optional fields default to unset so every existing template call
		// site keeps working unchanged; pass them through `overrides` when wanted.
		priority: null,
		labels: [],
		startDate: null,
		dueDate: null,
		owner: null,
		archived: false,
		archivedAt: null,
		createdAt: ctx.iso(-30),
		updatedAt: ctx.iso(-1),
		path,
		...overrides,
	};
}

export function makeTask(
	ctx: TemplateBuildContext,
	n: number,
	nextRank: () => string,
	overrides: Partial<Task> = {},
): Task {
	return {
		type: "task",
		id: ctx.taskPath(n).split("/").pop() as string,
		title: "",
		taskType: null,
		status: "todo",
		priority: null,
		rank: nextRank(),
		project: null,
		parent: null,
		assignee: null,
		estimate: null,
		labels: [],
		startDate: null,
		dueDate: null,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: ctx.iso(-10),
		updatedAt: ctx.iso(-1),
		path: ctx.taskPath(n),
		mentions: [],
		...overrides,
	};
}

export function makeView(
	id: string,
	name: string,
	partial: {
		icon?: string;
		viewType?: ViewType;
		filters?: ViewFilters;
		groupBy?: GroupByField;
		sortBy?: SortField;
		sortDirection?: "asc" | "desc";
	} = {},
): SavedView {
	const viewType = partial.viewType ?? "list";
	return {
		id,
		name,
		icon: partial.icon ?? (viewType === "board" ? "columns-3" : "list"),
		viewType,
		filters: partial.filters ?? {},
		groupBy: partial.groupBy ?? (viewType === "board" ? "status" : "none"),
		sortBy: partial.sortBy ?? "rank",
		sortDirection: partial.sortDirection ?? "asc",
		columns: { collapsed: [], hidden: [] },
		emptyColumnBehavior: "show-normal",
		hiddenFields: [],
		calendarDateField: "dueDate",
	};
}

/**
 * A dashboard widget, built declaratively. Templates can't call the runtime
 * `newWidget()` / `widgetFromConfig()` helpers (those need a live `ViewContext`
 * that doesn't exist at template-authoring time), so they pass an explicit
 * `fieldMapping`, `layout`, and title here. `titleIsCustom` stays `false` — the
 * title is the auto-generated default and the app is free to regenerate it if
 * the user later re-maps the widget.
 */
export function makeWidget(
	id: string,
	chartType: ChartType,
	title: string,
	fieldMapping: DashboardFieldMapping,
	layout: DashboardWidgetLayout,
): DashboardWidget {
	return { id, chartType, title, titleIsCustom: false, fieldMapping, layout };
}

/**
 * A dashboard for a template's example content, mirroring `makeView`. Starts
 * with an empty filter set — every widget aggregates over the whole workspace.
 */
export function makeDashboard(
	id: string,
	name: string,
	widgets: DashboardWidget[],
	icon = "layout-dashboard",
): DashboardConfig {
	return { id, name, icon, filters: {}, widgets };
}

/**
 * Derives each task's `mentions` from its comment bodies, exactly as the
 * indexer does — so a populated template snapshot matches a re-indexed vault.
 */
export function deriveMentions(
	tasks: Task[],
	people: { id: string }[],
	commentsByPath: Map<string, { body: string }[]>,
): void {
	for (const task of tasks) {
		const comments = commentsByPath.get(task.path) ?? [];
		const mentioned = new Set<string>();
		for (const comment of comments) {
			for (const person of people) {
				if (
					comment.body.toLowerCase().includes(`@${person.id.toLowerCase()}`)
				) {
					mentioned.add(person.id);
				}
			}
		}
		task.mentions = [...mentioned];
	}
}
