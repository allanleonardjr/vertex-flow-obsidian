/**
 * Timeline (Gantt) view — pure geometry (§8.1, phase 3).
 *
 * Two jobs, both free of the DOM:
 *
 *   1. Turn a Task or Project into a `Bar` — the shape the view draws, deciding
 *      range vs. milestone vs. open vs. unscheduled purely from which dates are
 *      set.
 *   2. Do the drag math. The interaction layer converts pixels to whole days
 *      and calls `resizeStart` / `resizeEnd` / `shiftBar`; everything about how
 *      a drag changes dates lives here, so keyboard nudges and pointer drags
 *      share one source of truth.
 *
 * The clamping in `resizeStart` / `resizeEnd` is a **drag-interaction rule**,
 * not parse-time validation: it stops a drag from producing an inverted bar
 * (start after end). Task and Project frontmatter still parse `startDate` and
 * `dueDate` independently with no ordering check (the forgiving-parse
 * precedent). `taskBar` / `projectBar` therefore never throw on hand-edited
 * frontmatter with start after due — they normalise it to the same zero-length
 * bar the clamp would produce.
 */

import type { IsoDate, Project, Task } from "../types";

// ---------------------------------------------------------------------------
// Task partitioning
// ---------------------------------------------------------------------------

/**
 * Split tasks into those the Timeline can place on the chart (any date set)
 * and those it can't (the Unscheduled pane), preserving the incoming order
 * within each. The Timeline renders — and walks with the keyboard — scheduled
 * rows first, then unscheduled, so this is the one definition of that order.
 */
export function partitionScheduled(tasks: Task[]): {
	scheduled: Task[];
	unscheduled: Task[];
} {
	const scheduled: Task[] = [];
	const unscheduled: Task[] = [];
	for (const task of tasks) {
		if (taskBar(task).kind === "unscheduled") unscheduled.push(task);
		else scheduled.push(task);
	}
	return { scheduled, unscheduled };
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

export type Bar =
	| { kind: "range"; start: IsoDate; end: IsoDate }
	| { kind: "milestone"; date: IsoDate }
	/** `startDate` set, no `dueDate` — an open-ended bar. */
	| { kind: "open"; start: IsoDate }
	| { kind: "unscheduled" };

export type RangeBar = Extract<Bar, { kind: "range" }>;

// ---------------------------------------------------------------------------
// Day arithmetic
// ---------------------------------------------------------------------------

/** Milliseconds in one UTC day. Shared with `calendar.ts`'s month arithmetic. */
export const MS_PER_DAY = 86_400_000;

/**
 * Day numbers are clamped to a four-digit-year window so every result still
 * formats as a plain `YYYY-MM-DD` — `Date#toISOString` switches to an expanded
 * `±YYYYYY` year outside roughly ±271821, and even the ECMAScript limit would
 * corrupt the string `slice`. A runaway drag then degrades to the boundary
 * date instead of producing `Invalid Date` or a malformed string.
 */
const MIN_DAY = Math.round(Date.parse("1000-01-01T00:00:00Z") / MS_PER_DAY);
const MAX_DAY = Math.round(Date.parse("9999-12-31T00:00:00Z") / MS_PER_DAY);

function clampDay(day: number): number {
	if (day > MAX_DAY) return MAX_DAY;
	if (day < MIN_DAY) return MIN_DAY;
	return day;
}

/** Whole days from the epoch for the *date* portion of an ISO string (UTC). */
export function dayNumber(iso: IsoDate): number {
	// Take only `YYYY-MM-DD`, so a datetime and a bare date on the same day
	// land on the same column.
	const datePart = iso.slice(0, 10);
	const ms = Date.parse(`${datePart}T00:00:00Z`);
	if (Number.isNaN(ms)) return 0;
	return Math.round(ms / MS_PER_DAY);
}

/** Inverse of `dayNumber` — always a bare `YYYY-MM-DD`. */
export function isoFromDay(day: number): IsoDate {
	return new Date(clampDay(day) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Shift an ISO date by whole days, clamped to the representable range. */
export function addDays(iso: IsoDate, deltaDays: number): IsoDate {
	return isoFromDay(dayNumber(iso) + Math.trunc(deltaDays));
}

/** Whole days from `a` to `b` (`b - a`), date portions only. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
	return dayNumber(b) - dayNumber(a);
}

// ---------------------------------------------------------------------------
// Bar construction
// ---------------------------------------------------------------------------

function barFromDates(
	startDate: IsoDate | null,
	dueDate: IsoDate | null,
): Bar {
	if (startDate && dueDate) {
		// Forgiving parse means `start` can be after `due` in hand-edited
		// frontmatter. Normalise to the same zero-length bar the resize clamp
		// would produce rather than drawing an inverted one.
		if (dayNumber(startDate) > dayNumber(dueDate)) {
			return { kind: "range", start: dueDate, end: dueDate };
		}
		return { kind: "range", start: startDate, end: dueDate };
	}
	if (dueDate) return { kind: "milestone", date: dueDate };
	if (startDate) return { kind: "open", start: startDate };
	return { kind: "unscheduled" };
}

export function taskBar(task: Task): Bar {
	return barFromDates(task.startDate, task.dueDate);
}

export function projectBar(project: Project): Bar {
	return barFromDates(project.startDate, project.dueDate);
}

// ---------------------------------------------------------------------------
// Date range (the "All" zoom)
// ---------------------------------------------------------------------------

/** Every dated endpoint a bar contributes; `[]` for an unscheduled bar. */
function endpointsOf(bar: Bar): IsoDate[] {
	switch (bar.kind) {
		case "range":
			return [bar.start, bar.end];
		case "milestone":
			return [bar.date];
		case "open":
			return [bar.start];
		case "unscheduled":
			return [];
	}
}

/**
 * The min/max dates spanned by `bars`, ignoring unscheduled ones. `null` when
 * nothing is scheduled — the "All" zoom then has nothing to frame.
 */
export function dateRangeOf(bars: Bar[]): { min: IsoDate; max: IsoDate } | null {
	let min: number | null = null;
	let max: number | null = null;
	for (const bar of bars) {
		for (const iso of endpointsOf(bar)) {
			const day = dayNumber(iso);
			if (min === null || day < min) min = day;
			if (max === null || day > max) max = day;
		}
	}
	if (min === null || max === null) return null;
	return { min: isoFromDay(min), max: isoFromDay(max) };
}

// ---------------------------------------------------------------------------
// Drag math
// ---------------------------------------------------------------------------

/**
 * Move a range bar's `start` by `deltaDays`, clamped so it never passes `end`
 * — it clamps to `end` itself, giving a zero-length bar rather than an
 * inverted one.
 */
export function resizeStart(bar: RangeBar, deltaDays: number): Bar {
	const endDay = dayNumber(bar.end);
	const nextStartDay = Math.min(
		endDay,
		clampDay(dayNumber(bar.start) + Math.trunc(deltaDays)),
	);
	return { kind: "range", start: isoFromDay(nextStartDay), end: bar.end };
}

/**
 * Mirror of `resizeStart`: move `end` by `deltaDays`, clamped so it never
 * passes `start`.
 */
export function resizeEnd(bar: RangeBar, deltaDays: number): Bar {
	const startDay = dayNumber(bar.start);
	const nextEndDay = Math.max(
		startDay,
		clampDay(dayNumber(bar.end) + Math.trunc(deltaDays)),
	);
	return { kind: "range", start: bar.start, end: isoFromDay(nextEndDay) };
}

/**
 * Move every date in the bar by the same `deltaDays`, so a range bar's
 * duration is preserved exactly. Works for all four kinds: a milestone shifts
 * its one date, an open bar shifts `start`, a range shifts both, an
 * unscheduled bar is unchanged.
 *
 * Near the ends of the representable range the delta is shrunk (not each date
 * independently clamped) so the duration stays exact even when the bar can't
 * travel the full requested distance.
 */
export function shiftBar(bar: Bar, deltaDays: number): Bar {
	const days = endpointsOf(bar).map(dayNumber);
	if (days.length === 0) return bar;

	let delta = Math.trunc(deltaDays);
	for (const day of days) {
		// `clampDay(day + delta) - day` is the largest step from `day` that
		// stays in range; taking it for every endpoint leaves `delta` feasible
		// for all of them without ever changing the gap between them.
		delta = clampDay(day + delta) - day;
	}

	switch (bar.kind) {
		case "range":
			return {
				kind: "range",
				start: isoFromDay(dayNumber(bar.start) + delta),
				end: isoFromDay(dayNumber(bar.end) + delta),
			};
		case "milestone":
			return { kind: "milestone", date: isoFromDay(dayNumber(bar.date) + delta) };
		case "open":
			return { kind: "open", start: isoFromDay(dayNumber(bar.start) + delta) };
		case "unscheduled":
			return bar;
	}
}

// ---------------------------------------------------------------------------
// Committing a dragged bar back to frontmatter
// ---------------------------------------------------------------------------

/**
 * The `{ startDate, dueDate }` patch a bar represents — what the interaction
 * layer hands to `updateTask` / `updateProject` once, on drag release.
 */
export function barDates(bar: Bar): {
	startDate: IsoDate | null;
	dueDate: IsoDate | null;
} {
	switch (bar.kind) {
		case "range":
			return { startDate: bar.start, dueDate: bar.end };
		case "milestone":
			return { startDate: null, dueDate: bar.date };
		case "open":
			return { startDate: bar.start, dueDate: null };
		case "unscheduled":
			return { startDate: null, dueDate: null };
	}
}
