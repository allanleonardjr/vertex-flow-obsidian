/**
 * The react-grid-layout wrapper (§Dashboards Phase 1).
 *
 * `Responsive` + `WidthProvider`, 12 columns at the widest breakpoint,
 * degrading to a single column on narrow panes. `compactType="vertical"` —
 * widgets always pack upward. Widget geometry is owned by the parent (the
 * draft); this component reports layout changes back through `onLayoutChange`.
 */

import { useMemo, useRef, type ReactNode } from "react";
import {
	Responsive,
	WidthProvider,
	type Layout,
	type LayoutItem,
	type ResponsiveLayouts,
} from "react-grid-layout/legacy";
import type { DashboardWidget } from "../../core/types";
import { GRID_COLUMNS, widgetGridItem } from "../../core/dashboards";

const Grid = WidthProvider(Responsive);

const BREAKPOINTS = { lg: 1000, md: 720, sm: 480, xs: 0 } as const;
const COLS = { lg: GRID_COLUMNS, md: 8, sm: 4, xs: 1 } as const;
const ROW_HEIGHT = 72;

export function DashboardGrid({
	widgets,
	renderWidget,
	onLayoutChange,
}: {
	widgets: DashboardWidget[];
	renderWidget: (widget: DashboardWidget) => ReactNode;
	/** Fired with the new geometry after a drag/resize settles. */
	onLayoutChange: (next: DashboardWidget[]) => void;
}) {
	const lastSerialized = useRef<string>("");
	// RGL fires `onLayoutChange` once on mount (and again whenever its own
	// vertical compaction nudges items). Swallowing the first call keeps opening
	// a saved dashboard from instantly reading as "unsaved".
	const settled = useRef(false);

	const layout = useMemo<Layout>(
		() => widgets.map(widgetGridItem),
		[widgets],
	);

	const handleChange = (current: Layout, all: ResponsiveLayouts) => {
		if (!settled.current) {
			settled.current = true;
			return;
		}
		// Only the widest layout is authoritative — narrower breakpoints are
		// derived and must never be written back as the canonical geometry.
		const source = all.lg ?? current;
		const byId = new Map(source.map((item) => [item.i, item]));
		const next = widgets.map((widget) => {
			const item = byId.get(widget.id);
			if (!item) return widget;
			return {
				...widget,
				layout: { x: item.x, y: item.y, w: item.w, h: item.h },
			};
		});
		const serialized = JSON.stringify(next.map((w) => w.layout));
		if (serialized === lastSerialized.current) return;
		lastSerialized.current = serialized;
		if (serialized !== JSON.stringify(widgets.map((w) => w.layout))) {
			onLayoutChange(next);
		}
	};

	return (
		<Grid
			className="vf-dash-grid"
			layouts={{ lg: layout }}
			breakpoints={BREAKPOINTS}
			cols={COLS}
			rowHeight={ROW_HEIGHT}
			margin={[12, 12]}
			containerPadding={[0, 0]}
			compactType="vertical"
			draggableHandle=".vf-dash-widget-head"
			draggableCancel=".vf-dash-widget-menu,.vf-dash-widget-title"
			isBounded
			onLayoutChange={handleChange}
		>
			{widgets.map((widget) => (
				<div key={widget.id} className="vf-dash-grid-item">
					{renderWidget(widget)}
				</div>
			))}
		</Grid>
	);
}

export type { LayoutItem };
