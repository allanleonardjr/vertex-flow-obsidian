/**
 * Task frontmatter ↔ domain object.
 *
 * `parseTask` takes the *already-parsed* YAML object, never a string — that's
 * what keeps this module free of the Obsidian API (and of a YAML dependency)
 * while still being the thing unit tests exercise.
 */

import { basename, formatLink, formatLinkList, parseLink, parseLinkList } from "../links";
import { MIDDLE_RANK, isValidRank } from "../ranking/lexorank";
import { emptyRelations, type Task, type TaskRelations } from "../types";
import {
	IssueLog,
	asBoolean,
	asDate,
	asDateTime,
	asNumber,
	asString,
	asStringArray,
	asRecord,
	compact,
	nowIso,
	type ParseResult,
} from "./coerce";

export interface TaskParseOptions {
	/** Vault path of the note, which is also its identity. */
	path: string;
	/** Workspace's configured default, used when `status` is missing. `null` when the workspace has no statuses. */
	defaultStatus: string | null;
	/** `Person.id`s @mentioned in the body — computed by the caller. */
	mentions?: string[];
}

export function parseTask(
	raw: unknown,
	options: TaskParseOptions,
): ParseResult<Task> {
	const fm = asRecord(raw);
	const log = new IssueLog();

	// The filename is the ID (Golden Rule), so it wins over the frontmatter
	// field if they ever disagree — the file is the thing wikilinks resolve to.
	const fileId = basename(options.path);
	const declaredId = asString(fm.id);
	if (declaredId && declaredId !== fileId) {
		log.add(
			`Frontmatter id "${declaredId}" does not match filename "${fileId}"; using the filename.`,
		);
	}

	const status = asString(fm.status);
	if (!status) {
		log.add(
			options.defaultStatus
				? `Missing status; defaulting to "${options.defaultStatus}".`
				: "Missing status; leaving it unset.",
		);
	}

	const rawRank = asString(fm.rank);
	let rank = rawRank ?? MIDDLE_RANK;
	if (rawRank && !isValidRank(rawRank)) {
		log.add(`Invalid rank ${JSON.stringify(rawRank)}; reset to the middle.`);
		rank = MIDDLE_RANK;
	}

	const project = parseLink(fm.project);
	const parent = parseLink(fm.parent);

	// `parent` and `project` are independent fields. A sub-task carries its own
	// `project` link — seeded from its parent at creation, then maintained on
	// its own, never auto-synced. That's redundancy, not a second
	// parent: `parent` remains the one true nesting position, and it's what lets
	// a project view find sub-tasks without walking the whole tree.

	const createdAt = asDateTime(fm.createdAt);
	const updatedAt = asDateTime(fm.updatedAt);
	const archived = asBoolean(fm.archived, false);
	const archivedAt = asDateTime(fm.archivedAt);

	const task: Task = {
		type: "task",
		id: fileId,
		title: asString(fm.title) ?? fileId,
		taskType: asString(fm.taskType),
		status: status ?? options.defaultStatus,
		priority: asString(fm.priority),
		rank,
		project,
		parent,
		assignee: asString(fm.assignee),
		estimate: asNumber(fm.estimate),
		labels: asStringArray(fm.labels),
		startDate: asDate(fm.startDate),
		dueDate: asDate(fm.dueDate),
		// `archivedAt` alone is enough to mean archived — either field alone
		// counts, and a note carrying only the timestamp shouldn't reappear.
		archived: archived || archivedAt != null,
		archivedAt,
		relations: parseRelations(fm.relations),
		createdAt: createdAt ?? nowIso(),
		updatedAt: updatedAt ?? createdAt ?? nowIso(),
		path: options.path,
		mentions: options.mentions ?? [],
	};

	if (task.parent && task.parent === task.path) {
		log.add("Task is its own parent; parent cleared.");
		task.parent = null;
	}

	return { value: task, issues: log.issues };
}

export function parseRelations(raw: unknown): TaskRelations {
	if (raw == null) return emptyRelations();
	const record = asRecord(raw);
	return {
		blocks: parseLinkList(record.blocks),
		blockedBy: parseLinkList(record.blockedBy),
		related: parseLinkList(record.related),
		duplicateOf: parseLink(record.duplicateOf),
	};
}

function hasAnyRelation(relations: TaskRelations): boolean {
	return (
		relations.blocks.length > 0 ||
		relations.blockedBy.length > 0 ||
		relations.related.length > 0 ||
		relations.duplicateOf != null
	);
}

/**
 * Domain object → frontmatter object, ready for the YAML writer.
 *
 * Key order matters: it's what a human sees when they open the note, and it's
 * what git diffs line up against. Empty fields are dropped entirely rather than
 * written as `null`.
 */
export function serializeTask(task: Task): Record<string, unknown> {
	const base = compact({
		type: "task",
		taskType: task.taskType,
		id: task.id,
		title: task.title,
		status: task.status,
		priority: task.priority,
		rank: task.rank,
		project: formatLink(task.project),
		parent: formatLink(task.parent),
		assignee: task.assignee,
		estimate: task.estimate,
		labels: task.labels,
		startDate: task.startDate,
		dueDate: task.dueDate,
		archivedAt: task.archivedAt,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
	});

	// `archived` is written explicitly even when false: it's a toggle users look
	// for in the note, and an absent field reads as "unknown" rather than "no".
	base.archived = task.archived;

	if (hasAnyRelation(task.relations)) {
		base.relations = compact({
			blocks: formatLinkList(task.relations.blocks),
			blockedBy: formatLinkList(task.relations.blockedBy),
			related: formatLinkList(task.relations.related),
			duplicateOf: formatLink(task.relations.duplicateOf),
		});
	}

	return base;
}

/** Field order for the writer, so notes stay diff-stable across edits. */
export const TASK_FIELD_ORDER: readonly string[] = [
	"type",
	"taskType",
	"id",
	"title",
	"status",
	"priority",
	"rank",
	"project",
	"parent",
	"assignee",
	"estimate",
	"labels",
	"startDate",
	"dueDate",
	"archived",
	"archivedAt",
	"relations",
	"createdAt",
	"updatedAt",
] as const;
