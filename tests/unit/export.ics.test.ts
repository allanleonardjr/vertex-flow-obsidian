import { describe, expect, it } from "vitest";
import { buildIcs, type IcsRow } from "../../src/core/export/ics";

function lines(ics: string): string[] {
	return ics.split("\r\n");
}

describe("buildIcs", () => {
	it("wraps VEVENTs in a VCALENDAR with CRLF endings", () => {
		const out = buildIcs([]);
		expect(out.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
		expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
	});

	it("emits a start+due event with an exclusive date-only DTEND and a UTC DTSTAMP", () => {
		const row: IcsRow = {
			uid: "TSK-1@vertex-flow",
			summary: "Ship it",
			start: "2026-08-20",
			due: "2026-08-28",
			stamp: "2026-08-26T14:45:00Z",
		};
		const l = lines(buildIcs([row]));
		expect(l).toContain("DTSTART;VALUE=DATE:20260820");
		// DTEND is exclusive — the day after the due date.
		expect(l).toContain("DTEND;VALUE=DATE:20260829");
		expect(l.some((line) => line.startsWith("DUE"))).toBe(false);
		expect(l).toContain("DTSTAMP:20260826T144500Z");
	});

	it("gives a due-only task a single-day event on the due date", () => {
		const l = lines(
			buildIcs([
				{ uid: "u", summary: "s", due: "2026-08-28", stamp: "2026-01-01T00:00:00Z" },
			]),
		);
		expect(l).toContain("DTSTART;VALUE=DATE:20260828");
		expect(l).toContain("DTEND;VALUE=DATE:20260829");
	});

	it("leaves a start-only task with just DTSTART", () => {
		const l = lines(
			buildIcs([
				{ uid: "u", summary: "s", start: "2026-08-20", stamp: "2026-01-01T00:00:00Z" },
			]),
		);
		expect(l).toContain("DTSTART;VALUE=DATE:20260820");
		expect(l.some((line) => line.startsWith("DTEND"))).toBe(false);
	});

	it("falls back to a single-day event when due precedes start (bad data)", () => {
		const l = lines(
			buildIcs([
				{
					uid: "u",
					summary: "s",
					start: "2026-08-20",
					due: "2026-08-10",
					stamp: "2026-01-01T00:00:00Z",
				},
			]),
		);
		expect(l).toContain("DTSTART;VALUE=DATE:20260820");
		expect(l).toContain("DTEND;VALUE=DATE:20260821");
	});

	it("maps the workspace status name into STATUS verbatim", () => {
		const l = lines(
			buildIcs([
				{ uid: "u", summary: "s", stamp: "2026-01-01T00:00:00Z", status: "In Progress" },
			]),
		);
		expect(l).toContain("STATUS:In Progress");
	});

	it("escapes RFC 5545 text special characters", () => {
		const l = lines(
			buildIcs([
				{
					uid: "u",
					summary: "a, b; c\\ d\ne",
					stamp: "2026-01-01T00:00:00Z",
				},
			]),
		);
		expect(l).toContain("SUMMARY:a\\, b\\; c\\\\ d\\ne");
	});

	it("folds content lines longer than 75 octets", () => {
		const long = "x".repeat(200);
		const l = lines(
			buildIcs([{ uid: "u", summary: long, stamp: "2026-01-01T00:00:00Z" }]),
		);
		const summaryIdx = l.findIndex((line) => line.startsWith("SUMMARY:"));
		expect(l[summaryIdx].length).toBeLessThanOrEqual(75);
		// The continuation line starts with a single space.
		expect(l[summaryIdx + 1].startsWith(" ")).toBe(true);
	});
});
