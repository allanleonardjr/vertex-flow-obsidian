/**
 * Auto-generated widget titles (§Dashboards Phase 1).
 *
 * "Tasks by Status", "Estimate sum where Status is Done", etc. Once a user
 * renames a widget (`titleIsCustom`), these never overwrite it — the caller
 * checks that flag, not this module.
 */

import { NONE } from "../types";
import type {
	DashboardFieldMapping,
	DashboardGroupingField,
	DashboardMetric,
	DashboardScope,
	DashboardTemporalField,
} from "../types";
import type { ViewContext } from "../views/context";
import { displayName } from "../taxonomy/engine";
import { basename } from "../links";

const GROUPING_LABEL: Record<DashboardGroupingField, string> = {
	status: "Status",
	priority: "Priority",
	taskType: "Type",
	label: "Label",
	assignee: "Assignee",
	project: "Project",
};

const TEMPORAL_LABEL: Record<DashboardTemporalField, string> = {
	dueDate: "due date",
	startDate: "start date",
	createdAt: "created date",
};

const METRIC_LABEL: Record<DashboardMetric, string> = {
	count: "Task count",
	estimateSum: "Estimate sum",
	estimateAvg: "Average estimate",
};

export function groupingFieldLabel(field: DashboardGroupingField): string {
	return GROUPING_LABEL[field];
}

export function temporalFieldLabel(field: DashboardTemporalField): string {
	return TEMPORAL_LABEL[field];
}

export function metricLabel(metric: DashboardMetric): string {
	return METRIC_LABEL[metric];
}

/** Human name for one discrete value of a grouping field. */
export function valueLabel(
	field: DashboardGroupingField,
	value: string,
	context: ViewContext,
): string {
	if (value === NONE) {
		return field === "assignee"
			? "Unassigned"
			: field === "project"
				? "No project"
				: `No ${GROUPING_LABEL[field].toLowerCase()}`;
	}
	switch (field) {
		case "status":
		case "priority":
		case "taskType":
			return displayName(context.taxonomies[field], value, value);
		case "label":
			return displayName(context.taxonomies.label, value, value);
		case "assignee":
			return context.people.find((p) => p.id === value)?.name ?? value;
		case "project":
			return context.titles?.get(value) ?? basename(value);
	}
}

function describeScope(scope: DashboardScope, context: ViewContext): string {
	return `${GROUPING_LABEL[scope.field]} is ${valueLabel(scope.field, scope.value, context)}`;
}

export function autoTitle(
	mapping: DashboardFieldMapping,
	context: ViewContext,
): string {
	switch (mapping.chartType) {
		case "bar":
		case "pie":
			return `Tasks by ${GROUPING_LABEL[mapping.groupBy]}`;
		case "line":
		case "timeline": {
			const head =
				mapping.chartType === "timeline"
					? `Cumulative tasks by ${TEMPORAL_LABEL[mapping.xField]}`
					: `Tasks by ${TEMPORAL_LABEL[mapping.xField]}`;
			return mapping.groupBy
				? `${head}, split by ${GROUPING_LABEL[mapping.groupBy]}`
				: head;
		}
		case "kpi":
			return mapping.scope
				? `${METRIC_LABEL[mapping.metric]} where ${describeScope(mapping.scope, context)}`
				: METRIC_LABEL[mapping.metric];
	}
}
