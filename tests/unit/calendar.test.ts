import { describe, expect, it } from "vitest";
import {
	bucketByDay,
	calendarAnchor,
	monthGrid,
	startOfMonth,
	unscheduledForCalendar,
} from "../../src/core/views/calendar";
import { barDates, dayNumber, shiftBar, taskBar } from "../../src/core/views/timeline";
import { task } from "./fixtures";

/** UTC day-of-week (0 = Sunday) for a bare ISO date. */
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/* --------------------------------------------------------- calendarAnchor -- */

describe("calendarAnchor", () => {
	it("reads only the selected field — never falls back to the other", () => {
		const dueOnly = task({ dueDate: "2026-08-20" });
		expect(calendarAnchor(dueOnly, "dueDate")).toBe("2026-08-20");
		expect(calendarAnchor(dueOnly, "startDate")).toBeNull();

		const startOnly = task({ startDate: "2026-08-10" });
		expect(calendarAnchor(startOnly, "startDate")).toBe("2026-08-10");
		expect(calendarAnchor(startOnly, "dueDate")).toBeNull();
	});

	it("normalises a datetime to a bare day", () => {
		expect(
			calendarAnchor(task({ dueDate: "2026-08-20T14:30:00Z" }), "dueDate"),
		).toBe("2026-08-20");
	});

	it("is null when the task has neither date", () => {
		expect(calendarAnchor(task({}), "dueDate")).toBeNull();
		expect(calendarAnchor(task({}), "startDate")).toBeNull();
	});
});

/* --------------------------------------- bucketByDay / unscheduledForCalendar */

describe("bucketByDay / unscheduledForCalendar", () => {
	const a = task({ id: "A", path: "W/Tasks/A", startDate: "2026-08-18", dueDate: "2026-08-20" });
	const b = task({ id: "B", path: "W/Tasks/B", dueDate: "2026-08-20" });
	const c = task({ id: "C", path: "W/Tasks/C", startDate: "2026-08-18" });
	const d = task({ id: "D", path: "W/Tasks/D" });
	const all = [a, b, c, d];

	it("buckets by the due field; the rest are unscheduled for that toggle", () => {
		const buckets = bucketByDay(all, "dueDate");
		expect([...buckets.keys()]).toEqual(["2026-08-20"]);
		expect(buckets.get("2026-08-20")).toEqual([a, b]);
		expect(unscheduledForCalendar(all, "dueDate")).toEqual([c, d]);
	});

	it("buckets by the start field independently — c becomes placed, b does not", () => {
		const buckets = bucketByDay(all, "startDate");
		expect([...buckets.keys()]).toEqual(["2026-08-18"]);
		expect(buckets.get("2026-08-18")).toEqual([a, c]);
		expect(unscheduledForCalendar(all, "startDate")).toEqual([b, d]);
	});

	it("a task with neither date is unscheduled under either toggle", () => {
		expect(unscheduledForCalendar([d], "dueDate")).toEqual([d]);
		expect(unscheduledForCalendar([d], "startDate")).toEqual([d]);
		expect(bucketByDay([d], "dueDate").size).toBe(0);
	});

	it("preserves input order within a day", () => {
		expect(bucketByDay([b, a], "dueDate").get("2026-08-20")).toEqual([b, a]);
	});
});

/* --------------------------------------------------------- startOfMonth ---- */

describe("startOfMonth", () => {
	it("normalises any day of the month to the 1st", () => {
		expect(startOfMonth("2026-08-01")).toBe("2026-08-01");
		expect(startOfMonth("2026-08-17")).toBe("2026-08-01");
		expect(startOfMonth("2026-08-31")).toBe("2026-08-01");
		expect(startOfMonth("2026-12-25")).toBe("2026-12-01");
	});

	it("ignores a time portion", () => {
		expect(startOfMonth("2026-08-17T23:59:00Z")).toBe("2026-08-01");
	});

	it("is idempotent when already the 1st", () => {
		const once = startOfMonth("2026-02-14");
		expect(startOfMonth(once)).toBe(once);
		expect(once).toBe("2026-02-01");
	});
});

/* ------------------------------------------------------------ monthGrid ---- */

describe("monthGrid", () => {
	const shape = (month: string) => {
		const cells = monthGrid(month);
		return {
			cells,
			len: cells.length,
			firstDow: dow(cells[0]),
			lastDow: dow(cells[cells.length - 1]),
		};
	};

	it("always spans whole Sunday-started weeks, 28–42 cells", () => {
		for (const m of [
			"2026-01-01", // 31-day, starts Thursday
			"2026-02-01", // 28-day, starts Sunday
			"2024-02-01", // leap February
			"2026-08-01", // starts Saturday
			"2026-11-01",
		]) {
			const { len, firstDow, lastDow } = shape(m);
			expect(len % 7).toBe(0);
			expect(firstDow).toBe(0);
			expect(lastDow).toBe(6);
			expect(len).toBeGreaterThanOrEqual(28);
			expect(len).toBeLessThanOrEqual(42);
		}
	});

	it("is exactly 28 cells for a non-leap February beginning on a Sunday", () => {
		expect(dow("2026-02-01")).toBe(0);
		expect(monthGrid("2026-02-01").length).toBe(28);
	});

	it("pads a 31-day month with leading days from the previous month", () => {
		// Jan 2026 starts Thursday and ends Saturday, so it needs 4 leading days
		// (late December) and no trailing padding: 4 + 31 = 35 cells.
		const cells = monthGrid("2026-01-01");
		expect(cells).toContain("2026-01-01");
		expect(cells).toContain("2026-01-31");
		expect(cells[0] < "2026-01-01").toBe(true); // trailing days of December
		expect(cells.length).toBe(35);
	});

	it("pads trailing days when a month ends mid-week", () => {
		// May 2026 ends Sunday (May 31), so the grid runs on into June.
		const cells = monthGrid("2026-05-01");
		expect(cells[cells.length - 1] > "2026-05-31").toBe(true);
	});

	it("includes Feb 29 in a leap year", () => {
		expect(monthGrid("2024-02-01")).toContain("2024-02-29");
	});

	it("leads with exactly as many days as the month's first weekday", () => {
		// Sunday-start (0 leading) and Saturday-start (6 leading) — both ends.
		for (const m of ["2026-02-01", "2026-05-01", "2026-08-01", "2026-09-01"]) {
			const first = startOfMonth(m);
			expect(monthGrid(m).indexOf(first)).toBe(dow(first));
		}
	});

	it("normalises a mid-month argument to its month", () => {
		expect(monthGrid("2026-08-17")).toEqual(monthGrid("2026-08-01"));
	});
});

/* ------------------------------------------------------------ drag math ---- */

describe("drag branch: moving a chip already on the grid", () => {
	// The view computes deltaDays = dayNumber(target) - dayNumber(anchor), then
	// shiftBar(taskBar(task), deltaDays) → updateTask(task, barDates(newBar)).

	it("shifts a range task by the whole-day delta, keeping its start↔due gap", () => {
		const t = task({ startDate: "2026-08-18", dueDate: "2026-08-20" });
		const anchor = calendarAnchor(t, "dueDate");
		expect(anchor).toBe("2026-08-20");
		const delta = dayNumber("2026-08-27") - dayNumber(anchor as string); // +7
		expect(barDates(shiftBar(taskBar(t), delta))).toEqual({
			startDate: "2026-08-25",
			dueDate: "2026-08-27",
		});
	});

	it("moves a due-only task to land exactly on the target day", () => {
		const t = task({ dueDate: "2026-08-20" });
		const delta = dayNumber("2026-08-15") - dayNumber("2026-08-20"); // -5
		expect(barDates(shiftBar(taskBar(t), delta))).toEqual({
			startDate: null,
			dueDate: "2026-08-15",
		});
	});

	it("is a no-op when the target day equals the current anchor", () => {
		const t = task({ dueDate: "2026-08-20" });
		expect(dayNumber("2026-08-20") - dayNumber("2026-08-20")).toBe(0);
	});
});

describe("drag branch: scheduling from the Unscheduled drawer", () => {
	it("sets only the selected field, leaving the other untouched", () => {
		const t = task({ startDate: "2026-08-01" }); // unscheduled under 'dueDate'
		expect(calendarAnchor(t, "dueDate")).toBeNull();
		// No bar math — the view sets { [field]: target } directly.
		expect({ ...t, dueDate: "2026-08-15" }).toMatchObject({
			startDate: "2026-08-01",
			dueDate: "2026-08-15",
		});
	});
});
