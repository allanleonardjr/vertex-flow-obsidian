/**
 * Speculative projection — the `show:recurring` preview.
 *
 * Given the live nodes of a workspace's recurring series, synthesise the ghost
 * occurrences a view can render *ahead* of the reconcile engine actually
 * spawning them. These `Task`s carry `projected: true`, a synthetic `path`, and
 * no `recurrence` block; they are never written to the vault and never a
 * drag/rank/select target (the view layer guards that).
 *
 * Two horizons, matching how the two triggers behave:
 *
 * - **on-date** — the schedule is deterministic, so project every cadence point
 *   from today out to `PROJECTION_HORIZON_DAYS`, capped at `PROJECTION_MAX`.
 * - **on-close** — nothing lands until the current occurrence is closed, and
 *   *when* that happens is unknown, so only the single next landing is shown.
 *   Anything past that would be pure guesswork.
 *
 * `endsOn` / `endsAfter` are honoured: a finite series stops projecting once
 * its budget (chain length included) is spent.
 */

import { rankAfter } from "../ranking";
import type { IsoDate, RecurrenceConfig, Task, WorkspaceSnapshot } from "../types";
import { emptyRelations } from "../types";
import { addDays, dayNumber } from "../views/timeline";
import { chainLength, chainMembers } from "./chain";
import {
	cadencePoints,
	firstOccurrenceOnOrAfter,
	shiftOccurrenceDates,
} from "./engine";

/** How far ahead an on-date series is projected. */
export const PROJECTION_HORIZON_DAYS = 30;
/** The hard cap on ghost rows per series, whatever the horizon yields. */
export const PROJECTION_MAX = 12;

/**
 * Ghost occurrences for every series a member of `matched` belongs to.
 *
 * `matched` is the post-filter task list — so a series only previews when one
 * of its real notes already passes the view's filters. Each series is projected
 * once, from its newest chain member (the node the reconcile engine will
 * actually advance), regardless of which member matched.
 */
export function projectRecurrences(
	snapshot: WorkspaceSnapshot,
	matched: readonly Task[],
	today: IsoDate,
): Task[] {
	const out: Task[] = [];
	const seen = new Set<string>();

	for (const task of matched) {
		if (!task.recurrence) continue;
		const members = chainMembers(snapshot, task);
		const source = members[members.length - 1] ?? task;
		if (seen.has(source.path)) continue;
		seen.add(source.path);
		if (!source.recurrence) continue;
		out.push(...projectSeries(snapshot, source, today));
	}

	return out;
}

/** The ghost occurrences projected forward from one live series node. */
export function projectSeries(
	snapshot: WorkspaceSnapshot,
	source: Task,
	today: IsoDate,
): Task[] {
	const rule = source.recurrence;
	if (!rule) return [];

	let days: IsoDate[];
	if (rule.trigger === "on-close") {
		days = [firstOccurrenceOnOrAfter(rule, rule.nextDate, today)];
	} else {
		const horizon = addDays(today, PROJECTION_HORIZON_DAYS);
		days = cadencePoints(rule, rule.nextDate, horizon).filter(
			(day) => dayNumber(day) >= dayNumber(today),
		);
	}

	if (rule.endsOn) {
		const limit = dayNumber(rule.endsOn);
		days = days.filter((day) => dayNumber(day) <= limit);
	}

	if (rule.endsAfter != null) {
		const remaining = Math.max(
			0,
			rule.endsAfter - chainLength(snapshot, source),
		);
		days = days.slice(0, remaining);
	}

	days = days.slice(0, PROJECTION_MAX);

	let rank = source.rank;
	return days.map((day, index) => {
		rank = rankAfter(rank);
		return ghost(snapshot, source, rule, day, index, rank);
	});
}

function ghost(
	snapshot: WorkspaceSnapshot,
	source: Task,
	rule: RecurrenceConfig,
	day: IsoDate,
	index: number,
	rank: string,
): Task {
	const { startDate, dueDate } = shiftOccurrenceDates(source, rule.anchor, day);
	return {
		...source,
		id: `${source.id}~${index + 1}`,
		status: rule.newStatus ?? snapshot.workspace.defaultNewTaskStatus,
		rank,
		recurringFrom: source.path,
		recurrence: null,
		startDate,
		dueDate,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: source.createdAt,
		updatedAt: source.updatedAt,
		path: `${source.path}/occ/${index + 1}`,
		mentions: [],
		projected: true,
	};
}
