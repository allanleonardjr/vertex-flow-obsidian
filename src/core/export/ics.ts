/**
 * RFC 5545 iCalendar, hand-rolled (no npm dependency).
 *
 * One `VEVENT` per task. Dates are date-only (`VALUE=DATE`), matching `IsoDate`
 * — no times, no timezones. `DTEND` for a date-only event is *exclusive* per
 * RFC 5545 §3.6.1, so a task due through a given day gets `DTEND` = the day
 * after. `STATUS` carries the workspace's status *name*
 * verbatim: nonstandard against RFC 5545's fixed enum, but a calendar app that
 * doesn't recognize the value just ignores the property, and a readable status
 * beats dropping the field.
 */

import { addDays } from "../views";

const CRLF = "\r\n";

export interface IcsRow {
	uid: string;
	summary: string;
	/** Workspace status name, emitted verbatim. */
	status?: string;
	/** `YYYY-MM-DD` — becomes `DTSTART;VALUE=DATE`. */
	start?: string;
	/** `YYYY-MM-DD` — becomes the (exclusive) `DTEND;VALUE=DATE`. */
	due?: string;
	/** ISO datetime — becomes `DTSTAMP` (UTC). */
	stamp: string;
	description?: string;
}

export interface IcsOptions {
	/** `PRODID` value; defaults to the plugin. */
	prodId?: string;
}

/** RFC 5545 §3.3.11 text escaping. */
function escapeText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\r\n|\r|\n/g, "\\n")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,");
}

/** `2026-08-26T14:45:00Z` → `20260826T144500Z`. */
function toUtcStamp(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
	}
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
		`T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
	);
}

/** `2026-08-26` → `20260826`. */
function toDateValue(day: string): string {
	return day.replace(/-/g, "");
}

/** Fold a content line to <= 75 octets, continuation lines starting with a space. */
function foldLine(line: string): string {
	const encoder = new TextEncoder();
	if (encoder.encode(line).length <= 75) return line;

	const out: string[] = [];
	let current = "";
	let currentBytes = 0;
	for (const char of line) {
		const charBytes = encoder.encode(char).length;
		// Continuation lines carry a leading space, so their budget is 74.
		const limit = out.length === 0 ? 75 : 74;
		if (currentBytes + charBytes > limit) {
			out.push(current);
			current = "";
			currentBytes = 0;
		}
		current += char;
		currentBytes += charBytes;
	}
	if (current) out.push(current);
	return out.join(`${CRLF} `);
}

function line(name: string, value: string): string {
	return foldLine(`${name}:${value}`);
}

export function buildIcs(rows: IcsRow[], opts: IcsOptions = {}): string {
	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`PRODID:${opts.prodId ?? "-//Vertex Flow//Task Export//EN"}`,
		"CALSCALE:GREGORIAN",
	];

	for (const row of rows) {
		lines.push("BEGIN:VEVENT");
		lines.push(line("UID", row.uid));
		lines.push(line("DTSTAMP", toUtcStamp(row.stamp)));
		lines.push(line("SUMMARY", escapeText(row.summary)));
		// `DUE` is a VTODO-only property — invalid on a VEVENT, so a compliant
		// client silently drops it. Use an exclusive date-only `DTEND` instead.
		if (row.start && row.due) {
			if (toDateValue(row.due) < toDateValue(row.start)) {
				// Inverted dates (bad data): fall back to a single-day event on
				// `start` rather than emitting DTEND before DTSTART.
				lines.push(`DTSTART;VALUE=DATE:${toDateValue(row.start)}`);
				lines.push(`DTEND;VALUE=DATE:${toDateValue(addDays(row.start, 1))}`);
			} else {
				lines.push(`DTSTART;VALUE=DATE:${toDateValue(row.start)}`);
				lines.push(`DTEND;VALUE=DATE:${toDateValue(addDays(row.due, 1))}`);
			}
		} else if (row.start) {
			lines.push(`DTSTART;VALUE=DATE:${toDateValue(row.start)}`);
		} else if (row.due) {
			lines.push(`DTSTART;VALUE=DATE:${toDateValue(row.due)}`);
			lines.push(`DTEND;VALUE=DATE:${toDateValue(addDays(row.due, 1))}`);
		}
		if (row.status) lines.push(line("STATUS", escapeText(row.status)));
		if (row.description) {
			lines.push(line("DESCRIPTION", escapeText(row.description)));
		}
		lines.push("END:VEVENT");
	}

	lines.push("END:VCALENDAR");
	return lines.join(CRLF) + CRLF;
}
