/**
 * Shared bits for the dashboard chart components.
 *
 * `EmptyState.tsx` in the repo is the onboarding template gallery, not a
 * reusable empty state, so a small local one lives here instead.
 */
import { useEffect, useRef, useState } from "react";
import type { XAxisTickContentProps } from "recharts";

export interface ChartSize {
  width: number;
  height: number;
  /** Big enough to carry a legend / axis titles / gridlines. */
  roomy: boolean;
  /** Big enough for axis tick labels at all. */
  cramped: boolean;
}

/** Track a chart cell's pixel size so each chart can shed chrome as it shrinks. */
export function useChartSize(): [
  (el: HTMLDivElement | null) => void,
  ChartSize,
] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = (el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    ro.observe(el);
    observer.current = ro;
  };

  useEffect(() => () => observer.current?.disconnect(), []);

  return [
    ref,
    {
      width: size.width,
      height: size.height,
      roomy: size.width >= 320 && size.height >= 200,
      cramped: size.height < 130 || size.width < 220,
    },
  ];
}

export function ChartEmpty({ message = "No data" }: { message?: string }) {
  return (
    <div className="vf-dash-widget-empty">
      <span>{message}</span>
    </div>
  );
}

/**
 * A rotated axis tick for bar-chart category labels, used when there isn't
 * enough horizontal room per bar to keep the labels flat without them
 * overlapping their neighbours.
 */
export function AngledTick({ x, y, payload }: XAxisTickContentProps) {
  return (
    <text
      x={x}
      y={y}
      dy={10}
      textAnchor="end"
      transform={`rotate(-35, ${x}, ${y})`}
      fill={TICK_STYLE.fill}
      fontSize={TICK_STYLE.fontSize}
    >
      {payload.value}
    </text>
  );
}
/** The colour axis/grid strokes should use — Obsidian's own theme variables. */
export const AXIS_COLOR = "var(--text-faint)";
export const GRID_COLOR = "var(--background-modifier-border)";
export const TICK_STYLE = { fill: "var(--text-muted)", fontSize: 11 };
