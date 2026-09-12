/**
 * Core building blocks the AI Chat system message is built from: a small,
 * fixed-cost facts layer (counts + taxonomy legend + people roster — see
 * `buildFactsSection`) sent on every message, and task summarization used
 * both by that facts layer's callers and by the on-demand `searchTasks`/
 * `countTasks` query actions in `./query-action.ts`. Pure over
 * `WorkspaceSnapshot` + `WorkspaceTaxonomies`, so it's testable without the
 * Obsidian API (Golden Rule) and without WebLLM.
 *
 * There is deliberately no "the whole workspace, maybe truncated" builder
 * here any more. That shape silently dropped tasks past a fixed token
 * budget — confirmed to misreport totals on a 90-task workspace — which is
 * exactly the failure mode the query-on-demand architecture in
 * `../../ui/ai-chat/AiChatView.tsx` replaces: the facts layer answers
 * aggregate questions from real counts, and specific-task questions go
 * through `query-action.ts` against the real filtering engine instead.
 */

import { getValue, isCanceled, isCompleted, listValues, type Taxonomy } from "../taxonomy/engine";
import type { WorkspaceTaxonomies } from "../taxonomy";
import type { IsoDate, Person, Project, Task, WorkspaceSnapshot } from "../types";

export interface AiTaskSummary {
	id: string;
	title: string;
	status: string | null;
	priority: string | null;
	taskType: string | null;
	assignee: string | null;
	estimate: number | null;
	dueDate: IsoDate | null;
	startDate: IsoDate | null;
	project: string | null;
	labels: string[];
	parent: string | null;
}

/**
 * A task counts as overdue only while it's still real, outstanding work.
 * Used by the `searchTasks`/`countTasks` `overdue` query-action flag
 * (`./query-action.ts`) — there's no such field on `Task` itself, and no
 * `ViewFilters` equivalent, since it's derived from `dueDate` + status
 * category + "today" rather than a stored value.
 */
export function isOverdueTask(task: Task, statuses: Taxonomy, today: IsoDate): boolean {
	if (!task.dueDate || task.dueDate >= today) return false;
	return !isCompleted(statuses, task.status) && !isCanceled(statuses, task.status);
}

function titleFor(path: string | null, tasks: Task[], projects: Project[]): string | null {
	if (!path) return null;
	const task = tasks.find((candidate) => candidate.path === path);
	if (task) return task.title;
	const project = projects.find((candidate) => candidate.path === path);
	return project?.title ?? null;
}

function personName(people: Person[], id: string | null): string | null {
	if (!id) return null;
	return people.find((person) => person.id === id)?.name ?? null;
}

function summarizeTask(
	task: Task,
	tasks: Task[],
	projects: Project[],
	taskTypes: Taxonomy,
	people: Person[],
): AiTaskSummary {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		priority: task.priority,
		taskType: getValue(taskTypes, task.taskType)?.name ?? null,
		assignee: personName(people, task.assignee),
		estimate: task.estimate,
		dueDate: task.dueDate,
		startDate: task.startDate,
		project: titleFor(task.project, tasks, projects),
		labels: task.labels,
		parent: titleFor(task.parent, tasks, projects),
	};
}

/** Summarize an already-filtered task list (e.g. a `searchTasks` query result) for display to the model. */
export function summarizeTasks(
	tasks: Task[],
	snapshot: WorkspaceSnapshot,
	taxonomies: WorkspaceTaxonomies,
): AiTaskSummary[] {
	return tasks.map((task) =>
		summarizeTask(
			task,
			snapshot.tasks,
			snapshot.projects,
			taxonomies.taskType,
			snapshot.workspace.people,
		),
	);
}

// ---------------------------------------------------------------------------
// Prompt formatting — pipe-delimited rows instead of JSON: repeated object
// keys cost real tokens against a budget, and the model only ever reads
// this, never round-trips it.
// ---------------------------------------------------------------------------

function csvField(value: string): string {
	return value.includes("|") || value.includes("\n")
		? value.replace(/\|/g, "/").replace(/\n/g, " ")
		: value;
}

export function flattenTasks(tasks: AiTaskSummary[]): string {
	const header =
		"id | title | status | priority | taskType | assignee | project | parent | labels | startDate | dueDate | estimate";
	if (tasks.length === 0) return `${header}\n(none)`;
	const rows = tasks.map((task) =>
		[
			task.id,
			task.title,
			task.status ?? "-",
			task.priority ?? "-",
			task.taskType ?? "-",
			task.assignee ?? "-",
			task.project ?? "-",
			task.parent ?? "-",
			task.labels.length ? task.labels.join(",") : "-",
			task.startDate ?? "-",
			task.dueDate ?? "-",
			task.estimate ?? "-",
		]
			.map((value) => csvField(String(value)))
			.join(" | "),
	);
	return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Taxonomy legend + people roster — workspace configuration, not task data.
// ---------------------------------------------------------------------------

/**
 * The configured meaning of each taxonomy in this workspace — Status,
 * Priority, Task Type, and Labels are fully per-workspace configurable
 * (Golden Rule: one taxonomy engine, four configurations), so nothing about
 * their names, order, or category can be assumed from training data. Category
 * tags (`[backlog]`, `[started]`, …) are what let the model tell an active
 * status from a terminal one without guessing from the name alone.
 */
export function buildTaxonomyLegend(taxonomies: WorkspaceTaxonomies): string {
	const statuses = listValues(taxonomies.status)
		.map((value) => `${value.name} [${value.category}]`)
		.join(", ");
	const priorities = listValues(taxonomies.priority)
		.map((value) => value.name)
		.join(", ");
	const taskTypes = listValues(taxonomies.taskType)
		.map((value) => value.name)
		.join(", ");
	const labels = listValues(taxonomies.label)
		.map((value) => value.name)
		.join(", ");

	return [
		`Statuses (in order): ${statuses || "none defined"}`,
		`Priorities (in order): ${priorities || "none defined"}`,
		`Task Types: ${taskTypes || "none defined"}`,
		`Labels: ${labels || "none defined"}`,
	].join("\n");
}

/** Short roster so the model can resolve "who owns X" without re-deriving names from ids. */
export function buildPeopleRoster(people: Person[]): string {
	if (people.length === 0) return "People: none registered";
	return `People: ${people.map((person) => person.name).join(", ")}`;
}

/**
 * The fixed-cost layer sent on every message, regardless of workspace size.
 * Counts are cheap `.length`/`.filter().length` reads off the real arrays —
 * never derived from a possibly-truncated list, which is what made "how many
 * tasks do I have?" answerable wrong before. The legend and roster are
 * bounded by how many taxonomy values and people this workspace has
 * configured, not by how many tasks exist.
 *
 * Invariant: this function's output must never need truncation. Don't be
 * tempted to list every project's name here — that scales with task-adjacent
 * data, unbounded, exactly like the thing this replaces. Specific task/project
 * identities are what the on-demand `searchTasks`/`countTasks` query actions
 * (`./query-action.ts`) are for.
 */
export function buildFactsSection(
	snapshot: WorkspaceSnapshot,
	taxonomies: WorkspaceTaxonomies,
	today: IsoDate = new Date().toISOString().slice(0, 10),
): string {
	const liveTaskCount = snapshot.tasks.filter((task) => !task.archived).length;
	const archivedTaskCount = snapshot.tasks.length - liveTaskCount;
	const projectCount = snapshot.projects.filter((project) => !project.archived).length;

	const counts =
		`Today's date: ${today}. ` +
		`Tasks: ${liveTaskCount} (${archivedTaskCount} archived). ` +
		`Projects: ${projectCount}.`;

	return [
		counts,
		buildTaxonomyLegend(taxonomies),
		buildPeopleRoster(snapshot.workspace.people),
	].join("\n");
}

/** Rough token estimate (chars/4) used to size the truncation budget before serializing. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
