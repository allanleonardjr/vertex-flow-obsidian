import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import {
	parseQuery,
	printFilters,
	printQuery,
	queryContext,
} from "../../src/core/query";
import { canonicalizeFilters, viewDefinition } from "../../src/core/views";
import { defaultViews } from "../../src/core/views/defaults";
import { NONE, type ViewFilters } from "../../src/core/types";

const snapshot = sampleSnapshot();
const ctx = queryContext(snapshot);

describe("printFilters", () => {
	const cases: [string, ViewFilters][] = [
		["empty", {}],
		["status + type", { status: ["todo", "in-progress"], taskType: ["bug"] }],
		["labels", { labels: ["backend", "performance"] }],
		["text", { text: "auth" }],
		["archived + flags", { archived: "only", openOnly: true, recurring: true }],
		["unset", { labels: ["unset"] }],
		["due date exact", { dueDate: ["2026-09-19", "2026-09-20"] }],
		["due date unset", { dueDate: ["unset"] }],
		[
			"every date field, exact + bound",
			{
				dueDate: ["2026-09-19"],
				startDate: ["2026-09-01"],
				createdAt: ["2026-08-01"],
				updatedAt: ["2026-08-15"],
				completedAt: ["2026-09-10"],
				dueDateBefore: "2026-10-01",
				dueDateAfter: "2026-09-01",
				startDateBefore: "2026-09-15",
				startDateAfter: "2026-08-15",
				createdAtBefore: "2026-08-20",
				createdAtAfter: "2026-07-20",
				updatedAtBefore: "2026-09-01",
				updatedAtAfter: "2026-08-01",
				completedAtBefore: "2026-09-20",
				completedAtAfter: "2026-09-01",
			},
		],
		[
			"include and exclude on the same field",
			{
				status: ["todo", "in-progress"],
				excludeStatus: ["blocked"],
				priority: ["high"],
				excludePriority: [NONE],
			},
		],
	];

	for (const [name, filters] of cases) {
		it(`round-trips ${name} through parseQuery`, () => {
			const printed = printFilters(filters, ctx);
			const parsed = parseQuery(printed, ctx);
			expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
			expect(parsed.definition.filters).toEqual(canonicalizeFilters(filters));
		});
	}

	it("emits no layout tokens", () => {
		const printed = printFilters({ status: ["todo"] }, ctx);
		expect(printed).not.toMatch(/\b(group|sort|hide|layout|empty|subtasks|date):/);
	});
});

describe("printQuery is unchanged for the query bar", () => {
	it("still prints group and sort for a default view", () => {
		expect(printQuery(viewDefinition(defaultViews()[0]), ctx)).toContain("group:");
		expect(printQuery(viewDefinition(defaultViews()[0]), ctx)).toContain("sort:");
	});

	it("prepends the filter clause to the layout clauses", () => {
		const printed = printQuery(
			{ ...viewDefinition(defaultViews()[0]), filters: { taskType: ["bug"] } },
			ctx,
		);
		expect(printed.startsWith("type:bug ")).toBe(true);
	});
});
