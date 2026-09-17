import { describe, expect, it } from "vitest";
import { dueDateStatus, localTodayIso } from "../../src/core/date";

describe("localTodayIso", () => {
	it("reads the local calendar date, not the UTC-shifted one", () => {
		// Local-time constructor args: Sep 16, 11:04 PM local, whatever zone the
		// runner is in. UTC would already be Sep 17 for any zone west of UTC.
		const lateEvening = new Date(2026, 8, 16, 23, 4);
		expect(localTodayIso(lateEvening)).toBe("2026-09-16");
	});

	it("matches the injected Date's own local year/month/day components", () => {
		const samples = [
			new Date(2026, 0, 1, 0, 0),
			new Date(2026, 11, 31, 23, 59),
			new Date(2024, 1, 29, 12, 0), // leap day
			new Date(2026, 8, 16, 23, 4),
			new Date(Date.UTC(2026, 8, 17, 0, 30)), // just after UTC midnight
		];

		for (const now of samples) {
			const pad = (n: number) => String(n).padStart(2, "0");
			const expected = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
			expect(localTodayIso(now)).toBe(expected);
		}
	});
});

describe("dueDateStatus", () => {
	it("is today when dueDate matches today and the task is open", () => {
		expect(dueDateStatus("2026-09-16", true, "2026-09-16")).toEqual({
			isToday: true,
			isOverdue: false,
		});
	});

	it("is overdue when dueDate is before today and the task is open", () => {
		expect(dueDateStatus("2026-09-10", true, "2026-09-16")).toEqual({
			isToday: false,
			isOverdue: true,
		});
	});

	it("is neither today nor overdue when the task is not open", () => {
		expect(dueDateStatus("2026-09-16", false, "2026-09-16")).toEqual({
			isToday: false,
			isOverdue: false,
		});
		expect(dueDateStatus("2026-09-10", false, "2026-09-16")).toEqual({
			isToday: false,
			isOverdue: false,
		});
	});

	it("is neither today nor overdue when dueDate is null", () => {
		expect(dueDateStatus(null, true, "2026-09-16")).toEqual({
			isToday: false,
			isOverdue: false,
		});
	});

	it("is neither when dueDate is in the future", () => {
		expect(dueDateStatus("2026-09-20", true, "2026-09-16")).toEqual({
			isToday: false,
			isOverdue: false,
		});
	});
});
