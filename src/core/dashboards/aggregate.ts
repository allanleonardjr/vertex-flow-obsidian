/**
 * Turning a filtered task list into chart-ready data (§Dashboards Phase 1).
 *
 * Pure: the dashboard container applies the dashboard-wide `ViewFilters` once
 * (through the shared `applyFilters` engine) and hands the resulting task list
 * here. Chart components receive the output as props and stay presentational.
 */

import { NONE } from "../types";
import type {
	DashboardGroupingField,
	DashboardMetric,
	DashboardScope,
	DashboardTemporalField,
	DashboardTimeBucket,
	DashboardWidget,
	Task,
} from "../types";
import type { ViewContext } from "../views/context";
import { displayColor } from "../taxonomy/engine";
import { TAXONOMY_PALETTE } from "../taxonomy/defaults";
import { linksMatch } from "../links";
import { valueLabel } from "./title";

const NONE_COLOR = "#94a3b8";

export interface CategoricalDatum {
	key: string;
	label: string;
	value: number;
	color: string;
}

export interface SeriesMeta {
	key: string;
	label: string;
	color: string;
}

export type WidgetData =
	| { kind: "kpi"; value: number; decimals: number; empty: boolean }
	| { kind: "categorical"; data: CategoricalDatum[]; empty: boolean }
	| {
			kind: "series";
			data: Array<Record<string, number | string>>;
			series: SeriesMeta[];
			empty: boolean;
	  };

// ---------------------------------------------------------------------------
// Discrete grouping
// ---------------------------------------------------------------------------

/** The discrete key(s) a task falls under for `field`. Only `label` returns >1. */
export function groupKeys(task: Task, field: DashboardGroupingField): string[] {
	switch (field) {
		case "status":
			return [task.status ?? NONE];
		case "priority":
			return [task.priority ?? NONE];
		case "taskType":
			return [task.taskType ?? NONE];
		case "assignee":
			return [task.assignee ?? NONE];
		case "project":
			return [task.project ?? NONE];
		case "label":
			return task.labels.length > 0 ? task.labels.slice() : [NONE];
	}
}

function colorFor(
	field: DashboardGroupingField,
	key: string,
	index: number,
	context: ViewContext,
): string {
	if (key === NONE) return NONE_COLOR;
	if (
		field === "status" ||
		field === "priority" ||
		field === "taskType" ||
		field === "label"
	) {
		return (
			displayColor(context.taxonomies[field], key) ??
			TAXONOMY_PALETTE[index % TAXONOMY_PALETTE.length]
		);
	}
	// assignee / project have no taxonomy colour — cycle the taxonomy palette.
	return TAXONOMY_PALETTE[index % TAXONOMY_PALETTE.length];
}

/** Taxonomy display order for ordered taxonomies, else "biggest bar first". */
function orderedKeys(
	field: DashboardGroupingField,
	counts: Map<string, number>,
	context: ViewContext,
): string[] {
	const present = [...counts.keys()];
	if (field === "status" || field === "priority") {
		const order = context.taxonomies[field].values
			.slice()
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
			.map((v) => v.id);
		const rank = (k: string) => {
			const i = order.indexOf(k);
			return i === -1 ? order.length + (k === NONE ? 1 : 0) : i;
		};
		return present.sort((a, b) => rank(a) - rank(b));
	}
	return present.sort((a, b) => {
		if (a === NONE) return 1;
		if (b === NONE) return -1;
		return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
	});
}

// ---------------------------------------------------------------------------
// Scope predicate (KPI)
// ---------------------------------------------------------------------------

export function matchesScope(task: Task, scope: DashboardScope): boolean {
	const keys = groupKeys(task, scope.field);
	if (scope.field === "project") {
		if (scope.value === NONE) return task.project == null;
		return keys.some(
			(k) => k !== NONE && (k === scope.value || linksMatch(k, scope.value)),
		);
	}
	return keys.includes(scope.value);
}

// ---------------------------------------------------------------------------
// Temporal bucketing
// ---------------------------------------------------------------------------

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function ymd(date: Date): string {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Normalise a task's temporal field to a `Date` at UTC midnight, or null. */
function temporalValue(task: Task, field: DashboardTemporalField): Date | null {
	const raw =
		field === "dueDate"
			? task.dueDate
			: field === "startDate"
				? task.startDate
				: task.createdAt;
	if (!raw) return null;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function bucketStart(date: Date, bucket: DashboardTimeBucket): Date {
	if (bucket === "month") {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
	}
	if (bucket === "week") {
		// ISO week — snap back to Monday.
		const day = (date.getUTCDay() + 6) % 7;
		return new Date(date.getTime() - day * 86400000);
	}
	return date;
}

function nextBucket(date: Date, bucket: DashboardTimeBucket): Date {
	if (bucket === "month") {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
	}
	return new Date(date.getTime() + (bucket === "week" ? 7 : 1) * 86400000);
}

function bucketLabel(iso: string, bucket: DashboardTimeBucket): string {
	const [y, m, d] = iso.split("-");
	if (bucket === "month") return `${y}-${m}`;
	return `${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function estimateAggregate(tasks: Task[], metric: DashboardMetric): number {
	if (metric === "count") return tasks.length;
	const values = tasks
		.map((t) => t.estimate)
		.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
	const sum = values.reduce((acc, n) => acc + n, 0);
	if (metric === "estimateSum") return sum;
	return values.length === 0 ? 0 : sum / values.length;
}

export function computeWidgetData(
	widget: DashboardWidget,
	tasks: Task[],
	context: ViewContext,
): WidgetData {
	const mapping = widget.fieldMapping;

	if (mapping.chartType === "kpi") {
		const scoped = mapping.scope
			? tasks.filter((t) => matchesScope(t, mapping.scope as DashboardScope))
			: tasks;
		const value = estimateAggregate(scoped, mapping.metric);
		return {
			kind: "kpi",
			value,
			decimals: mapping.metric === "estimateAvg" ? 1 : 0,
			empty: scoped.length === 0,
		};
	}

	if (mapping.chartType === "bar" || mapping.chartType === "pie") {
		const counts = new Map<string, number>();
		for (const task of tasks) {
			for (const key of groupKeys(task, mapping.groupBy)) {
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
		const keys = orderedKeys(mapping.groupBy, counts, context);
		const data: CategoricalDatum[] = keys.map((key, index) => ({
			key,
			label: valueLabel(mapping.groupBy, key, context),
			value: counts.get(key) ?? 0,
			color: colorFor(mapping.groupBy, key, index, context),
		}));
		return { kind: "categorical", data, empty: data.length === 0 };
	}

	// line / timeline — temporal buckets, optionally split into series.
	const cumulative = mapping.chartType === "timeline";
	const dated = tasks
		.map((task) => ({ task, date: temporalValue(task, mapping.xField) }))
		.filter((row): row is { task: Task; date: Date } => row.date != null);

	if (dated.length === 0) {
		return { kind: "series", data: [], series: [], empty: true };
	}

	const starts = dated
		.map((row) => bucketStart(row.date, mapping.bucket))
		.sort((a, b) => a.getTime() - b.getTime());
	const first = starts[0];
	const last = starts[starts.length - 1];

	// One series per discrete value, or a single "Tasks" series.
	const seriesCounts = new Map<string, number>();
	const rowKeys = (task: Task): string[] =>
		mapping.groupBy ? groupKeys(task, mapping.groupBy) : ["__all__"];
	for (const { task } of dated) {
		for (const key of rowKeys(task)) {
			seriesCounts.set(key, (seriesCounts.get(key) ?? 0) + 1);
		}
	}
	const seriesKeys = mapping.groupBy
		? orderedKeys(mapping.groupBy, seriesCounts, context)
		: ["__all__"];
	const series: SeriesMeta[] = seriesKeys.map((key, index) => ({
		key,
		label:
			key === "__all__"
				? "Tasks"
				: valueLabel(mapping.groupBy as DashboardGroupingField, key, context),
		color:
			key === "__all__"
				? TAXONOMY_PALETTE[10]
				: colorFor(mapping.groupBy as DashboardGroupingField, key, index, context),
	}));

	// Per-bucket, per-series counts.
	const perBucket = new Map<string, Map<string, number>>();
	for (const { task, date } of dated) {
		const iso = ymd(bucketStart(date, mapping.bucket));
		let bucket = perBucket.get(iso);
		if (!bucket) perBucket.set(iso, (bucket = new Map<string, number>()));
		for (const key of rowKeys(task)) {
			bucket.set(key, (bucket.get(key) ?? 0) + 1);
		}
	}

	const data: Array<Record<string, number | string>> = [];
	const running = new Map<string, number>();
	for (
		let cursor = new Date(first.getTime());
		cursor.getTime() <= last.getTime();
		cursor = nextBucket(cursor, mapping.bucket)
	) {
		const iso = ymd(cursor);
		const bucket = perBucket.get(iso);
		const row: Record<string, number | string> = {
			bucket: iso,
			label: bucketLabel(iso, mapping.bucket),
		};
		for (const meta of series) {
			const delta = bucket?.get(meta.key) ?? 0;
			if (cumulative) {
				running.set(meta.key, (running.get(meta.key) ?? 0) + delta);
				row[meta.key] = running.get(meta.key) ?? 0;
			} else {
				row[meta.key] = delta;
			}
		}
		data.push(row);
	}

	return { kind: "series", data, series, empty: false };
}
