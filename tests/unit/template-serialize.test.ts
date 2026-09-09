import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { queryContext } from "../../src/core/query";
import { isSystemViewId } from "../../src/core/views";
import { serializeTemplateMarkdown } from "../../src/core/templates/markdown/serialize";
import { parseTemplateMarkdown } from "../../src/core/templates/markdown/parse";
import { resolveTemplateContent } from "../../src/core/templates/markdown/resolve";
import { formatTaskId } from "../../src/core/ids";
import { joinPath } from "../../src/core/links";
import type { TemplateBuildContext } from "../../src/core/templates/types";

const DAY = 24 * 60 * 60 * 1000;
function ctx(): TemplateBuildContext {
	const now = new Date("2026-08-26T12:00:00Z");
	const iso = (o: number) => new Date(now.getTime() + o * DAY).toISOString();
	return {
		root: "WS",
		idPrefix: "FIX",
		now,
		iso,
		day: (o) => iso(o).slice(0, 10),
		taskPath: (n) => joinPath("WS", "Tasks", formatTaskId("FIX", n)),
	};
}

const snapshot = sampleSnapshot();

function roundTrip() {
	const source = serializeTemplateMarkdown({
		meta: { id: "my-template", name: "My Template", icon: "rocket" },
		workspace: snapshot.workspace,
		views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
		dashboards: snapshot.dashboards,
		queryContext: queryContext(snapshot),
	});
	const parsed = parseTemplateMarkdown(source);
	const content = resolveTemplateContent(parsed, ctx());
	return { source, parsed, content };
}

describe("serializeTemplateMarkdown round-trip", () => {
	it("reproduces the taxonomy with names, colors, categories and order", () => {
		const { parsed } = roundTrip();
		const statuses = parsed.workspaceOverrides.statuses!;
		expect(statuses.map((s) => s.name)).toEqual(
			snapshot.workspace.statuses.map((s) => s.name),
		);
		expect(statuses.map((s) => s.category)).toEqual(
			snapshot.workspace.statuses.map((s) => s.category),
		);
		expect(statuses.map((s) => s.color)).toEqual(
			snapshot.workspace.statuses.map((s) => s.color),
		);
		expect(statuses.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(parsed.workspaceOverrides.labels!.map((l) => l.name)).toEqual(
			snapshot.workspace.labels.map((l) => l.name),
		);
	});

	it("carries the people roster with no '*' me marker", () => {
		const { parsed } = roundTrip();
		expect(parsed.workspaceOverrides.people!.map((p) => p.name).sort()).toEqual(
			["Alice", "Bob"],
		);
		expect(parsed.mePersonId).toBeUndefined();
	});

	it("reproduces views through the query round-trip", () => {
		const { content } = roundTrip();
		const names = content.views!.map((v) => v.name);
		expect(names).toContain("Sprint Board");
		const sprint = content.views!.find((v) => v.name === "Sprint Board")!;
		expect(sprint.viewType).toBe("board");
		expect(sprint.groupBy).toBe("status");
	});

	it("reproduces dashboards (widget count + chart types)", () => {
		const { content } = roundTrip();
		const dash = content.dashboards!.find((d) => d.name === "Sprint Overview")!;
		expect(dash.widgets.length).toBe(3);
		expect(dash.widgets.map((w) => w.chartType).sort()).toEqual([
			"bar",
			"pie",
			"timeline",
		]);
	});

	it("emits empty Projects/Tasks and supportsExampleContent: false", () => {
		const { parsed, content } = roundTrip();
		expect(parsed.projects).toEqual([]);
		expect(parsed.tasks).toEqual([]);
		expect(content.projects).toEqual([]);
		expect(content.tasks).toEqual([]);
		expect(parsed.meta.supportsExampleContent).toBe(false);
	});


	it("round-trips an optional createdAt timestamp", () => {
		const source = serializeTemplateMarkdown({
			meta: {
				id: "my-template",
				name: "My Template",
				createdAt: "2026-08-26T12:00:00.000Z",
			},
			workspace: snapshot.workspace,
			views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
			dashboards: snapshot.dashboards,
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.meta.createdAt).toBe("2026-08-26T12:00:00.000Z");
	});


	it("leaves createdAt undefined when the template doesn't set one", () => {
		const { parsed } = roundTrip();
		expect(parsed.meta.createdAt).toBeUndefined();
	});
});
