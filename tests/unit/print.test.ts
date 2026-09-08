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
import type { ViewFilters } from "../../src/core/types";

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
