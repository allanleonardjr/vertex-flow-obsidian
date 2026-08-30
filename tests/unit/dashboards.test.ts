import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { snapshotContext } from "../../src/core/views";
import { applyFilters } from "../../src/core/views/filter";
import {
	detectDashboardIdCollisions,
	parseDashboards,
	serializeDashboards,
	parseDashboard,
	serializeDashboard,
} from "../../src/core/serialization/dashboards";
import {
	CHART_META,
	computeWidgetData,
	defaultFieldMapping,
	firstOpenSlot,
	isFieldMappingValid,
	newDashboard,
	newWidget,
	retargetFieldMapping,
} from "../../src/core/dashboards";
import type {
	DashboardConfig,
	DashboardWidget,
} from "../../src/core/types";

const snapshot = sampleSnapshot();
const context = snapshotContext(snapshot);

function widget(partial: Partial<DashboardWidget> & Pick<DashboardWidget, "id" | "chartType" | "fieldMapping">): DashboardWidget {
	return {
		title: "",
		titleIsCustom: false,
		layout: { x: 0, y: 0, w: 6, h: 4 },
		...partial,
	};
}

describe("compatibility matrix", () => {
	it("accepts every default field mapping", () => {
		for (const chartType of ["bar", "line", "pie", "timeline", "kpi"] as const) {
			expect(isFieldMappingValid(defaultFieldMapping(chartType))).toBe(true);
		}
	});

	it("rejects a bar chart grouped by a temporal field", () => {
		expect(
			isFieldMappingValid({
				chartType: "bar",
				// @ts-expect-error deliberately invalid
				groupBy: "dueDate",
			}),
		).toBe(false);
	});

	it("keeps a grouping field when retargeting bar → pie", () => {
		const mapping = retargetFieldMapping(
			{ chartType: "bar", groupBy: "priority" },
			"pie",
		);
		expect(mapping).toEqual({ chartType: "pie", groupBy: "priority" });
	});

	it("keeps the temporal field when retargeting line → timeline", () => {
		const mapping = retargetFieldMapping(
			{ chartType: "line", xField: "dueDate", bucket: "month", groupBy: "status" },
			"timeline",
		);
		expect(mapping).toMatchObject({
			chartType: "timeline",
			xField: "dueDate",
			bucket: "month",
			groupBy: "status",
		});
	});

	it("falls back to defaults when retargeting across kinds (pie → line)", () => {
		const mapping = retargetFieldMapping(
			{ chartType: "pie", groupBy: "status" },
			"line",
		);
		expect(mapping).toEqual(defaultFieldMapping("line"));
	});
});

describe("parse / serialize round-trip", () => {
	const source: DashboardConfig = {
		type: "dashboard",
		// `serializeDashboard` never emits `path`; `parseDashboards` (plural) leaves it blank.
		path: "",
		id: "overview",
		name: "Overview",
		icon: "gauge",
		filters: { status: ["todo", "in-progress"], assignee: ["alice"] },
		widgets: [
			widget({
				id: "w1",
				chartType: "bar",
				title: "By status",
				titleIsCustom: true,
				fieldMapping: { chartType: "bar", groupBy: "status" },
				layout: { x: 0, y: 0, w: 6, h: 4 },
			}),
			widget({
				id: "w2",
				chartType: "line",
				fieldMapping: {
					chartType: "line",
					xField: "createdAt",
					bucket: "week",
					groupBy: "priority",
				},
				layout: { x: 6, y: 0, w: 6, h: 4 },
			}),
			widget({
				id: "w3",
				chartType: "kpi",
				fieldMapping: {
					chartType: "kpi",
					metric: "estimateSum",
					scope: { field: "status", value: "done" },
				},
				layout: { x: 0, y: 4, w: 3, h: 3 },
			}),
		],
	};

	it("survives a full round-trip unchanged", () => {
		const raw = serializeDashboards([source]);
		const parsed = parseDashboards(raw);
		expect(parsed.issues).toEqual([]);
		expect(parsed.value).toEqual([source]);
	});

	it("omits empty/default fields from the serialized form", () => {
		const raw = serializeDashboards([source]) as {
			dashboards: Array<Record<string, unknown>>;
		};
		const w2 = (raw.dashboards[0].widgets as Array<Record<string, unknown>>)[1];
		expect(w2).not.toHaveProperty("titleIsCustom");
		expect(w2).not.toHaveProperty("title");
	});
});

describe("forgiving parsing", () => {
	it("returns an empty list for junk input", () => {
		expect(parseDashboards(null).value).toEqual([]);
		expect(parseDashboards({ dashboards: "nope" }).value).toEqual([]);
		expect(parseDashboards({ dashboards: [] }).value).toEqual([]);
	});

	it("drops a widget with an unknown chart type and logs it", () => {
		const parsed = parseDashboard(
			{
				id: "d",
				name: "D",
				widgets: [
					{ id: "bad", chartType: "sankey", fieldMapping: {} },
					{ id: "ok", chartType: "pie", fieldMapping: { groupBy: "label" } },
				],
			},
			{ path: "Dashboards/d" },
		);
		expect(parsed.value.widgets.map((w) => w.id)).toEqual(["ok"]);
		expect(parsed.issues.join(" ")).toMatch(/unknown chart type/i);
	});

	it("repairs a malformed field mapping to the chart-type default", () => {
		const parsed = parseDashboard(
			{
				id: "d",
				name: "D",
				widgets: [
					{ id: "w", chartType: "bar", fieldMapping: { groupBy: "dueDate" } },
				],
			},
			{ path: "Dashboards/d" },
		);
		expect(parsed.value.widgets[0].fieldMapping).toEqual(
			defaultFieldMapping("bar"),
		);
	});

	it("de-duplicates widget ids, keeping the first", () => {
		const parsed = parseDashboard(
			{
				id: "d",
				name: "D",
				widgets: [
					{ id: "dup", chartType: "bar", fieldMapping: { groupBy: "status" } },
					{ id: "dup", chartType: "pie", fieldMapping: { groupBy: "label" } },
				],
			},
			{ path: "Dashboards/d" },
		);
		expect(parsed.value.widgets).toHaveLength(1);
		expect(parsed.value.widgets[0].chartType).toBe("bar");
		expect(parsed.issues.join(" ")).toMatch(/duplicate widget id/i);
	});

	it("de-duplicates dashboard ids across the file", () => {
		const parsed = parseDashboards({
			dashboards: [
				{ id: "x", name: "First", widgets: [] },
				{ id: "x", name: "Second", widgets: [] },
			],
		});
		expect(parsed.value).toHaveLength(1);
		expect(parsed.value[0].name).toBe("First");
		expect(parsed.issues.join(" ")).toMatch(/duplicate dashboard id/i);
	});

	it("defaults a missing layout to the standard widget size", () => {
		const parsed = parseDashboard(
			{ id: "d", name: "D", widgets: [{ id: "w", chartType: "kpi", fieldMapping: {} }] },
			{ path: "Dashboards/d" },
		);
		expect(parsed.value.widgets[0].layout).toEqual({ x: 0, y: 0, w: 6, h: 4 });
	});
});

describe("parseDashboard (per-file)", () => {
	it("tags the note path + type and takes its id from frontmatter", () => {
		const { value } = parseDashboard(
			{ id: "health", name: "Health", widgets: [] },
			{ path: "W/Dashboards/health" },
		);
		expect(value.type).toBe("dashboard");
		expect(value.path).toBe("W/Dashboards/health");
		expect(value.id).toBe("health");
	});

	it("falls back to the filename when frontmatter omits the id", () => {
		const { value } = parseDashboard({ name: "X" }, { path: "W/Dashboards/team-health" });
		expect(value.id).toBe("team-health");
	});

	it("round-trips through serializeDashboard, which emits type: dashboard", () => {
		const { value } = parseDashboard(
			{
				id: "d",
				name: "D",
				filters: { status: ["todo"] },
				widgets: [{ id: "w", chartType: "pie", fieldMapping: { groupBy: "label" } }],
			},
			{ path: "W/Dashboards/d" },
		);
		const frontmatter = serializeDashboard(value);
		expect(frontmatter.type).toBe("dashboard");
		expect(parseDashboard(frontmatter, { path: "W/Dashboards/d" }).value).toEqual(value);
	});

	it("detectDashboardIdCollisions flags every file in a colliding pair", () => {
		const a = parseDashboard({ id: "dup" }, { path: "W/Dashboards/a" }).value;
		const b = parseDashboard({ id: "dup" }, { path: "W/Dashboards/b" }).value;
		const c = parseDashboard({ id: "ok" }, { path: "W/Dashboards/c" }).value;
		expect(
			detectDashboardIdCollisions([a, b, c]).map((x) => x.path).sort(),
		).toEqual(["W/Dashboards/a", "W/Dashboards/b"]);
		expect(detectDashboardIdCollisions([a, c])).toEqual([]);
	});
});

describe("computeWidgetData", () => {
	const tasks = applyFilters(snapshot.tasks, {}, context);

	it("counts tasks per status for a bar chart, in taxonomy order", () => {
		const data = computeWidgetData(
			widget({ id: "w", chartType: "bar", fieldMapping: { chartType: "bar", groupBy: "status" } }),
			tasks,
			context,
		);
		expect(data.kind).toBe("categorical");
		if (data.kind !== "categorical") return;
		const total = data.data.reduce((n, d) => n + d.value, 0);
		expect(total).toBe(tasks.length);
		expect(data.data.every((d) => typeof d.color === "string")).toBe(true);
	});

	it("pulls segment colours from the status taxonomy", () => {
		const data = computeWidgetData(
			widget({ id: "w", chartType: "pie", fieldMapping: { chartType: "pie", groupBy: "status" } }),
			tasks,
			context,
		);
		if (data.kind !== "categorical") throw new Error("expected categorical");
		const done = data.data.find((d) => d.key === "done");
		const statusDone = snapshot.workspace.statuses.find((s) => s.id === "done");
		expect(done?.color).toBe(statusDone?.color);
	});

	it("reports empty when a label grouping matches nothing", () => {
		const noTasks = computeWidgetData(
			widget({ id: "w", chartType: "bar", fieldMapping: { chartType: "bar", groupBy: "label" } }),
			[],
			context,
		);
		expect(noTasks.empty).toBe(true);
	});

	it("computes a KPI count scoped by status", () => {
		const scoped = computeWidgetData(
			widget({
				id: "w",
				chartType: "kpi",
				fieldMapping: {
					chartType: "kpi",
					metric: "count",
					scope: { field: "status", value: "done" },
				},
			}),
			tasks,
			context,
		);
		expect(scoped.kind).toBe("kpi");
		if (scoped.kind !== "kpi") return;
		expect(scoped.value).toBe(tasks.filter((t) => t.status === "done").length);
	});

	it("sums estimates for an estimate KPI", () => {
		const data = computeWidgetData(
			widget({
				id: "w",
				chartType: "kpi",
				fieldMapping: { chartType: "kpi", metric: "estimateSum", scope: null },
			}),
			tasks,
			context,
		);
		if (data.kind !== "kpi") throw new Error("expected kpi");
		const expected = tasks.reduce((n, t) => n + (t.estimate ?? 0), 0);
		expect(data.value).toBe(expected);
	});

	it("builds a cumulative series for a timeline chart", () => {
		const data = computeWidgetData(
			widget({
				id: "w",
				chartType: "timeline",
				fieldMapping: {
					chartType: "timeline",
					xField: "createdAt",
					bucket: "month",
					groupBy: null,
				},
			}),
			tasks,
			context,
		);
		expect(data.kind).toBe("series");
		if (data.kind !== "series") return;
		const values = data.data.map((row) => row.__all__ as number);
		// cumulative — monotonically non-decreasing, ending at the task total.
		for (let i = 1; i < values.length; i++) {
			expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
		}
		expect(values[values.length - 1]).toBe(
			tasks.filter((t) => t.createdAt).length,
		);
	});

	it("splits a line chart into one series per grouping value", () => {
		const data = computeWidgetData(
			widget({
				id: "w",
				chartType: "line",
				fieldMapping: {
					chartType: "line",
					xField: "createdAt",
					bucket: "week",
					groupBy: "status",
				},
			}),
			tasks,
			context,
		);
		if (data.kind !== "series") throw new Error("expected series");
		expect(data.series.length).toBeGreaterThan(1);
	});
});

describe("layout helpers", () => {
	it("places a new widget in the first open column", () => {
		const existing: DashboardWidget[] = [
			widget({ id: "a", chartType: "bar", fieldMapping: { chartType: "bar", groupBy: "status" }, layout: { x: 0, y: 0, w: 6, h: 4 } }),
		];
		expect(firstOpenSlot(existing, 6, 4)).toEqual({ x: 6, y: 0 });
	});

	it("wraps to the next row when the first is full", () => {
		const existing: DashboardWidget[] = [
			widget({ id: "a", chartType: "bar", fieldMapping: { chartType: "bar", groupBy: "status" }, layout: { x: 0, y: 0, w: 12, h: 4 } }),
		];
		expect(firstOpenSlot(existing, 6, 4)).toEqual({ x: 0, y: 4 });
	});

	it("newWidget gets a valid mapping and an auto title", () => {
		const dash = newDashboard("d", "D");
		const w = newWidget("bar", dash.widgets, context);
		expect(isFieldMappingValid(w.fieldMapping)).toBe(true);
		expect(w.titleIsCustom).toBe(false);
		expect(w.title).toBe("Tasks by Status");
		expect(w.layout.w).toBe(CHART_META.bar.defaultW);
	});
});
