/**
 * Calendar-day helpers shared by the recurrence glue and its UI.
 *
 * Recurrence reasons in the user's *local* calendar day — closing a daily task
 * late in the evening must advance the chain now, not wait for UTC midnight — so
 * this is deliberately not `nowIso()` (which is an instant, in UTC).
 */

import type { IsoDate } from "./types";

/** Today in the user's own calendar, as the `YYYY-MM-DD` string tasks carry in
 *  frontmatter. `now` is injectable so callers (and tests) can pin it. */
export function localTodayIso(now: Date = new Date()): IsoDate {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The current local time as `HHMMSS`, zero-padded — paired with
 *  `localTodayIso` in export filenames so two exports made on the same day
 *  never collide without leaning on a numeric-suffix fallback. `now` is
 *  injectable, same as `localTodayIso`. */
export function localTimeStamp(now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** True for a real calendar day in YYYY-MM-DD form — rejects malformed
 *  strings (`2026-9-1`) and non-existent days (`2026-02-30`) without a
 *  date library, by round-tripping through `Date` and checking the y/m/d
 *  it reports back matches what was asked for. */
export function isValidIsoDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface DueDateStatus {
	isToday: boolean;
	isOverdue: boolean;
}

/** Today/overdue treatment for a due date — shared by every place a due date
 *  renders (List rows, Board cards, Calendar chips, Timeline labels, Table
 *  cells) so the badge can't drift between them. A completed or canceled
 *  task is never "overdue" or "due today" — that's the caller's `isOpen`. */
export function dueDateStatus(
	dueDate: IsoDate | null,
	isOpen: boolean,
	today: IsoDate = localTodayIso(),
): DueDateStatus {
	if (!dueDate) return { isToday: false, isOverdue: false };
	return {
		isToday: dueDate === today && isOpen,
		isOverdue: dueDate < today && isOpen,
	};
}
