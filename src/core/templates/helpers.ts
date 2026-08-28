/**
 * Small builders shared by the template files, so each template reads as data
 * rather than boilerplate. Pure functions over plain objects — no Obsidian.
 */

import { joinPath } from "../links";
import { initialRanks } from "../ranking/lexorank";
import {
	emptyRelations,
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
	};
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
