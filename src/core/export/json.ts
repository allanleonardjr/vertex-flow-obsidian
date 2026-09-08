/**
 * Workspace JSON export.
 *
 * The raw `WorkspaceSnapshot` shape (ids, not names — TASK-IO compatible) with
 * `tasks` narrowed to the export scope, plus an always-present `resolved` block
 * of id→name lookups so the file reads sensibly without the live plugin. The
 * `descriptions` / `comments` blocks appear only when those fields were checked.
 *
 * This is deliberately *not* an importable format — see `CLAUDE.md`'s non-goals.
 */

import type {
	Comment,
	IsoDate,
	LinkTarget,
	Task,
	WorkspaceSnapshot,
} from "../types";
import type { ViewContext } from "../views";

export interface ExportMeta {
	exportedAt: IsoDate;
	pluginVersion: string;
	workspaceName: string;
	workspaceRoot: string;
}

export interface ResolvedLookups {
	projects: Record<LinkTarget, string>;
	people: Record<string, string>;
	statuses: Record<string, string>;
	priorities: Record<string, string>;
	taskTypes: Record<string, string>;
	labels: Record<string, string>;
}

export interface JsonExtras {
	descriptions?: Record<string, string>;
	comments?: Record<string, Comment[]>;
}

function fromValues(values: readonly { id: string; name: string }[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const value of values) out[value.id] = value.name;
	return out;
}

export function buildResolved(context: ViewContext): ResolvedLookups {
	const projects: Record<LinkTarget, string> = {};
	if (context.titles) {
		for (const [path, title] of context.titles) projects[path] = title;
	}
	const people: Record<string, string> = {};
	for (const person of context.people) people[person.id] = person.name;

	return {
		projects,
		people,
		statuses: fromValues(context.taxonomies.status.values),
		priorities: fromValues(context.taxonomies.priority.values),
		taskTypes: fromValues(context.taxonomies.taskType.values),
		labels: fromValues(context.taxonomies.label.values),
	};
}

export function buildWorkspaceJson(
	snapshot: WorkspaceSnapshot,
	scopedTasks: Task[],
	context: ViewContext,
	meta: ExportMeta,
	extras: JsonExtras = {},
): string {
	const payload: Record<string, unknown> = {
		workspace: snapshot.workspace,
		tasks: scopedTasks,
		projects: snapshot.projects,
		views: snapshot.views,
		dashboards: snapshot.dashboards,
		trash: snapshot.trash,
		resolved: buildResolved(context),
	};

	if (extras.descriptions) payload.descriptions = extras.descriptions;
	if (extras.comments) payload.comments = extras.comments;
	payload.meta = meta;

	return JSON.stringify(payload, null, 2) + "\n";
}
