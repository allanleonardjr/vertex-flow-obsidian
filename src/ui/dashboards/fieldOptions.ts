/**
 * Option lists for the widget config popover, all derived from the
 * compatibility matrix (`core/dashboards/compat`) so an invalid chart-type /
 * field pairing is never even offered.
 */

import { NONE } from "../../core/types";
import type {
	DashboardGroupingField,
	DashboardMetric,
	DashboardTemporalField,
	DashboardTimeBucket,
	WorkspaceSnapshot,
} from "../../core/types";
import type { ViewContext } from "../../core/views";
import {
	groupingFieldLabel,
	metricLabel,
	temporalFieldLabel,
	valueLabel,
} from "../../core/dashboards";
import { listValues } from "../../core/taxonomy";

export interface Option<T extends string> {
	value: T;
	label: string;
	color?: string | null;
}

export const GROUPING_OPTIONS: Option<DashboardGroupingField>[] = (
	["status", "priority", "taskType", "label", "assignee", "project"] as const
).map((value) => ({ value, label: groupingFieldLabel(value) }));

export const TEMPORAL_OPTIONS: Option<DashboardTemporalField>[] = (
	["dueDate", "startDate", "createdAt"] as const
).map((value) => ({ value, label: temporalFieldLabel(value) }));

export const BUCKET_OPTIONS: Option<DashboardTimeBucket>[] = [
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
];

export const METRIC_OPTIONS: Option<DashboardMetric>[] = (
	["count", "estimateSum", "estimateAvg"] as const
).map((value) => ({ value, label: metricLabel(value) }));

/** Concrete values a KPI scope predicate can pin `field` to, plus "unset". */
export function scopeValueOptions(
	field: DashboardGroupingField,
	snapshot: WorkspaceSnapshot,
	context: ViewContext,
): Option<string>[] {
	const options: Option<string>[] = [];

	if (
		field === "status" ||
		field === "priority" ||
		field === "taskType" ||
		field === "label"
	) {
		for (const value of listValues(context.taxonomies[field])) {
			options.push({ value: value.id, label: value.name, color: value.color });
		}
	} else if (field === "assignee") {
		for (const person of snapshot.workspace.people) {
			options.push({ value: person.id, label: person.name });
		}
	} else {
		for (const project of [...snapshot.projects].sort((a, b) =>
			a.title.localeCompare(b.title),
		)) {
			options.push({ value: project.path, label: project.title });
		}
	}

	options.push({ value: NONE, label: valueLabel(field, NONE, context) });
	return options;
}
