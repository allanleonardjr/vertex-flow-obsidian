/**
 * The recurrence cadence engine — pure date math, no Obsidian coupling.
 *
 * One deterministic rule drives everything: `nextOccurrence(rule, from)` is the
 * next cadence point strictly after `from`. Spawning, backfill, ends checks and
 * Calendar/Timeline projection all reduce to walking that sequence, so there is
 * exactly one definition of "what's next" in the codebase.
 *
 * Weekly-with-weekdays is only honored at `interval === 1`: a multi-week
 * cadence steps whole weeks from the seed date, so there is no week-block phase
 * to record or drift. A monthly "Nth weekday" and the yearly cadence anchor
 * their phase to the node's own weekday, which is constant down a chain.
 */

import type {
	IsoDate,
	RecurrenceConfig,
	RecurrenceAnchor,
	Weekday,
} from "../types";
import {
	MS_PER_DAY,
	addDays,
	dayNumber,
	daysBetween,
	isoFromDay,
} from "../views/timeline";
import { addMonthsDay } from "../views/calendar";

/** On-date gap policy: backfill at most this many missed occurrences in one pass. */
export const MAX_RECURRENCE_BACKFILL = 14;

const DAY_OF_WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export const WEEKDAY_INDEX: Record<Weekday, number> = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
};

const WEEKDAY_NAMES: Record<Weekday, string> = {
	sun: "Sunday",
	mon: "Monday",
	tue: "Tuesday",
	wed: "Wednesday",
	thu: "Thursday",
	fri: "Friday",
	sat: "Saturday",
};

export function weekdayName(day: Weekday): string {
	return WEEKDAY_NAMES[day];
}

/** The weekday a bare/ISO date falls on. */
export function weekdayOf(iso: IsoDate): Weekday {
	const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
	return DAY_OF_WEEK[d.getUTCDay()];
}

/** The weekday an ISO date falls on, as `getUTCDay()`'s 0–6. */
function weekdayIndex(iso: IsoDate): number {
	return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

function daysInMonth(year: number, month1to12: number): number {
	return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * The last valid day of the month `interval` months after the month containing
 * `fromDay`, holding day-of-month `dayOfMonth`. Clamps 31st-style schedules to
 * the month's real length — the standard calendar-app behavior.
 */
function monthlyDay(
	fromDay: number,
	interval: number,
	dayOfMonth: number,
): number {
	const first = addMonthsDay(fromDay, interval);
	const d = new Date(first * MS_PER_DAY);
	const year = d.getUTCFullYear();
	const month = d.getUTCMonth();
	const lastDay = daysInMonth(year, month + 1);
	return Date.UTC(year, month, Math.min(dayOfMonth, lastDay)) / MS_PER_DAY;
}

/**
 * The nth (1-based) occurrence of `weekday` in the month starting at
 * `firstOfMonth` (a day number landing on the 1st). Returns the day number, or
 * -1 when that nth weekday doesn't exist in the month (e.g. a 5th Tuesday in
 * a short February).
 */
function nthWeekdayOfMonth(
	firstOfMonthDay: number,
	nth: number,
	weekday: number,
): number {
	const first = new Date(firstOfMonthDay * MS_PER_DAY);
	const offset = (weekday - first.getUTCDay() + 7) % 7;
	const day = 1 + offset + (nth - 1) * 7;
	const lastDay = daysInMonth(first.getUTCFullYear(), first.getUTCMonth() + 1);
	if (day > lastDay) return -1;
	return firstOfMonthDay + (day - 1);
}

/** The last (or "5th-that-doesn't-exist" fallback) occurrence of `weekday` in
 *  the month starting at `firstOfMonth`. Defensive only — three consecutive
 *  months can't all lack an nth weekday below the 5th. */
function lastWeekdayOfMonth(firstOfMonthDay: number, weekday: number): number {
	const lastDay = addMonthsDay(firstOfMonthDay, 1) - 1;
	const back = (weekdayIndex(isoFromDay(lastDay)) - weekday + 7) % 7;
	return lastDay - back;
}

/**
 * The next cadence point **strictly after** `from`.
 *
 * `from` is expected to already sit on the cadence (it's the node's `nextDate`
 * or a previous occurrence), so no "are we on a point?" reconciliation is
 * needed — this is a pure forward step.
 */
export function nextOccurrence(
	rule: RecurrenceConfig,
	from: IsoDate,
): IsoDate {
	const interval = Math.max(1, rule.interval);
	const fromDay = dayNumber(from);

	switch (rule.freq) {
		case "daily":
			return addDays(from, interval);

		case "weekly": {
			if (interval === 1 && rule.weekdays.length > 0) {
				// The next day, within seven, whose weekday is in the pattern.
				const wanted = new Set(rule.weekdays.map((w) => WEEKDAY_INDEX[w]));
				let day = fromDay + 1;
				for (let i = 0; i < 7; i += 1, day += 1) {
					if (wanted.has(new Date(day * MS_PER_DAY).getUTCDay())) {
						return isoFromDay(day);
					}
				}
				// Unreachable: seven consecutive days cover every weekday.
			}
			return addDays(from, 7 * interval);
		}

		case "monthly": {
			if (rule.dayOfMonth != null) {
				return isoFromDay(monthlyDay(fromDay, interval, rule.dayOfMonth));
			}
			if (rule.weekdayOfMonth != null) {
				const weekday = weekdayIndex(from);
				// Skip a candidate month whose nth weekday doesn't exist,
				// trying up to three months out (a 5th weekday missing twice in
				// a row is possible across Feb + a long month).
				for (let attempt = 0; attempt < 3; attempt += 1) {
					const first = addMonthsDay(fromDay, interval + attempt);
					const day = nthWeekdayOfMonth(
						first,
						rule.weekdayOfMonth,
						weekday,
					);
					if (day !== -1) return isoFromDay(day);
				}
				return isoFromDay(lastWeekdayOfMonth(fromDay, weekday));
			}
			// No day pattern: keep the seed's own day-of-month, clamped.
			const seedDay = new Date(fromDay * MS_PER_DAY).getUTCDate();
			return isoFromDay(monthlyDay(fromDay, interval, seedDay));
		}

		case "yearly": {
			const seed = new Date(fromDay * MS_PER_DAY);
			const year = seed.getUTCFullYear() + interval;
			if (rule.weekdayOfMonth != null) {
				const weekday = weekdayIndex(from);
				const month = rule.monthOfYear ?? seed.getUTCMonth() + 1;
				const first = isoFromDay(Date.UTC(year, month - 1, 1) / MS_PER_DAY);
				const day = nthWeekdayOfMonth(
					dayNumber(first),
					rule.weekdayOfMonth,
					weekday,
				);
				if (day !== -1) return isoFromDay(day);
				return isoFromDay(lastWeekdayOfMonth(dayNumber(first), weekday));
			}
			const month = rule.monthOfYear ?? seed.getUTCMonth() + 1;
			const dayOfMonth =
				rule.dayOfMonth ?? seed.getUTCDate();
			const lastDay = daysInMonth(year, month);
			return isoFromDay(
				Date.UTC(year, month - 1, Math.min(dayOfMonth, lastDay)) /
					MS_PER_DAY,
			);
		}
	}
}

/**
 * Every cadence point from `start` (inclusive) that lies on or before
 * `through`. `start` itself counts as a point — a node's `nextDate` is by
 * construction a cadence point.
 */
export function cadencePoints(
	rule: RecurrenceConfig,
	start: IsoDate,
	through: IsoDate,
): IsoDate[] {
	const out: IsoDate[] = [];
	const throughDay = dayNumber(through);
	let current = start;
	for (let guard = 0; guard < 5000; guard += 1) {
		if (dayNumber(current) > throughDay) break;
		out.push(current);
		current = nextOccurrence(rule, current);
	}
	return out;
}

/**
 * The first cadence point **on or after** `target`, walking forward from
 * `start`. When `start` is already past `target` it is itself the answer — that
 * is what makes `on-close` never spawn "in the past" while still landing
 * exactly on cadence points.
 */
export function firstOccurrenceOnOrAfter(
	rule: RecurrenceConfig,
	start: IsoDate,
	target: IsoDate,
): IsoDate {
	let current = start;
	for (let guard = 0; guard < 5000; guard += 1) {
		if (dayNumber(current) >= dayNumber(target)) return current;
		current = nextOccurrence(rule, current);
	}
	return current;
}

/** The next `count` occurrence dates from `from` (inclusive) — the virtual
 *  projection Calendar/Timeline previews are built from. */
export function projectOccurrences(
	rule: RecurrenceConfig,
	from: IsoDate,
	count: number,
): IsoDate[] {
	const out: IsoDate[] = [];
	let current = from;
	for (let i = 0; i < count; i += 1) {
		out.push(current);
		current = nextOccurrence(rule, current);
	}
	return out;
}

/**
 * Shift a source task's date range so its `anchor` field lands on `day`,
 * preserving the range length exactly. A single-field task keeps whichever
 * field it has; an anchor naming a field the source doesn't set falls back to
 * the other (a due-anchored recurrence on a start-only task lands on its
 * start). No dates means the spawned occurrence has none — also fine.
 */
export function shiftOccurrenceDates(
	source: { startDate: IsoDate | null; dueDate: IsoDate | null },
	anchor: RecurrenceAnchor,
	day: IsoDate,
): { startDate: IsoDate | null; dueDate: IsoDate | null } {
	const { startDate, dueDate } = source;
	const anchorDate = anchor === "dueDate" ? dueDate : startDate;
	const effective = anchorDate ?? (anchor === "dueDate" ? startDate : dueDate);
	const delta = effective ? daysBetween(effective, day) : 0;
	return {
		startDate: startDate ? addDays(startDate, delta) : null,
		dueDate: dueDate ? addDays(dueDate, delta) : null,
	};
}