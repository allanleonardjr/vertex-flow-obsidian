/**
 * Constructors for new dashboards and widgets (§Dashboards Phase 1).
 */

import type {
	ChartType,
	DashboardConfig,
	DashboardFieldMapping,
	DashboardWidget,
} from "../types";
import type { ViewContext } from "../views/context";
import { defaultFieldMapping } from "./compat";
import { chartMeta, firstOpenSlot } from "./layout";
import { autoTitle } from "./title";

/** A short, url-safe-ish random id. */
export function newDashboardId(): string {
	return `dash-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newWidgetId(): string {
	return `w-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newDashboard(id: string, name: string): DashboardConfig {
	return { id, name, widgets: [], filters: {} };
}

/**
 * A widget of `chartType`, placed in the first open slot of `existing`, with an
 * auto-generated title.
 */
export function newWidget(
	chartType: ChartType,
	existing: DashboardWidget[],
	context: ViewContext,
): DashboardWidget {
	const meta = chartMeta(chartType);
	const slot = firstOpenSlot(existing, meta.defaultW, meta.defaultH);
	const fieldMapping = defaultFieldMapping(chartType);
	return {
		id: newWidgetId(),
		chartType,
		title: autoTitle(fieldMapping, context),
		titleIsCustom: false,
		fieldMapping,
		layout: { x: slot.x, y: slot.y, w: meta.defaultW, h: meta.defaultH },
	};
}

/** A widget from an explicit chart type + field mapping (the config dialog). */
export function widgetFromConfig(
	chartType: ChartType,
	fieldMapping: DashboardFieldMapping,
	existing: DashboardWidget[],
	context: ViewContext,
): DashboardWidget {
	const meta = chartMeta(chartType);
	const slot = firstOpenSlot(existing, meta.defaultW, meta.defaultH);
	return {
		id: newWidgetId(),
		chartType,
		title: autoTitle(fieldMapping, context),
		titleIsCustom: false,
		fieldMapping,
		layout: { x: slot.x, y: slot.y, w: meta.defaultW, h: meta.defaultH },
	};
}

/**
 * Apply a new chart type + field mapping to an existing widget, regenerating
 * the auto-title only when the user hasn't set a custom one.
 */
export function reconfigureWidget(
	widget: DashboardWidget,
	chartType: ChartType,
	fieldMapping: DashboardFieldMapping,
	context: ViewContext,
): DashboardWidget {
	return {
		...widget,
		chartType,
		fieldMapping,
		title: widget.titleIsCustom ? widget.title : autoTitle(fieldMapping, context),
	};
}

/** Clone a widget with a new id, nudged down-and-right so it doesn't hide under the original. */
export function duplicateWidget(
	widget: DashboardWidget,
	existing: DashboardWidget[],
): DashboardWidget {
	const slot = firstOpenSlot(
		existing,
		widget.layout.w,
		widget.layout.h,
	);
	return {
		...widget,
		id: newWidgetId(),
		title: widget.titleIsCustom ? `${widget.title} copy` : widget.title,
		layout: { ...widget.layout, x: slot.x, y: slot.y },
	};
}
