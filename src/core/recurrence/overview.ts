/**
 * The Recurring Overview — every live recurrence definition in a workspace, in
 * one queried list for the Overview modal and its command.
 */

import type { IsoDate, RecurrenceConfig, Task, WorkspaceSnapshot } from "../types";
import { dayNumber } from "../views/timeline";
import { chainLength } from "./chain";
import { firstOccurrenceOnOrAfter } from "./engine";

export interface RecurringOverviewRow {
	task: Task;
	/** Fan-out plus the max backfill passes: how many occurrences exist already. */
	chainLength: number;
	/**
	 * The next date this series can surface: its own `nextDate` when still in
	 * the future, else the next future cadence point (an on-date series will
	 * backfill to today on the next reconcile; an on-close will land there).
	 */
	nextDate: IsoDate | null;
	recurrence: RecurrenceConfig;
}

/** Every task carrying a recurrence in `snapshot`, ordered by title then id —
 *  deterministic across rebuilds, which the modal's render-key needs. */
export function recurringOverview(
	snapshot: WorkspaceSnapshot,
	today: IsoDate,
): RecurringOverviewRow[] {
	const rows: RecurringOverviewRow[] = [];
	for (const task of snapshot.tasks) {
		const rule = task.recurrence;
		if (!rule) continue;
		const chain = chainLength(snapshot, task);
		const nextDate =
			dayNumber(rule.nextDate) >= dayNumber(today)
				? rule.nextDate
				: firstOccurrenceOnOrAfter(rule, rule.nextDate, today);
		rows.push({ task, chainLength: chain, nextDate, recurrence: rule });
	}
	rows.sort(
		(a, b) =>
			a.task.title.localeCompare(b.task.title) ||
			a.task.id.localeCompare(b.task.id),
	);
	return rows;
}