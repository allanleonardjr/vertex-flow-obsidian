/**
 * Calendar view — pure day-bucketing (§8.1, phase 2).
 *
 * The Calendar is a *day-bucketing* view, not a range view: it drops each Task
 * onto the single day named by one chosen date field and paints a month grid.
 * That's the whole reason Projects stay out of it — a Project's authoritative
 * date *range* (§7.1) has nowhere to live on a day grid, and Timeline already
 * covers ranges.
 *
 * Day and month arithmetic is shared, not re-rolled: `dayNumber` / `isoFromDay`
 * / `MS_PER_DAY` come from `timeline.ts`, the peer module that already owns the
 * "turn an ISO string into a comparable integer, clamped to a four-digit year"
 * logic. Nothing here does string slicing to find a month.
 *
 * No drag math lives here either — dragging a chip reuses `taskBar` /
 * `shiftBar` / `barDates` from `timeline.ts` as-is (a chip move is a Timeline
 * body-drag with a whole-day delta); only the pixel→cell hit-test belongs to
 * the UI layer.
 */

import type { IsoDate, Task } from "../types";
import { MS_PER_DAY, dayNumber, isoFromDay } from "./timeline";

export type CalendarDateField = "dueDate" | "startDate";

// ---------------------------------------------------------------------------
// Anchoring a task to a day
// ---------------------------------------------------------------------------

/**
 * The day this task sits on for the given toggle, or `null` if it has no value
 * in *that* field.
 *
 * A direct read of the selected field only — a task with `startDate` set but no
 * `dueDate` is unscheduled under the "Due" toggle, never quietly borrowed from
 * its start date, or the toggle would stop meaning what it says. Normalised to
 * a bare `YYYY-MM-DD` so bucket keys are canonical even when a field holds a
 * full datetime.
 */
export function calendarAnchor(
	task: Task,
	field: CalendarDateField,
): IsoDate | null {
	const value = task[field];
	return value ? value.slice(0, 10) : null;
}

/** Group tasks by the day their selected field lands on. Order within a day is preserved. */
export function bucketByDay(
	tasks: Task[],
	field: CalendarDateField,
): Map<IsoDate, Task[]> {
	const buckets = new Map<IsoDate, Task[]>();
	for (const task of tasks) {
		const anchor = calendarAnchor(task, field);
		if (!anchor) continue;
		const bucket = buckets.get(anchor);
		if (bucket) bucket.push(task);
		else buckets.set(anchor, [task]);
	}
	return buckets;
}

/** The complement of `bucketByDay` — tasks with no value in the selected field. */
export function unscheduledForCalendar(
	tasks: Task[],
	field: CalendarDateField,
): Task[] {
	return tasks.filter((task) => calendarAnchor(task, field) === null);
}

// ---------------------------------------------------------------------------
// Month arithmetic (built on timeline.ts's day numbers)
// ---------------------------------------------------------------------------

/** Whole days from the epoch for the 1st of the month containing `day`. */
function monthStartDay(day: number): number {
	const d = new Date(day * MS_PER_DAY);
	return Math.round(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / MS_PER_DAY,
	);
}

/** `monthStartDay`, shifted by `n` whole months. */
function addMonthsDay(day: number, n: number): number {
	const d = new Date(day * MS_PER_DAY);
	return Math.round(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) / MS_PER_DAY,
	);
}

/**
 * Normalise any date to the 1st of its month.
 *
 * `visibleMonth` is always stored this way — from prev, next, or Today — so the
 * furniture has one representation, the same discipline `canonicalizeFilters` /
 * `canonicalizeHiddenFields` apply elsewhere. Built on `dayNumber` /
 * `isoFromDay`, not string slicing.
 */
export function startOfMonth(date: IsoDate): IsoDate {
	return isoFromDay(monthStartDay(dayNumber(date)));
}

/**
 * The day cells for a month view: the month itself plus the leading/trailing
 * days from adjacent months needed to fill whole weeks. Weeks start on Sunday
 * (`getUTCDay` 0), so the result is 28–42 cells — 28 only for a non-leap
 * February that begins on a Sunday.
 */
export function monthGrid(month: IsoDate): IsoDate[] {
	const first = monthStartDay(dayNumber(month));
	const lastDay = addMonthsDay(first, 1) - 1;

	const leading = new Date(first * MS_PER_DAY).getUTCDay();
	const trailing = 6 - new Date(lastDay * MS_PER_DAY).getUTCDay();

	const cells: IsoDate[] = [];
	for (let day = first - leading; day <= lastDay + trailing; day += 1) {
		cells.push(isoFromDay(day));
	}
	return cells;
}
