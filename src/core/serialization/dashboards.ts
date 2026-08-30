/**
 * `Dashboards/<id>.md` — one dashboard definition per note (§Dashboards Phase 1).
 *
 * Parsing follows the same forgiving contract as `serialization/views`: an
 * unknown chart type, a malformed field mapping, or a duplicate id logs an issue
 * via `IssueLog` and is dropped or repaired — it never throws and never
 * corrupts the rest of the file.
 *
 * `parseDashboards`/`serializeDashboards` (plural) survive only for the one-time
 * migration off the retired shared `_dashboards` array.
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
import { basename } from "../links";
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

export interface DashboardParseOptions {
	/** Vault path of the note. Its basename is the id fallback when frontmatter omits one. */
	path: string;
}

/** The definitional half of a dashboard — everything but the `type`/`path` discriminants. */
function parseDashboardValue(
	record: Record<string, unknown>,
	id: string,
	log: IssueLog,
): Omit<DashboardConfig, "type" | "path"> {
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
		id,
		name,
		icon,
		widgets,
		filters: parseFilters(record.filters),
	};
}

/**
 * Parse one `Dashboards/<id>.md` note. The id comes from frontmatter; a note
 * that omits it falls back to its filename (like `parseTask`).
 */
export function parseDashboard(
	raw: unknown,
	options: DashboardParseOptions,
): ParseResult<DashboardConfig> {
	const record = asRecord(raw);
	const log = new IssueLog();
	const id = asString(record.id) ?? basename(options.path);

	return {
		value: {
			type: "dashboard",
			path: options.path,
			...parseDashboardValue(record, id, log),
		},
		issues: log.issues.map((issue) => `Dashboard "${id}": ${issue}`),
	};
}

/**
 * Parse the retired shared `_dashboards` array. Migration-only. `path` is left
 * blank — these objects are read once to be re-written as individual files.
 */
export function parseDashboards(raw: unknown): ParseResult<DashboardConfig[]> {
	const record = asRecord(raw);
	const list = Array.isArray(record.dashboards) ? record.dashboards : [];
	const dashboards: DashboardConfig[] = [];
	const issues: string[] = [];

	list.forEach((entry, index) => {
		const entryRecord = asRecord(entry);
		const log = new IssueLog();
		const id = asString(entryRecord.id) ?? `dashboard-${index + 1}`;
		if (dashboards.some((d) => d.id === id)) {
			issues.push(`Duplicate dashboard id "${id}"; keeping the first.`);
			return;
		}
		dashboards.push({
			type: "dashboard",
			path: "",
			...parseDashboardValue(entryRecord, id, log),
		});
		issues.push(...log.issues.map((issue) => `Dashboard "${id}": ${issue}`));
	});

	return { value: dashboards, issues };
}

/**
 * Per-workspace duplicate-id detector, mirroring `detectViewIdCollisions`.
 */
export interface DashboardIdCollision {
	path: string;
	id: string;
}

export function detectDashboardIdCollisions(
	dashboards: readonly DashboardConfig[],
): DashboardIdCollision[] {
	const groups = new Map<string, DashboardConfig[]>();
	for (const dashboard of dashboards) {
		const group = groups.get(dashboard.id) ?? [];
		group.push(dashboard);
		groups.set(dashboard.id, group);
	}

	const out: DashboardIdCollision[] = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		for (const dashboard of group) {
			out.push({ path: dashboard.path, id: dashboard.id });
		}
	}
	return out;
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
		type: "dashboard",
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
