import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/sample/generate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import {
	applyFilters,
	canonicalizeDefinition,
	canonicalizeFilters,
	defaultViews,
	definitionsEqual,
	matchesFilters,
	snapshotContext,
	viewDefinition,
} from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import {
	NONE,
	SELF,
	TASK_FIELDS,
	type ViewDefinition,
	type ViewFilters,
} from "../../src/core/types";

const snapshot = sampleSnapshot();
const ctx = queryContext(snapshot);
const viewCtx = snapshotContext(snapshot);

const def = (partial: Partial<ViewDefinition> = {}): ViewDefinition => ({
	...DEFAULT_DEFINITION,
	...partial,
});

const withFilters = (filters: ViewFilters): ViewDefinition => def({ filters });

/** The guarantee the sync loop's termination depends on. */
function expectRoundTrip(definition: ViewDefinition) {
	const source = printQuery(definition, ctx);
	const parsed = parseQuery(source, ctx);
	expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
	expect(parsed.ok).toBe(true);
	expect(parsed.definition).toEqual(canonicalizeDefinition(definition));
	return source;
}

const project = ctx.projects[0].path;
const spacedProject =
	ctx.projects.find((p) => p.path.includes("&"))?.path ?? ctx.projects[1].path;
const taskPath = ctx.tasks[0].path;

/* ----------------------------------------------------------- round-trip -- */

describe("round-trip (Invariant A)", () => {
	const cases: [string, ViewDefinition][] = [
		["empty", def()],
		["status", withFilters({ status: ["todo"] })],
		["multi-value status", withFilters({ status: ["todo", "in-progress"] })],
		["priority", withFilters({ priority: ["high"] })],
		["taskType", withFilters({ taskType: ["bug"] })],
		["labels", withFilters({ labels: ["design", "docs"] })],
		["assignee id", withFilters({ assignee: ["alice"] })],
		["assignee self", withFilters({ assignee: [SELF] })],
		["mentions self", withFilters({ mentions: [SELF] })],
		["project", withFilters({ project: [project] })],
		["project with spaces", withFilters({ project: [spacedProject] })],
		["parent", withFilters({ parent: [taskPath] })],
		["initiative (retained)", withFilters({ initiative: ["Initiatives/X"] })],
		["cycle (retained)", withFilters({ cycle: ["Cycles/2026-Cycle-18"] })],
		["topLevelOnly", withFilters({ topLevelOnly: true })],
		["includeArchived", withFilters({ includeArchived: true })],
		["text", withFilters({ text: "login" })],
		["text with spaces", withFilters({ text: "login screen" })],
		["text with a colon", withFilters({ text: "status:todo" })],
		["text with a comma", withFilters({ text: "a,b" })],
		["text with a quote", withFilters({ text: 'say "hi"' })],
		["text with a backslash", withFilters({ text: "a\\b" })],
		["text with wide spacing", withFilters({ text: "a   b" })],
		["NONE priority", withFilters({ priority: [NONE] })],
		["NONE labels", withFilters({ labels: [NONE] })],
		["NONE assignee", withFilters({ assignee: [NONE] })],
		["NONE project", withFilters({ project: [NONE] })],
		["NONE parent", withFilters({ parent: [NONE] })],
		["stale taxonomy id", withFilters({ status: ["long-gone"] })],
		["stale person", withFilters({ assignee: ["ghost"] })],
		["board layout", def({ viewType: "board" })],
		["grouping", def({ groupBy: "priority" })],
		["sorting", def({ sortBy: "dueDate" })],
		["descending", def({ sortBy: "dueDate", sortDirection: "desc" })],
		["empty behaviour", def({ emptyColumnBehavior: "auto-collapse" })],
		["hidden fields", def({ hiddenFields: ["priority", "labels"] })],
		["all fields hidden", def({ hiddenFields: [...TASK_FIELDS] })],
		[
			"everything at once",
			def({
				viewType: "board",
				groupBy: "label",
				sortBy: "updatedAt",
				sortDirection: "desc",
				emptyColumnBehavior: "auto-hide",
				hiddenFields: ["type", "progress"],
				filters: {
					status: ["todo", "in-progress"],
					priority: ["high", NONE],
					taskType: ["bug"],
					labels: ["design"],
					assignee: [SELF, "bob"],
					mentions: [SELF],
					project: [project],
					parent: [taskPath],
					text: "onboarding flow",
					topLevelOnly: true,
					includeArchived: true,
				},
			}),
		],
	];

	for (const [name, definition] of cases) {
		it(name, () => expectRoundTrip(definition));
	}

	it("prints every grouping, sort field and layout reversibly", () => {
		const groups = [
			"none", "status", "priority", "taskType", "assignee", "label", "project",
		] as const;
		const sorts = [
			"rank", "priority", "status", "title", "dueDate", "startDate",
			"estimate", "createdAt", "updatedAt",
		] as const;
		for (const groupBy of groups) expectRoundTrip(def({ groupBy }));
		for (const sortBy of sorts) {
			expectRoundTrip(def({ sortBy }));
			expectRoundTrip(def({ sortBy, sortDirection: "desc" }));
		}
		for (const viewType of ["list", "board"] as const) {
			expectRoundTrip(def({ viewType }));
		}
		for (const field of TASK_FIELDS) {
			expectRoundTrip(def({ hiddenFields: [field] }));
		}
	});
});

describe("round-trip (generative)", () => {
	// A tiny LCG rather than a property-testing dependency, matching the rest
	// of the suite's zero-dependency style.
	let seed = 0x2545f491;
	const next = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	const pick = <T,>(items: readonly T[]): T =>
		items[Math.floor(next() * items.length)];

	const adversarial = [
		"a,b", "a:b", 'a"b', "a\\b", "me", "self", "unset", "none", "=x",
		"  ", "", "Projects/A", "A", "café", "在庫", "-x", "a b",
	];
	const pool = [
		...adversarial,
		"todo", "in-progress", "high", "bug", "design", "alice", "bob",
		NONE, SELF, project, spacedProject, taskPath,
	];
	const arrayKeys = [
		"status", "priority", "taskType", "labels", "assignee",
		"mentions", "project", "parent", "initiative", "cycle",
	] as const;

	it("survives 400 random definitions", () => {
		for (let n = 0; n < 400; n += 1) {
			const filters: ViewFilters = {};
			for (const key of arrayKeys) {
				if (next() < 0.25) {
					const count = 1 + Math.floor(next() * 3);
					filters[key] = Array.from({ length: count }, () => pick(pool));
				}
			}
			if (next() < 0.3) filters.text = pick(pool);
			if (next() < 0.2) filters.topLevelOnly = true;
			if (next() < 0.2) filters.includeArchived = true;

			const hiddenFields = TASK_FIELDS.filter(() => next() < 0.3);

			expectRoundTrip(
				def({
					filters,
					hiddenFields,
					viewType: pick(["list", "board"] as const),
					groupBy: pick(["none", "status", "priority", "label"] as const),
					sortBy: pick(["rank", "title", "dueDate", "estimate"] as const),
					sortDirection: pick(["asc", "desc"] as const),
					emptyColumnBehavior: pick([
						"show-normal", "auto-collapse", "auto-hide",
					] as const),
				}),
			);
		}
	});
});

describe("print idempotence (Invariant B)", () => {
	it("is a fixpoint", () => {
		const definition = def({
			groupBy: "label",
			sortDirection: "desc",
			sortBy: "dueDate",
			filters: {
				status: ["todo"],
				labels: ["design", NONE],
				assignee: [SELF],
				text: "a b",
			},
		});
		const once = printQuery(definition, ctx);
		const twice = printQuery(parseQuery(once, ctx).definition, ctx);
		expect(twice).toBe(once);
	});
});

/* ------------------------------------------------------- canonicalisation -- */

describe("canonicalisation", () => {
	it("drops no-ops", () => {
		expect(
			canonicalizeFilters({
				status: [],
				text: "   ",
				topLevelOnly: false,
				includeArchived: false,
			}),
		).toEqual({});
	});

	it("trims text and dedupes preserving first occurrence", () => {
		expect(
			canonicalizeFilters({ status: ["b", "a", "b"], text: "  hi  " }),
		).toEqual({ status: ["b", "a"], text: "hi" });
	});

	it("is idempotent", () => {
		const once = canonicalizeFilters({ labels: ["a", "a"], text: " x " });
		expect(canonicalizeFilters(once)).toEqual(once);
	});

	it("makes equality insensitive to key order", () => {
		const a = withFilters({ status: ["todo"], labels: ["design"] });
		const b = withFilters({ labels: ["design"], status: ["todo"] });
		expect(definitionsEqual(a, b)).toBe(true);
	});

	it("viewDefinition drops identity and column state", () => {
		expect(Object.keys(viewDefinition(defaultViews()[0])).sort()).toEqual([
			"emptyColumnBehavior", "filters", "groupBy", "hiddenFields",
			"sortBy", "sortDirection", "viewType",
		]);
	});

	it("does not change what a filter set matches (Invariant C)", () => {
		const filterSets: ViewFilters[] = [
			{ status: ["todo", "todo"], text: " onboarding " },
			{ labels: [], priority: ["high"], topLevelOnly: false },
			{ assignee: [SELF], includeArchived: false },
		];
		for (const filters of filterSets) {
			for (const task of snapshot.tasks) {
				expect(matchesFilters(task, canonicalizeFilters(filters), viewCtx)).toBe(
					matchesFilters(task, filters, viewCtx),
				);
			}
		}
	});
});

/* ------------------------------------------------------------- defaults -- */

describe("defaults", () => {
	it("prints the built-in All Tasks view", () => {
		expect(printQuery(viewDefinition(defaultViews()[0]), ctx)).toBe(
			"is:top-level group:status sort:rank",
		);
	});

	it("parses an empty query to the base defaults", () => {
		const parsed = parseQuery("   ", ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual(canonicalizeDefinition(DEFAULT_DEFINITION));
	});

	it("leaves unmentioned fields at their defaults", () => {
		expect(parseQuery("group:priority", ctx).definition).toEqual(
			canonicalizeDefinition(def({ groupBy: "priority" })),
		);
	});

	it("prints no hide: clause when nothing is hidden", () => {
		expect(printQuery(def(), ctx)).not.toContain("hide:");
		expect(printQuery(viewDefinition(defaultViews()[0]), ctx)).not.toContain(
			"hide:",
		);
	});
});

/* --------------------------------------------------------- hidden fields -- */

describe("hide: clause", () => {
	it("parses a comma-separated list into hiddenFields", () => {
		expect(parseQuery("hide:priority,labels", ctx).definition.hiddenFields).toEqual(
			["priority", "labels"],
		);
	});

	it("maps a field alias to its canonical member", () => {
		expect(parseQuery("hide:due", ctx).definition.hiddenFields).toEqual([
			"dueDate",
		]);
	});

	it("prints hiddenFields in canonical order", () => {
		expect(
			printQuery(def({ hiddenFields: ["labels", "type"] }), ctx),
		).toContain("hide:type,labels");
	});

	it("errors on an unknown field", () => {
		const parsed = parseQuery("hide:bogus", ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].code).toBe("unknown-value");
	});

	it("errors on hide: with no value", () => {
		const parsed = parseQuery("hide:", ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].code).toBe("empty-value");
	});

	it("warns but still parses a repeated hide:", () => {
		const parsed = parseQuery("hide:priority hide:labels", ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.issues.map((i) => i.code)).toContain("duplicate-field");
		expect(parsed.definition.hiddenFields).toEqual(["priority", "labels"]);
	});
});

/* --------------------------------------------------------- name resolution -- */

describe("resolution", () => {
	it("accepts ids, names and casings interchangeably", () => {
		for (const source of [
			"status:in-progress",
			'status:"In Progress"',
			"status:IN-PROGRESS",
			"Status:In-Progress",
			"state:in-progress",
		]) {
			expect(parseQuery(source, ctx).definition.filters.status).toEqual([
				"in-progress",
			]);
		}
	});

	it("accepts sort and group aliases", () => {
		expect(parseQuery("sort:manual", ctx).definition.sortBy).toBe("rank");
		expect(parseQuery("sort:due", ctx).definition.sortBy).toBe("dueDate");
		expect(parseQuery("group:type", ctx).definition.groupBy).toBe("taskType");
		const desc = parseQuery("sort:-due", ctx).definition;
		expect(desc.sortBy).toBe("dueDate");
		expect(desc.sortDirection).toBe("desc");
	});

	it("resolves people by name and alias", () => {
		for (const source of ["assignee:alice", "assignee:Alice", "assignee:al"]) {
			expect(parseQuery(source, ctx).definition.filters.assignee).toEqual([
				"alice",
			]);
		}
	});

	it("resolves a project by its basename", () => {
		const parsed = parseQuery(`project:"Core App Experience"`, ctx);
		expect(parsed.definition.filters.project).toEqual([project]);
	});

	it("means the same thing as a hand-built filter set", () => {
		const parsed = parseQuery("status:todo,in-progress type:bug", ctx);
		expect(applyFilters(snapshot.tasks, parsed.definition.filters, viewCtx)).toEqual(
			applyFilters(
				snapshot.tasks,
				{ status: ["todo", "in-progress"], taskType: ["bug"] },
				viewCtx,
			),
		);
	});

	it("keeps reserved keywords ahead of taxonomy values, with = as the escape", () => {
		expect(parseQuery("label:unset", ctx).definition.filters.labels).toEqual([
			NONE,
		]);
		expect(parseQuery("label:=unset", ctx).definition.filters.labels).toEqual([
			"unset",
		]);
		expect(printQuery(withFilters({ labels: ["unset"] }), ctx)).toBe(
			"label:=unset group:none sort:rank",
		);
	});

	it("stores 'me' even when nobody is flagged isSelf, and says so", () => {
		const lonely = { ...ctx, selfId: null };
		const parsed = parseQuery("assignee:me", lonely);
		expect(parsed.definition.filters.assignee).toEqual([SELF]);
		expect(parsed.ok).toBe(true);
		expect(parsed.issues[0].code).toBe("self-unconfigured");
	});

	it("keeps topLevelOnly and parent:unset structurally distinct", () => {
		const a = withFilters({ topLevelOnly: true });
		const b = withFilters({ parent: [NONE] });
		expect(printQuery(a, ctx)).not.toBe(printQuery(b, ctx));
		expectRoundTrip(a);
		expectRoundTrip(b);
		// ...even though `matchesLink` makes them agree on every task.
		for (const task of snapshot.tasks) {
			expect(matchesFilters(task, a.filters, viewCtx)).toBe(
				matchesFilters(task, b.filters, viewCtx),
			);
		}
	});

	it("refuses to guess an ambiguous basename", () => {
		const ambiguous = {
			...ctx,
			projects: [
				{ path: "Projects/A", title: "A" },
				{ path: "Archive/A", title: "A" },
			],
		};
		const parsed = parseQuery("project:A", ambiguous);
		expect(parsed.definition.filters.project).toEqual(["A"]);
		expect(parsed.issues.map((i) => i.code)).toContain("unknown-value");
		// Printing must therefore use the full path, not the shared basename.
		expect(printQuery(withFilters({ project: ["Projects/A"] }), ambiguous)).toBe(
			"project:Projects/A group:none sort:rank",
		);
	});
});

/* ---------------------------------------------------------- diagnostics -- */

describe("diagnostics", () => {
	const at = (source: string, issue: { span: { start: number; end: number } }) =>
		source.slice(issue.span.start, issue.span.end);

	it("flags a field with no value", () => {
		const source = "status:";
		const parsed = parseQuery(source, ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].code).toBe("empty-value");
		expect(at(source, parsed.issues[0])).toBe("status:");
	});

	it("flags an unknown field and suggests the nearest", () => {
		const source = "staus:todo";
		const parsed = parseQuery(source, ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].code).toBe("unknown-field");
		expect(parsed.issues[0].suggestion).toBe("status");
		expect(at(source, parsed.issues[0])).toBe("staus");
	});

	it("flags an unterminated quote", () => {
		const parsed = parseQuery('label:"bug', ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues[0].code).toBe("unterminated-quote");
	});

	it("rejects tokens ViewFilters cannot express, with a pointer", () => {
		for (const source of ["is:archived", "archived:true", "archived:only"]) {
			const parsed = parseQuery(source, ctx);
			expect(parsed.ok).toBe(false);
			expect(parsed.issues[0].code).toBe("not-expressible");
			expect(parsed.issues[0].suggestion).toBe("show:archived");
		}
		const subtask = parseQuery("is:sub-task", ctx);
		expect(subtask.issues[0].code).toBe("not-expressible");
		expect(subtask.issues[0].suggestion).toBe("parent:");
	});

	it("errors on an unknown grouping or sort field", () => {
		expect(parseQuery("group:nonsense", ctx).ok).toBe(false);
		expect(parseQuery("sort:nonsense", ctx).ok).toBe(false);
	});

	it("warns rather than errors on a vacuous filter", () => {
		for (const source of ["mentions:unset", "status:unset"]) {
			const parsed = parseQuery(source, ctx);
			expect(parsed.ok).toBe(true);
			expect(parsed.issues.map((i) => i.code)).toContain("vacuous-value");
		}
	});

	it("warns on an unknown value but keeps it", () => {
		const parsed = parseQuery("status:long-gone", ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.issues[0].code).toBe("unknown-value");
		expect(parsed.definition.filters.status).toEqual(["long-gone"]);
	});

	it("merges a duplicated field and says so", () => {
		const parsed = parseQuery("status:todo status:done", ctx);
		expect(parsed.definition.filters.status).toEqual(["todo", "done"]);
		expect(parsed.issues.map((i) => i.code)).toContain("duplicate-field");
	});

	it("still returns usable filters when part of the query is broken", () => {
		const parsed = parseQuery("status:todo lbel:bug", ctx);
		expect(parsed.ok).toBe(false);
		expect(parsed.definition.filters.status).toEqual(["todo"]);
	});

	it("treats a quoted field-shaped token as text", () => {
		const parsed = parseQuery('"status:todo"', ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition.filters.text).toBe("status:todo");
		expect(parsed.definition.filters.status).toBeUndefined();
	});

	it("collects bare words into free text", () => {
		expect(parseQuery("login screen status:todo", ctx).definition.filters.text).toBe(
			"login screen",
		);
	});
});
