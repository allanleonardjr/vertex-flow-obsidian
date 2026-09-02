/**
 * The chart body of a dashboard widget (§Dashboards Phase 1).
 *
 * Pure presentation: it receives already-filtered, already-aggregated data
 * (`computeWidgetData`) and renders it with Recharts. Non-essential chrome
 * (legend, axis labels, gridlines) is dropped below a size threshold rather
 * than scaled down — see `useChartSize`.
 *
 * `onSegmentClick` is threaded through but does nothing in Phase 1 — it's the
 * extension point for the Phase 2 drill-down pane.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Area,
  AreaChart,
  Pie,
  PieChart,
  Rectangle,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type PieSectorShapeProps,
} from "recharts";
import type { DashboardWidget } from "../../../core/types";
import type { WidgetData } from "../../../core/dashboards";
import {
  AXIS_COLOR,
  AngledTick,
  ChartEmpty,
  GRID_COLOR,
  TICK_STYLE,
  useChartSize,
} from "./common";

export interface SegmentClick {
  /** The grouping value clicked (taxonomy id, person id, project path, NONE). */
  key: string;
  label: string;
}

export function WidgetChart({
  widget,
  data,
  onSegmentClick,
}: {
  widget: DashboardWidget;
  data: WidgetData;
  onSegmentClick?: (segment: SegmentClick) => void;
}) {
  const [ref, size] = useChartSize();

  return (
    <div className="vf-dash-chart" ref={ref}>
      {data.empty ? (
        <ChartEmpty
          message={
            data.kind === "kpi"
              ? "No matching tasks"
              : "No data for this field yet"
          }
        />
      ) : data.kind === "kpi" ? (
        <KpiBody data={data} />
      ) : data.kind === "categorical" && widget.chartType === "pie" ? (
        <PieBody data={data} size={size} onSegmentClick={onSegmentClick} />
      ) : data.kind === "categorical" ? (
        <BarBody data={data} size={size} onSegmentClick={onSegmentClick} />
      ) : widget.chartType === "timeline" ? (
        <AreaBody data={data} size={size} />
      ) : (
        <LineBody data={data} size={size} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiBody({ data }: { data: Extract<WidgetData, { kind: "kpi" }> }) {
  const value =
    data.decimals > 0
      ? data.value.toFixed(data.decimals)
      : Math.round(data.value).toLocaleString();
  return (
    <div className="vf-dash-kpi">
      <span className="vf-dash-kpi-value">{value}</span>
    </div>
  );
}

function BarBody({
  data,
  size,
  onSegmentClick,
}: {
  data: Extract<WidgetData, { kind: "categorical" }>;
  size: ReturnType<typeof useChartSize>[1];
  onSegmentClick?: (segment: SegmentClick) => void;
}) {
  const perCategory = size.width / (data.data.length || 1);
  const angled = !size.cramped && perCategory < 70;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data.data}
        margin={{ top: 8, right: 8, bottom: 4, left: size.roomy ? 4 : -16 }}
      >
        {size.roomy && <CartesianGrid stroke={GRID_COLOR} vertical={false} />}
        <XAxis
          dataKey="label"
          stroke={AXIS_COLOR}
          tick={size.cramped ? false : angled ? AngledTick : TICK_STYLE}
          tickLine={false}
          interval={0}
          hide={size.cramped}
          height={angled ? 50 : undefined}
        />
        <YAxis
          stroke={AXIS_COLOR}
          tick={TICK_STYLE}
          tickLine={false}
          allowDecimals={false}
          width={size.roomy ? 32 : 24}
          hide={size.cramped}
        />
        <Tooltip
          cursor={{ fill: "var(--background-modifier-hover)" }}
          contentStyle={tooltipStyle}
          itemStyle={tooltipTextStyle}
          labelStyle={tooltipTextStyle}
        />
        <Bar
          dataKey="value"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
          shape={(props: BarShapeProps) => {
            const d = data.data[props.index];
            return (
              <Rectangle
                {...props}
                fill={d?.color}
                cursor="pointer"
                onClick={() => d && onSegmentClick?.({ key: d.key, label: d.label })}
              />
            );
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PieBody({
  data,
  size,
  onSegmentClick,
}: {
  data: Extract<WidgetData, { kind: "categorical" }>;
  size: ReturnType<typeof useChartSize>[1];
  onSegmentClick?: (segment: SegmentClick) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={tooltipTextStyle}
          labelStyle={tooltipTextStyle}
        />
        {size.roomy && (
          <Legend position="bottom" height={24} wrapperStyle={legendStyle} />
        )}
        <Pie
          data={data.data}
          dataKey="value"
          nameKey="label"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={1}
          isAnimationActive={false}
          shape={(props: PieSectorShapeProps) => {
            const d = data.data[props.index];
            return (
              <Sector
                {...props}
                fill={d?.color}
                cursor="pointer"
                onClick={() => d && onSegmentClick?.({ key: d.key, label: d.label })}
              />
            );
          }}
        ></Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

function LineBody({
  data,
  size,
}: {
  data: Extract<WidgetData, { kind: "series" }>;
  size: ReturnType<typeof useChartSize>[1];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data.data}
        margin={{ top: 8, right: 8, bottom: 4, left: size.roomy ? 4 : -16 }}
      >
        {size.roomy && <CartesianGrid stroke={GRID_COLOR} vertical={false} />}
        <XAxis
          dataKey="label"
          stroke={AXIS_COLOR}
          tick={size.cramped ? false : TICK_STYLE}
          tickLine={false}
          hide={size.cramped}
        />
        <YAxis
          stroke={AXIS_COLOR}
          tick={TICK_STYLE}
          tickLine={false}
          allowDecimals={false}
          width={size.roomy ? 32 : 24}
          hide={size.cramped}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={tooltipTextStyle}
          labelStyle={tooltipTextStyle}
        />
        {size.roomy && data.series.length > 1 && (
          <Legend wrapperStyle={legendStyle} />
        )}
        {data.series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function AreaBody({
  data,
  size,
}: {
  data: Extract<WidgetData, { kind: "series" }>;
  size: ReturnType<typeof useChartSize>[1];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data.data}
        margin={{ top: 8, right: 8, bottom: 4, left: size.roomy ? 4 : -16 }}
      >
        {size.roomy && <CartesianGrid stroke={GRID_COLOR} vertical={false} />}
        <XAxis
          dataKey="label"
          stroke={AXIS_COLOR}
          tick={size.cramped ? false : TICK_STYLE}
          tickLine={false}
          hide={size.cramped}
        />
        <YAxis
          stroke={AXIS_COLOR}
          tick={TICK_STYLE}
          tickLine={false}
          allowDecimals={false}
          width={size.roomy ? 32 : 24}
          hide={size.cramped}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={tooltipTextStyle}
          labelStyle={tooltipTextStyle}
        />
        {size.roomy && data.series.length > 1 && (
          <Legend wrapperStyle={legendStyle} />
        )}
        {data.series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId="1"
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.25}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: "var(--background-secondary)",
  border: "1px solid var(--background-modifier-border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--text-normal)",
};

const tooltipTextStyle: React.CSSProperties = { color: "var(--text-normal)" };

const legendStyle: React.CSSProperties = { fontSize: 11 };
