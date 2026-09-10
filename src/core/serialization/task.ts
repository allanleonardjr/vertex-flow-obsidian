/**
 * Task frontmatter ↔ domain object.
 *
 * `parseTask` takes the *already-parsed* YAML object, never a string — that's
 * what keeps this module free of the Obsidian API (and of a YAML dependency)
 * while still being the thing unit tests exercise.
 */

import { basename, formatLink, formatLinkList, parseLink, parseLinkList } from "../links";
import { MIDDLE_RANK, isValidRank } from "../ranking/lexorank";
import {
  emptyRelations,
  type OnCloseDateMode,
  type RecurrenceAnchor,
  type RecurrenceConfig,
  type RecurrenceFrequency,
  type RecurrenceTrigger,
  type StatusValue,
  type Task,
  type TaskFieldKey,
  type TaskRelations,
  type Weekday,
} from "../types";
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
	/**
	 * The workspace's configured statuses. Used to validate recurrence
	 * `triggerStatus`/`newStatus` references (an unknown one falls back with an
	 * issue rather than silently never firing).
	 */
	statuses?: readonly StatusValue[];
}

const FREQUENCIES: readonly RecurrenceFrequency[] = [
	"daily",
	"weekly",
	"monthly",
	"yearly",
];
const TRIGGERS: readonly RecurrenceTrigger[] = ["on-close", "on-date"];

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
	sun: "sun",
	sunday: "sun",
	mon: "mon",
	monday: "mon",
	tue: "tue",
	tues: "tue",
	tuesday: "tue",
	wed: "wed",
	wednesday: "wed",
	thu: "thu",
	thur: "thu",
	thurs: "thu",
	thursday: "thu",
	fri: "fri",
	friday: "fri",
	sat: "sat",
	saturday: "sat",
};

function parseWeekdays(raw: unknown, log: IssueLog): Weekday[] {
	const out: Weekday[] = [];
	let items: string[];
	if (Array.isArray(raw)) {
		items = raw.filter((item): item is string => typeof item === "string");
	} else {
		items = asString(raw)
			?.split(/[\s,]+/)
			.filter(Boolean) ?? [];
	}
	for (const item of items) {
		const day = WEEKDAY_BY_NAME[item.trim().toLowerCase()];
		if (day) {
			if (!out.includes(day)) out.push(day);
		} else {
			log.add(`Recurrence weekday "${item}" is not a day name; ignoring it.`);
		}
	}
	return out;
}

function clampInt(
	raw: unknown,
	min: number,
	max: number,
	log: IssueLog,
	label: string,
): number | null {
	const value = asNumber(raw);
	if (value == null) return null;
	const clamped = Math.trunc(value);
	if (clamped < min || clamped > max) {
		log.add(`Recurrence ${label} ${value} is out of range; ignoring it.`);
		return null;
	}
	return clamped;
}

/**
 * Frontmatter → RecurrenceConfig. Forgiving: an unparseable or invalid
 * recurrence is dropped (with an issue) rather than crashing the note, and
 * unknown status references fall back the same way so a deleted status can't
 * silently freeze a series. Returns `null` when the field is absent.
 */
export function parseRecurrence(
	raw: unknown,
	log: IssueLog,
	statuses: readonly StatusValue[],
): RecurrenceConfig | null {
	if (raw == null) return null;
	const record = asRecord(raw);

	const freq = asString(record.freq) as RecurrenceFrequency | null;
	if (!freq || !FREQUENCIES.includes(freq)) {
		log.add("Recurrence dropped: unknown frequency.");
		return null;
	}

	const trigger = asString(record.trigger) as RecurrenceTrigger | null;
	if (trigger && !TRIGGERS.includes(trigger)) {
		log.add(`Recurrence trigger "${trigger}" is invalid; dropped.`);
		return null;
	}

	const nextDate = asDate(record.nextDate);
	if (!nextDate) {
		log.add("Recurrence dropped: missing nextDate.");
		return null;
	}

	const intervalRaw = asNumber(record.interval);
	const interval =
		intervalRaw == null ? 1 : Math.max(1, Math.trunc(intervalRaw));
	if (intervalRaw != null && intervalRaw < 1) {
		log.add(`Recurrence interval ${intervalRaw} clamped to 1.`);
	}

	const endsAfterRaw = asNumber(record.endsAfter);
	let endsAfter: number | null = null;
	if (endsAfterRaw != null) {
		if (endsAfterRaw >= 1) endsAfter = Math.trunc(endsAfterRaw);
		else log.add(`Recurrence endsAfter ${endsAfterRaw} is invalid; ignoring it.`);
	}

	let triggerStatus = asString(record.triggerStatus);
	if (triggerStatus && statuses.length > 0 && !statuses.some((s) => s.id === triggerStatus)) {
		log.add(
			`Recurrence triggerStatus "${triggerStatus}" is not a configured status; falling back to "any completed".`,
		);
		triggerStatus = null;
	}

	let newStatus = asString(record.newStatus);
	if (newStatus && statuses.length > 0 && !statuses.some((s) => s.id === newStatus)) {
		log.add(
			`Recurrence newStatus "${newStatus}" is not a configured status; falling back to the workspace default.`,
		);
		newStatus = null;
	}

	const anchorRaw = asString(record.anchor);
	let anchor: RecurrenceAnchor = "dueDate";
	if (anchorRaw === "startDate") anchor = "startDate";
	else if (anchorRaw && anchorRaw !== "dueDate") {
		log.add(`Recurrence anchor "${anchorRaw}" is invalid; defaulting to dueDate.`);
	}

	const parseOnCloseMode = (
		value: unknown,
		label: string,
	): OnCloseDateMode | undefined => {
		const raw = asString(value);
		if (raw == null) return undefined;
		if (raw === "none" || raw === "immediate" || raw === "shifted") return raw;
		log.add(`Recurrence ${label} "${raw}" is invalid; ignoring it.`);
		return undefined;
	};
	const onCloseStartDateMode = parseOnCloseMode(
		record.onCloseStartDateMode,
		"onCloseStartDateMode",
	);
	const onCloseDueDateMode = parseOnCloseMode(
		record.onCloseDueDateMode,
		"onCloseDueDateMode",
	);

const dayOfMonth = clampInt(record.dayOfMonth, 1, 31, log, "dayOfMonth");
 	let weekdayOfMonth = clampInt(record.weekdayOfMonth, 1, 5, log, "weekdayOfMonth");
 	if (dayOfMonth != null && weekdayOfMonth != null) {
 		log.add(
 			"Recurrence has both dayOfMonth and weekdayOfMonth; using dayOfMonth.",
 		);
 		weekdayOfMonth = null;
 	}
 	const monthOfYear = clampInt(record.monthOfYear, 1, 12, log, "monthOfYear");

 	const copyFieldsRaw = asStringArray(record.copyFields);
 	const copyFields = (copyFieldsRaw && copyFieldsRaw.length > 0
 		? copyFieldsRaw
 		: null) as TaskFieldKey[] | null;

 	return {
 		trigger: trigger ?? "on-close",
 		triggerStatus,
 		freq,
 		interval,
 		weekdays: parseWeekdays(record.weekdays, log),
 		dayOfMonth,
 		weekdayOfMonth,
 		monthOfYear,
 		anchor,
		onCloseStartDateMode,
		onCloseDueDateMode,
 		newStatus,
 		endsAfter,
 		endsOn: asDate(record.endsOn),
 		nextDate,
 		copyFields,
 	};
 }

/** RecurrenceConfig → frontmatter object, with the empty guts compacted away. */
export function serializeRecurrence(rule: RecurrenceConfig): Record<string, unknown> {
	return compact({
		trigger: rule.trigger,
		triggerStatus: rule.triggerStatus,
		freq: rule.freq,
		interval: rule.interval,
		weekdays: rule.weekdays.length > 0 ? rule.weekdays : undefined,
		dayOfMonth: rule.dayOfMonth,
		weekdayOfMonth: rule.weekdayOfMonth,
		monthOfYear: rule.monthOfYear,
		anchor: rule.anchor,
		onCloseStartDateMode: rule.onCloseStartDateMode,
		onCloseDueDateMode: rule.onCloseDueDateMode,
		newStatus: rule.newStatus,
		endsAfter: rule.endsAfter,
		endsOn: rule.endsOn,
		nextDate: rule.nextDate,
		copyFields: rule.copyFields,
	});
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
	const recurringFrom = parseLink(fm.recurringFrom);
	const recurrence = parseRecurrence(
		fm.recurrence,
		log,
		options.statuses ?? [],
	);

	// `parent` and `project` are independent fields. A sub-task carries its own
	// `project` link — seeded from its parent at creation, then maintained on
	// its own, never auto-synced. That's redundancy, not a second
	// parent: `parent` remains the one true nesting position, and it's what lets
	// a project view find sub-tasks without walking the whole tree.

	const createdAt = asDateTime(fm.createdAt);
	const updatedAt = asDateTime(fm.updatedAt);
	const completedAt = asDateTime(fm.completedAt) ?? null;
	const archived = asBoolean(fm.archived, false);
	const archivedAt = asDateTime(fm.archivedAt);

	const task: Task = {
		type: "vertex-flow-task",
		id: fileId,
		title: asString(fm.title) ?? "",
		taskType: asString(fm.taskType),
		status: status ?? options.defaultStatus,
		priority: asString(fm.priority),
		rank,
		project,
		parent,
		recurringFrom,
		assignee: asString(fm.assignee),
		estimate: asNumber(fm.estimate),
		labels: asStringArray(fm.labels),
		startDate: asDate(fm.startDate),
		dueDate: asDate(fm.dueDate),
		recurrence,
		// `archivedAt` alone is enough to mean archived — either field alone
		// counts, and a note carrying only the timestamp shouldn't reappear.
		archived: archived || archivedAt != null,
		archivedAt,
		relations: parseRelations(fm.relations),
		createdAt: createdAt ?? nowIso(),
		updatedAt: updatedAt ?? createdAt ?? nowIso(),
		completedAt,
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
		type: "vertex-flow-task",
		taskType: task.taskType,
		id: task.id,
		title: task.title || undefined,
		status: task.status,
		priority: task.priority,
		rank: task.rank,
		project: formatLink(task.project),
		parent: formatLink(task.parent),
		recurringFrom: formatLink(task.recurringFrom),
		assignee: task.assignee,
		estimate: task.estimate,
		labels: task.labels,
		startDate: task.startDate,
		dueDate: task.dueDate,
		recurrence: task.recurrence
			? serializeRecurrence(task.recurrence)
			: undefined,
		archivedAt: task.archivedAt,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		completedAt: task.completedAt,
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
	"recurringFrom",
	"assignee",
	"estimate",
	"labels",
	"startDate",
	"dueDate",
	"recurrence",
	"archived",
	"archivedAt",
	"relations",
	"createdAt",
	"updatedAt",
	"completedAt",
] as const;
