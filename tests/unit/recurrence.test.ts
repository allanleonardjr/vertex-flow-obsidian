import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import {
	MAX_RECURRENCE_BACKFILL,
	cadencePoints,
	chainLength,
	chainMembers,
	describeFrequency,
	describeRecurrence,
	describeTrigger,
	firstOccurrenceOnOrAfter,
	nextInChain,
	nextOccurrence,
	nodeMatchesTrigger,
	prevInChain,
	projectOccurrences,
	projectRecurrences,
	projectSeries,
	PROJECTION_HORIZON_DAYS,
	PROJECTION_MAX,
	reconcilePlans,
	recurrenceNodesInChain,
	recurringOverview,
	shiftOccurrenceDates,
	spawnPlans,
	type OccurrencePlan,
} from "../../src/core/recurrence";
import { localTodayIso } from "../../src/core/date";
import { evaluateView, newView } from "../../src/core/views";
import type {
	IsoDate,
	RecurrenceConfig,
	Task,
	WorkspaceSnapshot,
} from "../../src/core/types";
import { task } from "./fixtures";

const sample = sampleSnapshot();
const snapshotWith = (tasks: Task[]): WorkspaceSnapshot => ({
	...sample,
	tasks,
});

const rule = (partial: Partial<RecurrenceConfig> = {}): RecurrenceConfig => ({
	trigger: "on-date",
	triggerStatus: null,
	freq: "daily",
	interval: 1,
	weekdays: [],
	dayOfMonth: null,
	weekdayOfMonth: null,
	monthOfYear: null,
	anchor: "dueDate",
	newStatus: null,
	endsAfter: null,
	endsOn: null,
	nextDate: "2026-09-01",
	copyFields: null,
	...partial,
});

const nodeTask = (partial: Partial<Task> = {}): Task =>
	task({ path: "W/Tasks/TSK-9001", ...partial });

const planDates = (plans: OccurrencePlan[]): IsoDate[] =>
	plans.map((plan) => plan.date);

/* ---------------------------------------------------------------- engine -- */

describe("nextOccurrence — cadence math", () => {
	it("daily advances by the interval", () => {
		expect(nextOccurrence(rule({ freq: "daily" }), "2026-09-01")).toBe("2026-09-02");
		expect(
			nextOccurrence(rule({ freq: "daily", interval: 3 }), "2026-09-01"),
		).toBe("2026-09-04");
	});

	it("weekly interval=1 walks the weekdays in order, wrapping across Sunday", () => {
		const mwf = rule({ freq: "weekly", interval: 1, weekdays: ["mon", "wed", "fri"] });
		expect(nextOccurrence(mwf, "2026-09-02")).toBe("2026-09-04"); // Wed → Fri
		expect(nextOccurrence(mwf, "2026-09-04")).toBe("2026-09-07"); // Fri → Mon
		expect(nextOccurrence(mwf, "2026-09-07")).toBe("2026-09-09"); // Mon → Wed

		const weekend = rule({ freq: "weekly", interval: 1, weekdays: ["sat", "sun"] });
		expect(nextOccurrence(weekend, "2026-09-03")).toBe("2026-09-05"); // Thu → Sat
		expect(nextOccurrence(weekend, "2026-09-06")).toBe("2026-09-12"); // Sun → Sat
	});

	it("weekly interval>1 steps whole weeks, ignoring weekdays", () => {
		expect(
			nextOccurrence(rule({ freq: "weekly", interval: 2 }), "2026-08-28"),
		).toBe("2026-09-11");
	});

	it("monthly dayOfMonth clamps short months", () => {
		expect(
			nextOccurrence(rule({ freq: "monthly", dayOfMonth: 31 }), "2026-01-31"),
		).toBe("2026-02-28");
		expect(
			nextOccurrence(rule({ freq: "monthly", dayOfMonth: 31 }), "2026-02-28"),
		).toBe("2026-03-31");
		expect(
			nextOccurrence(rule({ freq: "monthly", dayOfMonth: 31 }), "2026-03-31"),
		).toBe("2026-04-30");
		expect(
			nextOccurrence(
				rule({ freq: "monthly", dayOfMonth: 31, interval: 2 }),
				"2026-01-31",
			),
		).toBe("2026-03-31");
	});

	it("monthly with no day pattern keeps the seed's own day, clamped", () => {
		expect(
			nextOccurrence(rule({ freq: "monthly" }), "2026-01-15"),
		).toBe("2026-02-15");
		expect(
			nextOccurrence(rule({ freq: "monthly" }), "2026-01-31"),
		).toBe("2026-02-28");
	});

	it("monthly weekdayOfMonth counts the seed's own weekday through later months", () => {
		// 2026-09-01 is a Tuesday; 2nd Tuesday of October = the 13th.
		expect(
			nextOccurrence(
				rule({ freq: "monthly", interval: 1, weekdayOfMonth: 2 }),
				"2026-09-01",
			),
		).toBe("2026-10-13");
		// 1st Wednesday of October, from a Wednesday seed.
		expect(
			nextOccurrence(
				rule({ freq: "monthly", interval: 1, weekdayOfMonth: 1 }),
				"2026-09-02",
			),
		).toBe("2026-10-07");
	});

	it("monthly weekdayOfMonth skips a month whose nth weekday doesn't exist", () => {
		// 2026-02-27 is the 4th (and last) Friday of February. The 5th Friday is
		// missing in Feb, Mar and Apr 2026; the engine lands on May's 5th Friday.
		expect(
			nextOccurrence(
				rule({ freq: "monthly", interval: 1, weekdayOfMonth: 5 }),
				"2026-02-27",
			),
		).toBe("2026-05-29");
	});

	it("yearly holds month and day, clamping like monthly", () => {
		expect(
			nextOccurrence(
				rule({ freq: "yearly", monthOfYear: 4, dayOfMonth: 10 }),
				"2026-04-10",
			),
		).toBe("2027-04-10");
		expect(
			nextOccurrence(
				rule({ freq: "yearly", monthOfYear: 2, dayOfMonth: 29 }),
				"2024-02-29",
			),
		).toBe("2025-02-28");
		// monthOfYear null keeps the seed's own month.
		expect(
			nextOccurrence(rule({ freq: "yearly" }), "2026-04-10"),
		).toBe("2027-04-10");
	});
});

describe("cadence point helpers", () => {
	it("cadencePoints lists start through through, inclusive", () => {
		expect(
			cadencePoints(rule({ freq: "daily" }), "2026-09-01", "2026-09-05"),
		).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
	});

	it("firstOccurrenceOnOrAfter includes the target and tolerates a lagging start", () => {
		expect(
			firstOccurrenceOnOrAfter(rule({ freq: "daily" }), "2026-09-01", "2026-09-05"),
		).toBe("2026-09-05");
		expect(
			firstOccurrenceOnOrAfter(
				rule({ freq: "weekly", interval: 1, weekdays: ["fri"] }),
				"2026-09-01",
				"2026-09-07",
			),
		).toBe("2026-09-11");
		// Already past the target: the start itself is the answer.
		expect(
			firstOccurrenceOnOrAfter(rule({ freq: "daily" }), "2026-09-10", "2026-09-05"),
		).toBe("2026-09-10");
	});

	it("projectOccurrences walks forward from the seed", () => {
		expect(projectOccurrences(rule({ freq: "daily" }), "2026-09-01", 3)).toEqual([
			"2026-09-01",
			"2026-09-02",
			"2026-09-03",
		]);
	});

	it("shiftOccurrenceDates shifts the whole range onto the anchor day", () => {
		expect(
			shiftOccurrenceDates(
				{ startDate: "2026-09-01", dueDate: "2026-09-05" },
				"dueDate",
				"2026-09-12",
			),
		).toEqual({ startDate: "2026-09-08", dueDate: "2026-09-12" });
		expect(
			shiftOccurrenceDates(
				{ startDate: "2026-09-01", dueDate: "2026-09-05" },
				"startDate",
				"2026-09-12",
			),
		).toEqual({ startDate: "2026-09-12", dueDate: "2026-09-16" });
		// Anchor names the field a start-only task doesn't set: lands on due.
		expect(
			shiftOccurrenceDates({ startDate: null, dueDate: "2026-09-05" }, "startDate", "2026-09-12"),
		).toEqual({ startDate: null, dueDate: "2026-09-12" });
		// No dates → no dates.
		expect(
			shiftOccurrenceDates({ startDate: null, dueDate: null }, "dueDate", "2026-09-12"),
		).toEqual({ startDate: null, dueDate: null });
	});
});

/* -------------------------------------------------------------- spawning -- */

describe("spawnPlans — on-date", () => {
	const snap = (n: Task) => snapshotWith([n]);

	it("does nothing before nextDate", () => {
		const n = nodeTask({ recurrence: rule({ nextDate: "2026-09-10" }) });
		expect(spawnPlans(snap(n), n, "2026-09-05")).toEqual([]);
	});

	it("spawns one occurrence when nextDate is today, advancing the schedule", () => {
		const n = nodeTask({
			startDate: "2026-09-01",
			dueDate: "2026-09-03",
			recurrence: rule({ nextDate: "2026-09-05" }),
		});
		const [plan] = spawnPlans(snap(n), n, "2026-09-05");
		expect(plan.sourcePath).toBe(n.path);
		expect(plan.date).toBe("2026-09-05");
		expect(plan.dueDate).toBe("2026-09-05");
		expect(plan.startDate).toBe("2026-09-03");
		expect(plan.recurrence?.nextDate).toBe("2026-09-06");
		expect(plan.recurrence?.freq).toBe("daily");
		expect(plan.recurrence?.anchor).toBe("dueDate");
	});

	it("backfills every missed point through today", () => {
		const n = nodeTask({ recurrence: rule({ nextDate: "2026-08-28" }) });
		const plans = spawnPlans(snap(n), n, "2026-09-05");
		expect(planDates(plans)).toEqual([
			"2026-08-28",
			"2026-08-29",
			"2026-08-30",
			"2026-08-31",
			"2026-09-01",
			"2026-09-02",
			"2026-09-03",
			"2026-09-04",
			"2026-09-05",
		]);
		// Only the newest spawned occurrence carries a live schedule; every
		// intermediate backfilled point is superseded within this same pass,
		// so it lands with no recurrence block at all.
		expect(plans[plans.length - 1].recurrence?.nextDate).toBe("2026-09-06");
		expect(plans[0].recurrence).toBeNull();
	});

	it("jumps past the backlog cap: exactly the most recent point, one spawn", () => {
		const n = nodeTask({ recurrence: rule({ nextDate: "2026-07-01" }) });
		expect(cadencePoints(rule({ nextDate: "2026-07-01" }), "2026-07-01", "2026-09-05").length).toBeGreaterThan(MAX_RECURRENCE_BACKFILL);
		const plans = spawnPlans(snap(n), n, "2026-09-05");
		expect(plans).toHaveLength(1);
		expect(plans[0].date).toBe("2026-09-05");
		expect(plans[0].recurrence?.nextDate).toBe("2026-09-06");
	});

	it("endsAfter stops the series mid-gap and marks the last note terminal", () => {
		// 5 missed points but a budget of 3 total (node + 2). The 2 newest get
		// written, the final one carries no recurrence block.
		const n = nodeTask({ recurrence: rule({ nextDate: "2026-08-28", endsAfter: 3 }) });
		const plans = spawnPlans(snap(n), n, "2026-09-05");
		expect(planDates(plans)).toEqual(["2026-09-04", "2026-09-05"]);
		// Intermediate backfilled points never carry a live block, and the
		// final one is the series terminus — both come out null.
		expect(plans[0].recurrence).toBeNull();
		expect(plans[1].recurrence).toBeNull();
	});

	it("remaining budget 1 spawns a single terminal occurrence", () => {
		const n = nodeTask({
			status: "done",
			recurrence: rule({
				nextDate: "2026-09-05",
				trigger: "on-close",
				endsAfter: 2,
			}),
		});
		expect(chainLength(snapshotWith([n]), n)).toBe(1);
		const plans = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		expect(plans).toHaveLength(1);
		expect(plans[0].recurrence).toBeNull();
	});

	it("a fully-consumed budget stops forever", () => {
		const n = nodeTask({ recurrence: rule({ nextDate: "2026-09-05", endsAfter: 1 }) });
		expect(spawnPlans(snap(n), n, "2026-09-05")).toEqual([]);
	});

	it("endsOn admits only points on or before the limit", () => {
		const n = nodeTask({
			recurrence: rule({ nextDate: "2026-08-30", endsOn: "2026-09-03" }),
		});
		expect(planDates(spawnPlans(snap(n), n, "2026-09-05"))).toEqual([
			"2026-08-30",
			"2026-08-31",
			"2026-09-01",
			"2026-09-02",
			"2026-09-03",
		]);
	});

	it("a due node past its endsOn never spawns", () => {
		const n = nodeTask({
			recurrence: rule({ nextDate: "2026-09-05", endsOn: "2026-09-03" }),
		});
		expect(spawnPlans(snap(n), n, "2026-09-05")).toEqual([]);
	});
});

describe("spawnPlans — on-close", () => {
	it("spawns on the first future cadence point whenever a completed status fires", () => {
		const n = nodeTask({
			status: "done",
			recurrence: rule({ trigger: "on-close", nextDate: "2026-08-01" }),
		});
		const plans = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		expect(plans).toHaveLength(1);
		expect(plans[0].date).toBe("2026-09-05");
		expect(plans[0].recurrence?.trigger).toBe("on-close");
	});

	it("sits still while the trigger status is unmet", () => {
		const n = nodeTask({
			status: "todo",
			recurrence: rule({ trigger: "on-close", nextDate: "2026-08-01" }),
		});
		expect(spawnPlans(snapshotWith([n]), n, "2026-09-05")).toEqual([]);
	});

	it("a canceled status is not a completed trigger", () => {
		const n = nodeTask({
			status: "canceled",
			recurrence: rule({ trigger: "on-close", nextDate: "2026-09-05" }),
		});
		expect(spawnPlans(snapshotWith([n]), n, "2026-09-05")).toEqual([]);
	});

	it("an explicit triggerStatus fires on that status, wherever it sits", () => {
		const review = rule({
			trigger: "on-close",
			triggerStatus: "in-review",
			nextDate: "2026-08-01",
		});
		expect(
			spawnPlans(
				snapshotWith([nodeTask({ status: "in-review", recurrence: review })]),
				nodeTask({ status: "in-review", recurrence: review }),
				"2026-09-05",
			).length,
		).toBe(1);
		expect(
			spawnPlans(snapshotWith([nodeTask({ status: "todo", recurrence: review })]), nodeTask({ status: "todo", recurrence: review }), "2026-09-05"),
		).toEqual([]);
	});

	it("is status-driven: lands on today with no dates, ignoring cadence", () => {
		// A weekly on-close series whose nextDate is long behind still just
		// fires on today when the status matches — no cadence math, no dates.
		const n = nodeTask({
			status: "done",
			recurrence: rule({
				trigger: "on-close",
				freq: "weekly",
				interval: 1,
				weekdays: ["fri"],
				nextDate: "2026-08-01",
			}),
		});
		const [plan] = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		expect(plan.date).toBe("2026-09-05");
		expect(plan.startDate).toBeNull();
		expect(plan.dueDate).toBeNull();
	});

	it("onCloseStartDateMode: immediate lands Start on the spawn day only", () => {
		const n = nodeTask({
			status: "done",
			startDate: "2026-01-01",
			dueDate: "2026-01-05",
			recurrence: rule({
				trigger: "on-close",
				nextDate: "2026-08-01",
				onCloseStartDateMode: "immediate",
			}),
		});
		const [plan] = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		expect(plan.startDate).toBe("2026-09-05");
		expect(plan.dueDate).toBeNull();
	});

	it("onCloseDueDateMode: immediate lands Due on the spawn day only", () => {
		const n = nodeTask({
			status: "done",
			startDate: "2026-01-01",
			dueDate: "2026-01-05",
			recurrence: rule({
				trigger: "on-close",
				nextDate: "2026-08-01",
				onCloseDueDateMode: "immediate",
			}),
		});
		const [plan] = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		expect(plan.dueDate).toBe("2026-09-05");
		expect(plan.startDate).toBeNull();
	});

	it("both immediate lands both fields on the spawn day", () => {
		const n = nodeTask({
			status: "done",
			recurrence: rule({
				trigger: "on-close",
				nextDate: "2026-08-01",
				onCloseStartDateMode: "immediate",
				onCloseDueDateMode: "immediate",
			}),
		});
		const [plan] = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		expect(plan.startDate).toBe("2026-09-05");
		expect(plan.dueDate).toBe("2026-09-05");
	});

	it("onCloseStartDateMode: shifted carries the anchor-preserving delta", () => {
		const n = nodeTask({
			status: "done",
			startDate: "2026-01-01",
			dueDate: "2026-01-05",
			recurrence: rule({
				trigger: "on-close",
				anchor: "dueDate",
				nextDate: "2026-08-01",
				onCloseStartDateMode: "shifted",
			}),
		});
		const [plan] = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		const expected = shiftOccurrenceDates(n, "dueDate", "2026-09-05");
		expect(plan.startDate).toBe(expected.startDate);
		expect(plan.dueDate).toBeNull();
	});

	it("shifted on the anchor field itself coincides with immediate", () => {
		const n = nodeTask({
			status: "done",
			startDate: "2026-01-01",
			dueDate: "2026-01-05",
			recurrence: rule({
				trigger: "on-close",
				anchor: "dueDate",
				nextDate: "2026-08-01",
				onCloseDueDateMode: "shifted",
			}),
		});
		const [plan] = spawnPlans(snapshotWith([n]), n, "2026-09-05");
		expect(plan.dueDate).toBe("2026-09-05");
	});

	it("explicit none behaves identically to an absent mode", () => {
		const base = {
			status: "done" as const,
			startDate: "2026-01-01",
			dueDate: "2026-01-05",
		};
		const withNone = nodeTask({
			...base,
			recurrence: rule({
				trigger: "on-close",
				nextDate: "2026-08-01",
				onCloseStartDateMode: "none",
				onCloseDueDateMode: "none",
			}),
		});
		const withUndefined = nodeTask({
			...base,
			recurrence: rule({ trigger: "on-close", nextDate: "2026-08-01" }),
		});
		const [a] = spawnPlans(snapshotWith([withNone]), withNone, "2026-09-05");
		const [b] = spawnPlans(
			snapshotWith([withUndefined]),
			withUndefined,
			"2026-09-05",
		);
		expect(a.startDate).toBeNull();
		expect(a.dueDate).toBeNull();
		expect(b.startDate).toBeNull();
		expect(b.dueDate).toBeNull();
	});

	it("nodeMatchesTrigger summarizes the trigger check for the UI", () => {
		const completedRule = rule({ trigger: "on-close", nextDate: "2026-09-05" });
		expect(
			nodeMatchesTrigger(nodeTask({ status: "done" }), completedRule, snapshotWith([])),
		).toBe(true);
		expect(
			nodeMatchesTrigger(nodeTask({ status: "todo" }), completedRule, snapshotWith([])),
		).toBe(false);
		expect(
			nodeMatchesTrigger(nodeTask({ status: "on-date" }), rule({ nextDate: "2026-09-05" }), snapshotWith([])),
		).toBe(true);
	});
});

describe("spawnPlans — idempotency and reconcile", () => {
	it("a node with an existing successor never spawns again", () => {
		const n = nodeTask({ recurrence: rule({ nextDate: "2026-09-05" }) });
		const next = nodeTask({
			path: "W/Tasks/TSK-9002",
			recurringFrom: n.path,
			recurrence: rule({ nextDate: "2026-09-06" }),
		});
		expect(spawnPlans(snapshotWith([n, next]), n, "2026-09-05")).toEqual([]);
	});

	it("reconcilePlans fans out across chains and is a no-op once applied", () => {
		const a = nodeTask({ recurrence: rule({ nextDate: "2026-09-05" }), path: "W/Tasks/TSK-9001" });
		const b = nodeTask({ recurrence: rule({ nextDate: "2026-09-05", interval: 2 }), path: "W/Tasks/TSK-9002" });
		const first = reconcilePlans(snapshotWith([a, b]), "2026-09-05");
		expect([...first.keys()].sort()).toEqual(["W/Tasks/TSK-9001", "W/Tasks/TSK-9002"]);
		expect(first.get(a.path)).toHaveLength(1);

		// Apply each batch the way the glue layer would, then re-reconcile.
		const applied = reconcilePlans(snapshotWith([a, b]), "2026-09-05");
		const now: Task[] = [a, b];
		for (const [source, plans] of applied) {
			plans.forEach((plan, index) => {
				now.push(
					nodeTask({
						path: `W/Tasks/TSK-9${30 + now.length}`,
						recurringFrom: source,
						recurrence: plan.recurrence,
						startDate: plan.startDate,
						dueDate: plan.dueDate,
					}),
				);
			});
		}
		expect(reconcilePlans(snapshotWith(now), "2026-09-05")).toEqual(new Map());
	});
});

/* ---------------------------------------------------------------- chains -- */

describe("chain traversal", () => {
	const a = nodeTask({
		path: "W/Tasks/TSK-9001",
		recurrence: rule({ nextDate: "2026-09-01" }),
	});
	const b = nodeTask({
		path: "W/Tasks/TSK-9002",
		recurringFrom: a.path,
		recurrence: rule({ nextDate: "2026-09-02" }),
	});
	const c = nodeTask({
		path: "W/Tasks/TSK-9003",
		recurringFrom: b.path,
		recurrence: rule({ nextDate: "2026-09-03" }),
	});
	const chain = snapshotWith([a, b, c]);

	it("walks the whole series oldest-first from either end", () => {
		expect(chainMembers(chain, c).map((t) => t.path)).toEqual([a.path, b.path, c.path]);
		expect(chainMembers(chain, a).map((t) => t.path)).toEqual([a.path, b.path, c.path]);
		expect(chainLength(chain, b)).toBe(3);
	});

	it("resolves the immediate neighbours, null at either end", () => {
		expect(nextInChain(chain, a)?.path).toBe(b.path);
		expect(nextInChain(chain, c)).toBeNull();
		expect(prevInChain(chain, b)?.path).toBe(a.path);
		expect(prevInChain(chain, a)).toBeNull();
	});

	it("recurrenceNodesInChain lists only nodes still carrying a schedule", () => {
		expect(recurrenceNodesInChain(chain, c).map((t) => t.path)).toEqual([
			a.path,
			b.path,
			c.path,
		]);
		const partiallyStopped = {
			...chain,
			tasks: chain.tasks.map((t) =>
				t.path === b.path ? { ...t, recurrence: null } : t,
			),
		};
		expect(recurrenceNodesInChain(partiallyStopped, c).map((t) => t.path)).toEqual([
			a.path,
			c.path,
		]);
		// Stopping clears schedules but the chain itself is preserved.
		expect(chainMembers(partiallyStopped, c)).toHaveLength(3);
	});
});

/* ------------------------------------------------------------- describe -- */

describe("describeRecurrence", () => {
	it("renders each cadence", () => {
		expect(describeFrequency(rule({ freq: "daily" }))).toBe("Every day");
		expect(describeFrequency(rule({ freq: "daily", interval: 3 }))).toBe("Every 3 days");
		expect(
			describeFrequency(
				rule({ freq: "weekly", interval: 1, weekdays: ["mon", "wed"] }),
			),
		).toBe("Every week on Monday and Wednesday");
		expect(
			describeFrequency(
				rule({ freq: "weekly", interval: 1, weekdays: ["mon", "wed", "fri"] }),
			),
		).toBe("Every week on Monday, Wednesday and Friday");
		expect(describeFrequency(rule({ freq: "weekly", interval: 2 }))).toBe("Every 2 weeks");
		expect(
			describeFrequency(rule({ freq: "monthly", dayOfMonth: 5 })),
		).toBe("Monthly on the 5th");
		expect(
			describeFrequency(rule({ freq: "monthly", dayOfMonth: 1 })),
		).toBe("Monthly on the 1st");
		expect(
			describeFrequency(rule({ freq: "monthly", weekdayOfMonth: 2 })),
		).toBe("Monthly on the 2nd occurrence");
		expect(describeFrequency(rule({ freq: "monthly" }))).toBe("Monthly");
		expect(
			describeFrequency(rule({ freq: "yearly", monthOfYear: 4, dayOfMonth: 10 })),
		).toBe("Every year on April 10th");
		expect(describeFrequency(rule({ freq: "yearly" }))).toBe("Every year");
	});

	it("renders each trigger", () => {
		const statuses = sample.workspace.statuses;
		expect(describeTrigger(rule({ trigger: "on-close" }), statuses)).toBe("when completed");
		expect(
			describeTrigger(
				rule({ trigger: "on-close", triggerStatus: "in-review" }),
				statuses,
			),
		).toBe("when status is In Review");
		expect(describeTrigger(rule({ trigger: "on-date" }), statuses)).toBe(
			"automatically on the due date",
		);
		expect(
			describeTrigger(rule({ trigger: "on-date", anchor: "startDate" }), statuses),
		).toBe("automatically on the start date");
	});

	it("combines cadence, trigger and end conditions into the summary line", () => {
		expect(
			describeRecurrence(
				rule({
					freq: "weekly",
					interval: 1,
					weekdays: ["mon", "wed"],
					trigger: "on-close",
					onCloseStartDateMode: "none",
					onCloseDueDateMode: "none",
					endsAfter: 5,
					endsOn: "2026-09-03",
				}),
				sample.workspace.statuses,
			),
		).toBe(
			"when completed, 5 occurrences total, until 2026-09-03",
		);
	});

	it("on-close with both date modes none reads exactly as a pre-feature rule", () => {
		expect(
			describeRecurrence(
				rule({
					trigger: "on-close",
					onCloseStartDateMode: "none",
					onCloseDueDateMode: "none",
				}),
				sample.workspace.statuses,
			),
		).toBe("when completed");
	});

	it("on-close appends a dates clause when a field is set", () => {
		const statuses = sample.workspace.statuses;
		expect(
			describeRecurrence(
				rule({
					trigger: "on-close",
					onCloseStartDateMode: "none",
					onCloseDueDateMode: "immediate",
				}),
				statuses,
			),
		).toBe("when completed, sets due today");
		expect(
			describeRecurrence(
				rule({
					trigger: "on-close",
					onCloseStartDateMode: "shifted",
					onCloseDueDateMode: "shifted",
				}),
				statuses,
			),
		).toBe(
			"when completed, sets start shifted and due shifted, relative to the due date",
		);
		expect(
			describeRecurrence(
				rule({
					trigger: "on-close",
					anchor: "startDate",
					onCloseStartDateMode: "none",
					onCloseDueDateMode: "shifted",
				}),
				statuses,
			),
		).toBe("when completed, sets due shifted, relative to the start date");
	});

	it("on-close puts the dates clause before the occurrence-count clause", () => {
		expect(
			describeRecurrence(
				rule({
					trigger: "on-close",
					onCloseStartDateMode: "none",
					onCloseDueDateMode: "immediate",
					endsAfter: 3,
				}),
				sample.workspace.statuses,
			),
		).toBe("when completed, sets due today, 3 occurrences total");
	});
});

/* -------------------------------------------------------------- overview -- */

describe("recurringOverview", () => {
	it("lists one row per chain (newest live member), sorted by title then id, with chain counts", () => {
		const alpha = nodeTask({
			path: "W/Tasks/TSK-9001",
			title: "Alpha",
			recurrence: rule({ nextDate: "2026-09-10" }),
		});
		const beta = nodeTask({
			path: "W/Tasks/TSK-9002",
			title: "Beta",
			recurrence: rule({ nextDate: "2026-08-01" }),
		});
		const betaNext = nodeTask({
			path: "W/Tasks/TSK-9003",
			title: "Beta",
			recurringFrom: beta.path,
			recurrence: rule({ nextDate: "2026-08-02" }),
		});
		const snap = snapshotWith([alpha, betaNext, beta]);
		const rows = recurringOverview(snap, "2026-09-05");

		// The two Beta nodes are one chain — only its newest member surfaces.
		expect(rows.map((row) => row.task.title)).toEqual(["Alpha", "Beta"]);
		expect(rows.map((row) => row.task.path)).toEqual([
			"W/Tasks/TSK-9001",
			"W/Tasks/TSK-9003",
		]);
		expect(rows[0].nextDate).toBe("2026-09-10"); // already future: unchanged
		expect(rows[0].chainLength).toBe(1);
		expect(rows[1].nextDate).toBe("2026-09-05");
		expect(rows[1].chainLength).toBe(2);
	});

	it("skips a chain whose newest member is archived", () => {
		const base = nodeTask({
			path: "W/Tasks/TSK-8001",
			title: "Gamma",
			recurrence: rule({ nextDate: "2026-08-01" }),
		});
		const latest = nodeTask({
			path: "W/Tasks/TSK-8002",
			title: "Gamma",
			recurringFrom: base.path,
			recurrence: rule({ nextDate: "2026-08-02" }),
			archived: true,
		});
		const rows = recurringOverview(snapshotWith([base, latest]), "2026-09-05");
		expect(rows).toHaveLength(0);
	});
});

/* ------------------------------------------------------------ projection -- */

describe("projectSeries", () => {
	const TODAY: IsoDate = "2026-09-10";
	const defaultStatus = sample.workspace.defaultNewTaskStatus;

	it("on-date: projects cadence points from today, capped at PROJECTION_MAX", () => {
		const node = nodeTask({
			dueDate: "2026-09-01",
			recurrence: rule({ freq: "daily", nextDate: "2026-09-01" }),
		});
		const ghosts = projectSeries(snapshotWith([node]), node, TODAY);

		expect(ghosts).toHaveLength(PROJECTION_MAX);
		expect(ghosts.every((g) => g.projected === true)).toBe(true);
		expect(ghosts[0].dueDate).toBe("2026-09-10");
		expect(ghosts[ghosts.length - 1].dueDate).toBe("2026-09-21");
		expect(ghosts.every((g) => g.recurringFrom === node.path)).toBe(true);
		expect(ghosts.every((g) => g.recurrence === null)).toBe(true);
		expect(ghosts.every((g) => g.path.includes("/occ/"))).toBe(true);
		expect(new Set(ghosts.map((g) => g.path)).size).toBe(ghosts.length);
	});

	it("on-date: stops at PROJECTION_HORIZON_DAYS when the cadence is sparse", () => {
		const node = nodeTask({
			dueDate: "2026-09-10",
			recurrence: rule({ freq: "weekly", interval: 1, nextDate: "2026-09-10" }),
		});
		const ghosts = projectSeries(snapshotWith([node]), node, TODAY);
		// 2026-09-10 + {0,7,14,21,28} all within the 30-day horizon.
		expect(ghosts.map((g) => g.dueDate)).toEqual([
			"2026-09-10",
			"2026-09-17",
			"2026-09-24",
			"2026-10-01",
			"2026-10-08",
		]);
		expect(PROJECTION_HORIZON_DAYS).toBe(30);
	});

	it("on-close: status-driven series have no date, so project nothing", () => {
		const node = nodeTask({
			dueDate: "2026-09-01",
			recurrence: rule({
				trigger: "on-close",
				freq: "weekly",
				interval: 1,
				nextDate: "2026-09-01",
			}),
		});
		expect(projectSeries(snapshotWith([node]), node, TODAY)).toEqual([]);
	});

	it("respects endsAfter against the existing chain length", () => {
		const first = nodeTask({
			path: "W/Tasks/TSK-1",
			dueDate: "2026-09-08",
			recurrence: null,
		});
		const node = nodeTask({
			path: "W/Tasks/TSK-2",
			dueDate: "2026-09-09",
			recurringFrom: "W/Tasks/TSK-1",
			recurrence: rule({ freq: "daily", nextDate: "2026-09-09", endsAfter: 3 }),
		});
		const ghosts = projectSeries(snapshotWith([first, node]), node, TODAY);
		// Chain already has 2 notes, budget is 3 → exactly one more.
		expect(ghosts).toHaveLength(1);
	});

	it("respects endsOn", () => {
		const node = nodeTask({
			dueDate: "2026-09-10",
			recurrence: rule({
				freq: "daily",
				nextDate: "2026-09-10",
				endsOn: "2026-09-13",
			}),
		});
		const ghosts = projectSeries(snapshotWith([node]), node, TODAY);
		expect(ghosts.map((g) => g.dueDate)).toEqual([
			"2026-09-10",
			"2026-09-11",
			"2026-09-12",
			"2026-09-13",
		]);
	});

	it("gives ghosts strictly increasing ranks, all after the source", () => {
		const node = nodeTask({
			rank: "0|i00000:",
			dueDate: "2026-09-10",
			recurrence: rule({ freq: "daily", nextDate: "2026-09-10" }),
		});
		const ghosts = projectSeries(snapshotWith([node]), node, TODAY);
		const ranks = ghosts.map((g) => g.rank);
		expect(ranks.every((r) => r > node.rank)).toBe(true);
		expect([...ranks]).toEqual([...ranks].sort());
	});

	it("uses newStatus when the rule sets one, else the workspace default", () => {
		const node = nodeTask({
			dueDate: "2026-09-10",
			recurrence: rule({ freq: "daily", nextDate: "2026-09-10" }),
		});
		expect(projectSeries(snapshotWith([node]), node, TODAY)[0].status).toBe(
			defaultStatus,
		);

		const withStatus = nodeTask({
			dueDate: "2026-09-10",
			recurrence: rule({
				freq: "daily",
				nextDate: "2026-09-10",
				newStatus: "in-progress",
			}),
		});
		expect(
			projectSeries(snapshotWith([withStatus]), withStatus, TODAY)[0].status,
		).toBe("in-progress");
	});
});

describe("projectRecurrences", () => {
	const TODAY: IsoDate = "2026-09-10";

	it("projects each series once, from the newest chain member", () => {
		const first = nodeTask({
			path: "W/Tasks/TSK-1",
			dueDate: "2026-09-08",
			recurrence: rule({ freq: "daily", nextDate: "2026-09-08" }),
		});
		const newest = nodeTask({
			path: "W/Tasks/TSK-2",
			dueDate: "2026-09-10",
			recurringFrom: "W/Tasks/TSK-1",
			recurrence: rule({ freq: "daily", nextDate: "2026-09-10" }),
		});
		const snap = snapshotWith([first, newest]);
		// Both chain members are "matched"; still one set of ghosts, from newest.
		const ghosts = projectRecurrences(snap, [first, newest], TODAY);
		expect(ghosts.every((g) => g.recurringFrom === newest.path)).toBe(true);
		expect(ghosts[0].dueDate).toBe("2026-09-10");
	});

	it("ignores tasks with no recurrence", () => {
		const plain = nodeTask({ path: "W/Tasks/TSK-9", recurrence: null });
		expect(projectRecurrences(snapshotWith([plain]), [plain], TODAY)).toEqual(
			[],
		);
	});
});

describe("evaluateView — recurring preview", () => {
	const TODAY: IsoDate = "2026-09-10";
	const recurringNode = nodeTask({
		path: "W/Tasks/TSK-R",
		title: "Weekly report",
		status: "todo",
		dueDate: "2026-09-10",
		recurrence: rule({
			freq: "daily",
			nextDate: "2026-09-10",
			newStatus: "todo",
		}),
	});
	const snap = snapshotWith([recurringNode]);

	it("adds nothing unless recurringPreview AND today are both supplied", () => {
		const off = evaluateView(
			snap,
			newView("v", "V", "list"),
			undefined,
			TODAY,
		);
		expect(off.tasks.every((t) => !t.projected)).toBe(true);

		const noToday = evaluateView(snap, {
			...newView("v", "V", "list"),
			recurringPreview: true,
		});
		expect(noToday.tasks.every((t) => !t.projected)).toBe(true);
	});

	it("merges projections after filtering; total/filteredOut stay real-only", () => {
		const evaluated = evaluateView(
			snap,
			{ ...newView("v", "V", "list"), recurringPreview: true, groupBy: "none" },
			undefined,
			TODAY,
		);
		const ghosts = evaluated.tasks.filter((t) => t.projected);
		expect(ghosts.length).toBeGreaterThan(0);
		// The one real task is the only thing counted.
		expect(evaluated.total).toBe(1);
		expect(evaluated.filteredOut).toBe(snap.tasks.length - 1);
	});

	it("board grouping drops ghosts into the rule's newStatus column", () => {
		const evaluated = evaluateView(
			snap,
			{
				...newView("v", "V", "board"),
				recurringPreview: true,
				groupBy: "status",
			},
			undefined,
			TODAY,
		);
		const todo = evaluated.groups.find((g) => g.key === "todo");
		expect(todo?.tasks.some((t) => t.projected)).toBe(true);
		const other = evaluated.groups.filter((g) => g.key !== "todo");
		expect(other.every((g) => g.tasks.every((t) => !t.projected))).toBe(true);
	});
});

describe("localTodayIso", () => {
	it("formats a Date as a local YYYY-MM-DD day, zero-padded", () => {
		expect(localTodayIso(new Date(2026, 0, 3, 23, 59))).toBe("2026-01-03");
		expect(localTodayIso(new Date(2026, 11, 25, 0, 0))).toBe("2026-12-25");
	});

	it("uses local calendar fields, not an instant in UTC", () => {
		const d = new Date(2026, 8, 6, 22, 30);
		expect(localTodayIso(d)).toBe("2026-09-06");
	});
});

/* -------------------------------------------------------------- copyFields -- */

describe("copyFields serialization and default behavior", () => {
	it("defaults to null when not provided", () => {
		const r = rule({ freq: "weekly" });
		expect(r.copyFields).toBeNull();
	});

	it("can be set to an array of field keys", () => {
		const r = rule({
			freq: "weekly",
			copyFields: ["priority", "labels"],
		});
		expect(r.copyFields).toEqual(["priority", "labels"]);
	});

	it("null copyFields means copy all fields (backward compatible)", () => {
		const r = rule({ copyFields: null });
		expect(r.copyFields).toBeNull();
	});
});