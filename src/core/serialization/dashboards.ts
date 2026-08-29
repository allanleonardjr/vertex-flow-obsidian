/**
 * `_dashboards` — dashboard definitions (§Dashboards Phase 1).
 *
 * A frontmatter-only config note, sibling to `_workspace` and `_views`. Parsing
 * follows the same forgiving contract as `serialization/views`: an unknown
 * chart type, a malformed field mapping, or a duplicate id logs an issue via
 * `IssueLog` and is dropped or repaired — it never throws and never corrupts
 * the rest of the file.
 */

import {
	CHART_TYPES,
	type ChartType,
	type DashboardConfig,
	type DashboardFieldMapping,
	type DashboardGroupingField,
	type DashboardMetric,
	type DashboardScope,
	type DashboardTemporalField,
	type DashboardTimeBucket,
	type DashboardWidget,
	type DashboardWidgetLayout,
	DASHBOARD_GROUPING_FIELDS,
	DASHBOARD_METRICS,
	DASHBOARD_TEMPORAL_FIELDS,
	DASHBOARD_TIME_BUCKETS,
} from "../types";
import { defaultFieldMapping, isFieldMappingValid } from "../dashboards/compat";
import { DEFAULT_WIDGET_SIZE } from "../dashboards/layout";
import {
	IssueLog,
	asBoolean,
	asNumber,
	asRecord,
	asString,
	compact,
	type ParseResult,
} from "./coerce";
import { parseFilters } from "./views";
import type { ViewFilters } from "../types";

function pickEnum<T extends string>(
	raw: unknown,
	allowed: readonly T[],
	fallback: T,
	log: IssueLog,
	field: string,
): T {
	const value = asString(raw) as T | null;
	if (!value) return fallback;
	if (allowed.includes(value)) return value;
	log.add(`Unknown ${field} "${value}"; using "${fallback}".`);
	return fallback;
}

function isGrouping(raw: unknown): raw is DashboardGroupingField {
	return DASHBOARD_GROUPING_FIELDS.includes(raw as DashboardGroupingField);
}

function coerceLayout(raw: unknown): DashboardWidgetLayout {
	const record = asRecord(raw);
	const num = (v: unknown, fallback: number) => {
		const n = asNumber(v);
		return n != null && Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
	};
	return {
		x: num(record.x, 0),
		y: num(record.y, 0),
		w: Math.max(1, num(record.w, DEFAULT_WIDGET_SIZE.w)),
		h: Math.max(1, num(record.h, DEFAULT_WIDGET_SIZE.h)),
	};
}

function parseScope(raw: unknown): DashboardScope | null {
	const record = asRecord(raw);
	const field = asString(record.field);
	const value = asString(record.value);
	if (!field || !value || !isGrouping(field)) return null;
	return { field, value };
}

function parseFieldMapping(
	chartType: ChartType,
	raw: unknown,
	log: IssueLog,
): DashboardFieldMapping {
	const record = asRecord(raw);
	let mapping: DashboardFieldMapping;

	switch (chartType) {
		case "bar":
		case "pie":
			mapping = {
				chartType,
				groupBy: isGrouping(asString(record.groupBy))
					? (asString(record.groupBy) as DashboardGroupingField)
					: "status",
			};
			break;
		case "line":
		case "timeline": {
			const groupByRaw = asString(record.groupBy);
			mapping = {
				chartType,
				xField: pickEnum(
					record.xField,
					DASHBOARD_TEMPORAL_FIELDS,
					"createdAt" as DashboardTemporalField,
					log,
					"xField",
				),
				bucket: pickEnum(
					record.bucket,
					DASHBOARD_TIME_BUCKETS,
					"week" as DashboardTimeBucket,
					log,
					"time bucket",
				),
				groupBy: isGrouping(groupByRaw)
					? (groupByRaw as DashboardGroupingField)
					: null,
			};
			break;
		}
		case "kpi":
			mapping = {
				chartType,
				metric: pickEnum(
					record.metric,
					DASHBOARD_METRICS,
					"count" as DashboardMetric,
					log,
					"metric",
				),
				scope: parseScope(record.scope),
			};
			break;
	}

	if (!isFieldMappingValid(mapping)) {
		log.add(`Malformed field mapping for a ${chartType} widget; using defaults.`);
		return defaultFieldMapping(chartType);
	}
	return mapping;
}

function parseWidget(
	raw: unknown,
	index: number,
	log: IssueLog,
): DashboardWidget | null {
	const record = asRecord(raw);
	const chartRaw = asString(record.chartType);
	if (!chartRaw || !CHART_TYPES.includes(chartRaw as ChartType)) {
		log.add(`Unknown chart type "${chartRaw ?? ""}"; dropping the widget.`);
		return null;
	}
	const chartType = chartRaw as ChartType;
	const id = asString(record.id) ?? `w-${index + 1}`;
	const title = asString(record.title) ?? "";
	const titleIsCustom = asBoolean(record.titleIsCustom, false) && title.length > 0;

	return {
		id,
		chartType,
		title,
		titleIsCustom,
		fieldMapping: parseFieldMapping(chartType, record.fieldMapping, log),
		layout: coerceLayout(record.layout),
	};
}

export function parseDashboard(
	raw: unknown,
	index: number,
): ParseResult<DashboardConfig> {
	const record = asRecord(raw);
	const log = new IssueLog();
	const id = asString(record.id) ?? `dashboard-${index + 1}`;
	const name = asString(record.name) ?? id;
	const icon = asString(record.icon) ?? undefined;

	const widgetList = Array.isArray(record.widgets) ? record.widgets : [];
	const widgets: DashboardWidget[] = [];
	widgetList.forEach((entry, widgetIndex) => {
		const widget = parseWidget(entry, widgetIndex, log);
		if (!widget) return;
		if (widgets.some((w) => w.id === widget.id)) {
			log.add(`Duplicate widget id "${widget.id}"; keeping the first.`);
			return;
		}
		widgets.push(widget);
	});

	return {
		value: {
			id,
			name,
			icon,
			widgets,
			filters: parseFilters(record.filters),
		},
		issues: log.issues.map((issue) => `Dashboard "${id}": ${issue}`),
	};
}

export function parseDashboards(raw: unknown): ParseResult<DashboardConfig[]> {
	const record = asRecord(raw);
	const list = Array.isArray(record.dashboards) ? record.dashboards : [];
	const dashboards: DashboardConfig[] = [];
	const issues: string[] = [];

	list.forEach((entry, index) => {
		const parsed = parseDashboard(entry, index);
		if (dashboards.some((d) => d.id === parsed.value.id)) {
			issues.push(
				`Duplicate dashboard id "${parsed.value.id}"; keeping the first.`,
			);
			return;
		}
		dashboards.push(parsed.value);
		issues.push(...parsed.issues);
	});

	return { value: dashboards, issues };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serializeFieldMapping(
	mapping: DashboardFieldMapping,
): Record<string, unknown> {
	switch (mapping.chartType) {
		case "bar":
		case "pie":
			return { groupBy: mapping.groupBy };
		case "line":
		case "timeline":
			return compact({
				xField: mapping.xField,
				bucket: mapping.bucket,
				groupBy: mapping.groupBy ?? undefined,
			});
		case "kpi":
			return compact({
				metric: mapping.metric,
				scope: mapping.scope
					? { field: mapping.scope.field, value: mapping.scope.value }
					: undefined,
			});
	}
}

export function serializeWidget(widget: DashboardWidget): Record<string, unknown> {
	return compact({
		id: widget.id,
		chartType: widget.chartType,
		title: widget.title || undefined,
		titleIsCustom: widget.titleIsCustom ? true : undefined,
		fieldMapping: serializeFieldMapping(widget.fieldMapping),
		layout: {
			x: widget.layout.x,
			y: widget.layout.y,
			w: widget.layout.w,
			h: widget.layout.h,
		},
	});
}

export function serializeDashboard(
	dashboard: DashboardConfig,
): Record<string, unknown> {
	return compact({
		id: dashboard.id,
		name: dashboard.name,
		icon: dashboard.icon,
		filters: compact(dashboard.filters as Record<string, unknown>) as ViewFilters,
		widgets: dashboard.widgets.map(serializeWidget),
	});
}

export function serializeDashboards(
	dashboards: DashboardConfig[],
): Record<string, unknown> {
	return { dashboards: dashboards.map(serializeDashboard) };
}
