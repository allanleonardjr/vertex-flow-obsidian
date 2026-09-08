/**
 * Task → flat display record, for the denormalized CSV and iCalendar rows.
 *
 * Every value is a resolved name, never a stored id: `displayName()` for the
 * taxonomy fields, the project/parent title for the link fields, the person's
 * name for `assignee`. JSON does *not* use this — it keeps raw ids and carries a
 * separate `resolved` lookup block (see `json.ts`).
 */

import { basename } from "../links";
import { displayName } from "../taxonomy";
import type { Comment, IsoDate, LinkTarget, Task } from "../types";
import type { ViewContext } from "../views";
import type { FieldId } from "./fields";

export interface ResolveLookups {
	context: ViewContext;
	/** Task path → its title (falling back to its id / basename). */
	taskTitleByPath: Map<LinkTarget, string>;
	/** Task id → note body. Present only when Description was requested. */
	descriptions?: Record<string, string>;
	/** Task id → comments. Present only when Comments was requested. */
	comments?: Record<string, Comment[]>;
}

/** A resolved row: every field id mapped to its display string. */
export type DisplayRecord = Partial<Record<FieldId, string>>;

function projectTitle(
	path: LinkTarget | null,
	lookups: ResolveLookups,
): string {
	if (!path) return "";
	return lookups.context.titles?.get(path) ?? basename(path);
}

function taskTitle(path: LinkTarget | null, lookups: ResolveLookups): string {
	if (!path) return "";
	return lookups.taskTitleByPath.get(path) ?? basename(path);
}

function personName(id: string | null, lookups: ResolveLookups): string {
	if (!id) return "";
	return lookups.context.people.find((p) => p.id === id)?.name ?? id;
}

function formatComments(comments: Comment[]): string {
	return comments
		.map((c) => `${c.author} (${c.date}): ${c.body}`)
		.join("\n\n");
}

function formatRelations(task: Task, lookups: ResolveLookups): string {
	const parts: string[] = [];
	if (task.relations.blocks.length > 0) {
		parts.push(
			`blocks: ${task.relations.blocks.map((p) => taskTitle(p, lookups)).join(", ")}`,
		);
	}
	if (task.relations.blockedBy.length > 0) {
		parts.push(
			`blocked-by: ${task.relations.blockedBy.map((p) => taskTitle(p, lookups)).join(", ")}`,
		);
	}
	return parts.join("; ");
}

/** Build the full display record for one task (every field id). */
export function resolveDisplayRecord(
	task: Task,
	lookups: ResolveLookups,
): Record<FieldId, string> {
	const tx = lookups.context.taxonomies;
	const date = (d: IsoDate | null) => d ?? "";

	return {
		id: task.id,
		title: task.title,
		status: displayName(tx.status, task.status),
		priority: displayName(tx.priority, task.priority),
		taskType: displayName(tx.taskType, task.taskType),

		project: projectTitle(task.project, lookups),
		parent: taskTitle(task.parent, lookups),
		assignee: personName(task.assignee, lookups),
		labels: task.labels.map((id) => displayName(tx.label, id)).join(", "),

		dueDate: date(task.dueDate),
		startDate: date(task.startDate),
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		archivedAt: date(task.archivedAt),

		description: lookups.descriptions?.[task.id] ?? "",
		comments: formatComments(lookups.comments?.[task.id] ?? []),
		estimate: task.estimate == null ? "" : String(task.estimate),
		relations: formatRelations(task, lookups),
	};
}
