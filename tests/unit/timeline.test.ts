import { describe, expect, it } from "vitest";
import {
	addDays,
	barDates,
	dateRangeOf,
	dayNumber,
	daysBetween,
	isoFromDay,
	partitionScheduled,
	projectBar,
	resizeEnd,
	resizeStart,
	shiftBar,
	taskBar,
	type Bar,
	type RangeBar,
} from "../../src/core/views/timeline";
import { emptyRelations, type Project, type Task } from "../../src/core/types";

/* ----------------------------------------------------------- fixtures ----- */

function task(partial: Partial<Task>): Task {
	return {
		type: "task",
		id: "TSK-1",
		title: "T",
		taskType: null,
		status: "todo",
		priority: null,
		rank: "0|hzzzzz:",
		project: null,
		parent: null,
		assignee: null,
		estimate: null,
		labels: [],
		startDate: null,
		dueDate: null,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		path: "W/Tasks/TSK-1",
		mentions: [],
		...partial,
	};
}

function project(partial: Partial<Project>): Project {
	return {
		type: "project",
		title: "P",
		status: "in-progress",
		priority: null,
		labels: [],
		startDate: null,
		dueDate: null,
		owner: null,
		archived: false,
		archivedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		path: "W/Projects/P",
		...partial,
	};
}

const range = (start: string, end: string): RangeBar => ({
	kind: "range",
	start,
	end,
});

/* -------------------------------------------------------- day arithmetic -- */

describe("day arithmetic", () => {
	it("round-trips a date through day numbers", () => {
		expect(isoFromDay(dayNumber("2026-08-28"))).toBe("2026-08-28");
	});

	it("ignores the time portion of a datetime", () => {
		expect(dayNumber("2026-08-28T23:59:00Z")).toBe(dayNumber("2026-08-28"));
	});

	it("adds whole days across a month boundary", () => {
		expect(addDays("2026-08-28", 5)).toBe("2026-09-02");
		expect(addDays("2026-08-28", -30)).toBe("2026-07-29");
	});

	it("measures the gap between two dates", () => {
		expect(daysBetween("2026-08-20", "2026-08-28")).toBe(8);
		expect(daysBetween("2026-08-28", "2026-08-20")).toBe(-8);
	});
});

/* ------------------------------------------------------------- taskBar ---- */

describe("taskBar / projectBar", () => {
	it("both dates → range", () => {
		expect(taskBar(task({ startDate: "2026-08-20", dueDate: "2026-08-28" }))).toEqual(
			range("2026-08-20", "2026-08-28"),
		);
	});

	it("due only → milestone", () => {
		expect(taskBar(task({ dueDate: "2026-08-28" }))).toEqual({
			kind: "milestone",
			date: "2026-08-28",
		});
	});

	it("start only → open", () => {
		expect(taskBar(task({ startDate: "2026-08-20" }))).toEqual({
			kind: "open",
			start: "2026-08-20",
		});
	});

	it("neither → unscheduled", () => {
		expect(taskBar(task({}))).toEqual({ kind: "unscheduled" });
	});

	it("normalises hand-edited start-after-due to a zero-length bar, never throws", () => {
		expect(() =>
			taskBar(task({ startDate: "2026-09-10", dueDate: "2026-08-01" })),
		).not.toThrow();
		expect(taskBar(task({ startDate: "2026-09-10", dueDate: "2026-08-01" }))).toEqual(
			range("2026-08-01", "2026-08-01"),
		);
	});

	it("reads a Project's own dates directly", () => {
		expect(
			projectBar(project({ startDate: "2026-01-10", dueDate: "2026-06-30" })),
		).toEqual(range("2026-01-10", "2026-06-30"));
		expect(projectBar(project({}))).toEqual({ kind: "unscheduled" });
	});
});

/* ----------------------------------------------------- partitionScheduled -- */

describe("partitionScheduled", () => {
	it("splits on whether the task has any date, keeping order", () => {
		const a = task({ id: "A", startDate: "2026-08-20", dueDate: "2026-08-28" });
		const b = task({ id: "B" });
		const c = task({ id: "C", dueDate: "2026-09-01" });
		const d = task({ id: "D" });
		const { scheduled, unscheduled } = partitionScheduled([a, b, c, d]);
		expect(scheduled.map((t) => t.id)).toEqual(["A", "C"]);
		expect(unscheduled.map((t) => t.id)).toEqual(["B", "D"]);
	});
});

/* --------------------------------------------------------- dateRangeOf ---- */

describe("dateRangeOf", () => {
	it("spans every dated endpoint and ignores unscheduled bars", () => {
		const bars: Bar[] = [
			range("2026-08-20", "2026-08-28"),
			{ kind: "milestone", date: "2026-09-15" },
			{ kind: "open", start: "2026-07-01" },
			{ kind: "unscheduled" },
		];
		expect(dateRangeOf(bars)).toEqual({ min: "2026-07-01", max: "2026-09-15" });
	});

	it("is null when nothing is scheduled", () => {
		expect(dateRangeOf([{ kind: "unscheduled" }, { kind: "unscheduled" }])).toBeNull();
		expect(dateRangeOf([])).toBeNull();
	});
});

/* ------------------------------------------------------------- resize ----- */

describe("resizeStart", () => {
	it("moves the start by whole days", () => {
		expect(resizeStart(range("2026-08-20", "2026-08-28"), 3)).toEqual(
			range("2026-08-23", "2026-08-28"),
		);
		expect(resizeStart(range("2026-08-20", "2026-08-28"), -5)).toEqual(
			range("2026-08-15", "2026-08-28"),
		);
	});

	it("clamps to end rather than inverting when dragged past due", () => {
		expect(resizeStart(range("2026-08-20", "2026-08-28"), 40)).toEqual(
			range("2026-08-28", "2026-08-28"),
		);
	});

	it("leaves end untouched", () => {
		expect(resizeStart(range("2026-08-20", "2026-08-28"), 2).kind).toBe("range");
	});
});

describe("resizeEnd", () => {
	it("moves the end by whole days", () => {
		expect(resizeEnd(range("2026-08-20", "2026-08-28"), 4)).toEqual(
			range("2026-08-20", "2026-09-01"),
		);
	});

	it("clamps to start rather than inverting when dragged past start", () => {
		expect(resizeEnd(range("2026-08-20", "2026-08-28"), -40)).toEqual(
			range("2026-08-20", "2026-08-20"),
		);
	});
});

/* -------------------------------------------------------------- shift ----- */

describe("shiftBar", () => {
	it("moves a range and preserves its duration exactly", () => {
		const before = range("2026-08-20", "2026-08-28");
		const after = shiftBar(before, 10);
		expect(after).toEqual(range("2026-08-30", "2026-09-07"));
		expect(daysBetween((after as RangeBar).start, (after as RangeBar).end)).toBe(
			daysBetween(before.start, before.end),
		);
	});

	it("shifts a milestone's one date", () => {
		expect(shiftBar({ kind: "milestone", date: "2026-08-28" }, -7)).toEqual({
			kind: "milestone",
			date: "2026-08-21",
		});
	});

	it("shifts an open bar's start", () => {
		expect(shiftBar({ kind: "open", start: "2026-08-20" }, 5)).toEqual({
			kind: "open",
			start: "2026-08-25",
		});
	});

	it("leaves an unscheduled bar alone", () => {
		expect(shiftBar({ kind: "unscheduled" }, 5)).toEqual({ kind: "unscheduled" });
	});

	it("stops at the representable-date boundary without inverting the bar", () => {
		const before = range("2026-08-20", "2026-08-28");
		const far = shiftBar(before, 1e12) as RangeBar;
		expect(() => new Date(far.end)).not.toThrow();
		expect(Number.isNaN(Date.parse(far.end))).toBe(false);
		// Duration is still exactly preserved even though the bar couldn't
		// travel the full distance.
		expect(daysBetween(far.start, far.end)).toBe(
			daysBetween(before.start, before.end),
		);
	});

	it("stops at the lower representable-date boundary too", () => {
		const before = range("2026-08-20", "2026-08-28");
		const far = shiftBar(before, -1e12) as RangeBar;
		expect(Number.isNaN(Date.parse(far.start))).toBe(false);
		expect(daysBetween(far.start, far.end)).toBe(
			daysBetween(before.start, before.end),
		);
	});
});

/* ------------------------------------------------------------ barDates ---- */

describe("barDates", () => {
	it("maps every bar kind back to a frontmatter patch", () => {
		expect(barDates(range("2026-08-20", "2026-08-28"))).toEqual({
			startDate: "2026-08-20",
			dueDate: "2026-08-28",
		});
		expect(barDates({ kind: "milestone", date: "2026-08-28" })).toEqual({
			startDate: null,
			dueDate: "2026-08-28",
		});
		expect(barDates({ kind: "open", start: "2026-08-20" })).toEqual({
			startDate: "2026-08-20",
			dueDate: null,
		});
		expect(barDates({ kind: "unscheduled" })).toEqual({
			startDate: null,
			dueDate: null,
		});
	});
});
