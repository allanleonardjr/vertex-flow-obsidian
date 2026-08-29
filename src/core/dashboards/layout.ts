/**
 * Grid geometry for dashboard widgets (§Dashboards Phase 1).
 *
 * Per-chart-type minimum and default sizes live here, next to the chart-type
 * definitions, rather than scattered across the React components. The grid is
 * 12 columns at its widest; a new widget is half-width (`w: 6`).
 */

import type { ChartType, DashboardWidget, DashboardWidgetLayout } from "../types";

/** Columns at the widest (`lg`) breakpoint. */
export const GRID_COLUMNS = 12;

/** Default size for a freshly created widget — half-width on a 12-col grid. */
export const DEFAULT_WIDGET_SIZE = { w: 6, h: 4 } as const;

export interface ChartMeta {
	label: string;
	/** Curated icon id registered in `ui/components/Icon` — never add new ones. */
	icon: string;
	minW: number;
	minH: number;
	defaultW: number;
	defaultH: number;
}

export const CHART_META: Record<ChartType, ChartMeta> = {
	kpi: { label: "KPI", icon: "gauge", minW: 2, minH: 2, defaultW: 3, defaultH: 3 },
	bar: {
		label: "Bar chart",
		icon: "chart-bar",
		minW: 3,
		minH: 3,
		defaultW: 6,
		defaultH: 4,
	},
	pie: {
		label: "Pie chart",
		icon: "chart-pie",
		minW: 3,
		minH: 3,
		defaultW: 4,
		defaultH: 4,
	},
	line: {
		label: "Line chart",
		icon: "chart-line",
		minW: 4,
		minH: 3,
		defaultW: 6,
		defaultH: 4,
	},
	timeline: {
		label: "Timeline (cumulative)",
		icon: "chart-gantt",
		minW: 4,
		minH: 3,
		defaultW: 6,
		defaultH: 4,
	},
};

export function chartMeta(chartType: ChartType): ChartMeta {
	return CHART_META[chartType];
}

/** The `{x,y,w,h}` an RGL layout item should carry for a widget. */
export function widgetGridItem(widget: DashboardWidget): DashboardWidgetLayout & {
	i: string;
	minW: number;
	minH: number;
} {
	const meta = chartMeta(widget.chartType);
	return {
		i: widget.id,
		x: widget.layout.x,
		y: widget.layout.y,
		w: Math.max(widget.layout.w, meta.minW),
		h: Math.max(widget.layout.h, meta.minH),
		minW: meta.minW,
		minH: meta.minH,
	};
}

/**
 * The first open slot for a new `w`×`h` widget on a `GRID_COLUMNS`-wide grid,
 * scanning left-to-right, top-to-bottom. `compactType="vertical"` then packs it
 * upward, so this only needs to avoid overlapping an existing item.
 */
export function firstOpenSlot(
	widgets: DashboardWidget[],
	w: number,
	h: number,
): { x: number; y: number } {
	const occupied = (x: number, y: number, cw: number, ch: number) =>
		widgets.some((other) => {
			const o = other.layout;
			return (
				x < o.x + o.w &&
				x + cw > o.x &&
				y < o.y + o.h &&
				y + ch > o.y
			);
		});

	const maxY = widgets.reduce((m, other) => Math.max(m, other.layout.y + other.layout.h), 0);
	for (let y = 0; y <= maxY + 1; y++) {
		for (let x = 0; x + w <= GRID_COLUMNS; x++) {
			if (!occupied(x, y, w, h)) return { x, y };
		}
	}
	return { x: 0, y: maxY + 1 };
}
