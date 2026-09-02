/**
 * The chart-type → allowed-fields compatibility matrix (§Dashboards Phase 1).
 *
 * This is the single source of truth the config popover derives its option
 * lists from — invalid combinations are unrepresentable *by construction*, not
 * merely rejected at the UI layer. The serializer (`serialization/dashboards`)
 * runs the same `isFieldMappingValid` check and falls back gracefully when a
 * hand-edited dashboard note names something impossible.
 */

import {
	DASHBOARD_GROUPING_FIELDS,
	DASHBOARD_METRICS,
	DASHBOARD_TEMPORAL_FIELDS,
	DASHBOARD_TIME_BUCKETS,
	type ChartType,
	type DashboardFieldMapping,
	type DashboardGroupingField,
	type DashboardMetric,
	type DashboardTemporalField,
	type DashboardTimeBucket,
} from "../types";

/** Bar / Pie group by a discrete field; Line / Timeline plot a temporal one. */
export function isDiscreteChart(chartType: ChartType): boolean {
	return chartType === "bar" || chartType === "pie";
}

export function isTemporalChart(chartType: ChartType): boolean {
	return chartType === "line" || chartType === "timeline";
}

/** Grouping fields a discrete chart (or a line/timeline secondary split) allows. */
export function groupingFieldsFor(): readonly DashboardGroupingField[] {
	return DASHBOARD_GROUPING_FIELDS;
}

export function temporalFieldsFor(): readonly DashboardTemporalField[] {
	return DASHBOARD_TEMPORAL_FIELDS;
}

export function timeBucketsFor(): readonly DashboardTimeBucket[] {
	return DASHBOARD_TIME_BUCKETS;
}

export function metricsFor(): readonly DashboardMetric[] {
	return DASHBOARD_METRICS;
}

function isGroupingField(value: unknown): value is DashboardGroupingField {
	return DASHBOARD_GROUPING_FIELDS.includes(value as DashboardGroupingField);
}

function isTemporalField(value: unknown): value is DashboardTemporalField {
	return DASHBOARD_TEMPORAL_FIELDS.includes(value as DashboardTemporalField);
}

function isTimeBucket(value: unknown): value is DashboardTimeBucket {
	return DASHBOARD_TIME_BUCKETS.includes(value as DashboardTimeBucket);
}

function isMetric(value: unknown): value is DashboardMetric {
	return DASHBOARD_METRICS.includes(value as DashboardMetric);
}

/**
 * True when `mapping` is a legal combination for its own `chartType`. Used both
 * by the parser (drop/repair invalid) and by tests.
 */
export function isFieldMappingValid(mapping: DashboardFieldMapping): boolean {
	switch (mapping.chartType) {
		case "bar":
		case "pie":
			return isGroupingField(mapping.groupBy);
		case "line":
		case "timeline":
			return (
				isTemporalField(mapping.xField) &&
				isTimeBucket(mapping.bucket) &&
				(mapping.groupBy === null || isGroupingField(mapping.groupBy))
			);
		case "kpi":
			return (
				isMetric(mapping.metric) &&
				(mapping.scope === null ||
					(isGroupingField(mapping.scope.field) &&
						typeof mapping.scope.value === "string" &&
						mapping.scope.value.length > 0))
			);
	}
}

/**
 * A safe default mapping for a freshly chosen chart type — the first allowed
 * field of each kind. Every widget always has a *valid* mapping.
 */
export function defaultFieldMapping(chartType: ChartType): DashboardFieldMapping {
	switch (chartType) {
		case "bar":
			return { chartType: "bar", groupBy: "status" };
		case "pie":
			return { chartType: "pie", groupBy: "status" };
		case "line":
			return {
				chartType: "line",
				xField: "createdAt",
				bucket: "week",
				groupBy: null,
			};
		case "timeline":
			return {
				chartType: "timeline",
				xField: "createdAt",
				bucket: "week",
				groupBy: null,
			};
		case "kpi":
			return { chartType: "kpi", metric: "count", scope: null };
	}
}

/**
 * Re-shape an existing mapping onto a new chart type, keeping whatever still
 * applies (a grouping field survives bar↔pie; a temporal field survives
 * line↔timeline) and filling the rest from `defaultFieldMapping`.
 */
export function retargetFieldMapping(
	from: DashboardFieldMapping,
	chartType: ChartType,
): DashboardFieldMapping {
	const base = defaultFieldMapping(chartType);

	if ((chartType === "bar" || chartType === "pie") && "groupBy" in from) {
		const groupBy = from.groupBy;
		if (groupBy && isGroupingField(groupBy)) {
			return chartType === "bar"
				? { chartType, groupBy }
				: { chartType, groupBy };
		}
	}

	if (
		(chartType === "line" || chartType === "timeline") &&
		"xField" in from &&
		isTemporalField(from.xField)
	) {
		const groupBy =
			"groupBy" in from && from.groupBy && isGroupingField(from.groupBy)
				? from.groupBy
				: null;
		const bucket = isTimeBucket(from.bucket) ? from.bucket : "week";
		return chartType === "line"
			? { chartType, xField: from.xField, bucket, groupBy }
			: { chartType, xField: from.xField, bucket, groupBy };
	}

	return base;
}
