/**
 * The Recurring Overview — every live recurrence definition in a workspace, in
 * one queried list for the Overview modal and its command.
 */

import type { IsoDate, RecurrenceConfig, Task, WorkspaceSnapshot } from "../types";
import { dayNumber } from "../views/timeline";
import { chainLength, chainMembers } from "./chain";
import { firstOccurrenceOnOrAfter } from "./engine";

export interface RecurringOverviewRow {
	task: Task;
	/** Fan-out plus the max backfill passes: how many occurrences exist already. */
	chainLength: number;
	/**
	 * The next date this series can surface: its own `nextDate` when still in
	 * the future, else the next future cadence point (an on-date series will
	 * backfill to today on the next reconcile). Status-driven (on-close) series
	 * always report `null` here — there is no calendar date to surface.
	 */
	nextDate: IsoDate | null;
	recurrence: RecurrenceConfig;
}

/**
 * One row per live chain, ordered by title then id — deterministic across
 * rebuilds, which the modal's render-key needs.
 *
 * Every spawned occurrence in a chain carries its own copy of the
 * recurrence block, so walking `snapshot.tasks` directly would produce one
 * row per occurrence ever created, not per series. Only the chain's
 * newest member is the one that will actually fire next, so that's the
 * only row worth surfacing — a `seen` set collapses every other member of
 * the same chain into it. An archived newest member is excluded
 * entirely: it can't spawn (see `spawnPlans`), so there's nothing live
 * left to report.
 */
export function recurringOverview(
	snapshot: WorkspaceSnapshot,
	today: IsoDate,
): RecurringOverviewRow[] {
	const rows: RecurringOverviewRow[] = [];
	const seen = new Set<string>();
	for (const task of snapshot.tasks) {
		if (!task.recurrence) continue;
		const members = chainMembers(snapshot, task);
		const newest = members[members.length - 1] ?? task;
		if (seen.has(newest.path)) continue;
		seen.add(newest.path);
		const rule = newest.recurrence;
		if (!rule || newest.archived) continue;

		const chain = chainLength(snapshot, newest);
		const nextDate =
			rule.trigger === "on-close"
				? null
				: dayNumber(rule.nextDate) >= dayNumber(today)
					? rule.nextDate
					: firstOccurrenceOnOrAfter(rule, rule.nextDate, today);
		rows.push({ task: newest, chainLength: chain, nextDate, recurrence: rule });
	}
	rows.sort(
		(a, b) =>
			a.task.title.localeCompare(b.task.title) ||
			a.task.id.localeCompare(b.task.id),
	);
	return rows;
}