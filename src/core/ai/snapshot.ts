/**
 * Builds the JSON snapshot injected as the AI Chat system message — no
 * retrieval/RAG for this spike, just the active workspace's tasks/projects
 * inlined directly. Pure over `WorkspaceSnapshot` + `WorkspaceTaxonomies`, so
 * it's testable without the Obsidian API (Golden Rule) and without WebLLM.
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

export interface AiProjectSummary {
	title: string;
	statusCounts: Record<string, number>;
	overdueCount: number;
	owner: string | null;
	startDate: IsoDate | null;
	dueDate: IsoDate | null;
}

export interface AiWorkspaceSnapshot {
	workspaceName: string;
	today: IsoDate;
	tasks: AiTaskSummary[];
	projects: AiProjectSummary[];
	/** True when tasks were dropped to fit the model's context window. */
	truncated: boolean;
	omittedTaskCount: number;
}

/** A task counts as overdue only while it's still real, outstanding work. */
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

function summarizeProject(
	project: Project,
	tasks: Task[],
	statuses: Taxonomy,
	today: IsoDate,
	people: Person[],
): AiProjectSummary {
	const ownTasks = tasks.filter((task) => task.project === project.path && !task.archived);

	const statusCounts: Record<string, number> = {};
	let overdueCount = 0;
	for (const task of ownTasks) {
		const statusName = getValue(statuses, task.status)?.name ?? "None";
		statusCounts[statusName] = (statusCounts[statusName] ?? 0) + 1;
		if (isOverdueTask(task, statuses, today)) overdueCount++;
	}

	return {
		title: project.title,
		statusCounts,
		overdueCount,
		owner: personName(people, project.owner),
		startDate: project.startDate,
		dueDate: project.dueDate,
	};
}

/**
 * @param maxTasks Truncation budget — when the task list is longer, the
 *   least-recently-updated tasks are dropped first (they're the least likely
 *   to matter to "what's happening now" questions).
 */
export function buildAiWorkspaceSnapshot(
	snapshot: WorkspaceSnapshot,
	taxonomies: WorkspaceTaxonomies,
	options: { maxTasks?: number; today?: IsoDate } = {},
): AiWorkspaceSnapshot {
	const today = options.today ?? new Date().toISOString().slice(0, 10);
	const maxTasks = options.maxTasks ?? Infinity;
	const people = snapshot.workspace.people;

	const liveTasks = snapshot.tasks.filter((task) => !task.archived);
	const sorted = [...liveTasks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
	const kept = sorted.slice(0, maxTasks);

	return {
		workspaceName: snapshot.workspace.name,
		today,
		tasks: kept.map((task) =>
			summarizeTask(task, snapshot.tasks, snapshot.projects, taxonomies.taskType, people),
		),
		projects: snapshot.projects
			.filter((project) => !project.archived)
			.map((project) =>
				summarizeProject(project, liveTasks, taxonomies.status, today, people),
			),
		truncated: kept.length < sorted.length,
		omittedTaskCount: sorted.length - kept.length,
	};
}

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

/** Rough token estimate (chars/4) used to size the truncation budget before serializing. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
