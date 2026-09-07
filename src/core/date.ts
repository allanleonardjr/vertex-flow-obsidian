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
