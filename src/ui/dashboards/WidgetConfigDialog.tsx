/**
 * Create / edit a widget's chart type and field mapping (§Dashboards Phase 1).
 *
 * The field pickers are derived from the compatibility matrix
 * (`core/dashboards/compat`) — changing the chart type re-targets the mapping
 * (`retargetFieldMapping`) so an invalid combination is unrepresentable.
 *
 * Rendered as a modal rather than `Popover` (which any outside click dismisses)
 * because a multi-control form needs to survive a stray click and a native
 * <select> dropdown.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import {
	CHART_META,
	defaultFieldMapping,
	retargetFieldMapping,
} from "../../core/dashboards";
import { CHART_TYPES } from "../../core/types";
import type {
	ChartType,
	DashboardFieldMapping,
	DashboardGroupingField,
	WorkspaceSnapshot,
} from "../../core/types";
import type { ViewContext } from "../../core/views";
import { Icon } from "../components/Icon";
import {
	BUCKET_OPTIONS,
	GROUPING_OPTIONS,
	METRIC_OPTIONS,
	TEMPORAL_OPTIONS,
	scopeValueOptions,
	type Option,
} from "./fieldOptions";

export interface WidgetConfigResult {
	chartType: ChartType;
	fieldMapping: DashboardFieldMapping;
}

function Select<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: Option<T>[];
	onChange: (value: T) => void;
}) {
	return (
		<label className="vf-field">
			<span>{label}</span>
			<select value={value} onChange={(e) => onChange(e.target.value as T)}>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

export function WidgetConfigDialog({
	snapshot,
	context,
	initial,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	snapshot: WorkspaceSnapshot;
	context: ViewContext;
	initial?: WidgetConfigResult;
	confirmLabel: string;
	onConfirm: (result: WidgetConfigResult) => void;
	onClose: () => void;
}) {
	const [chartType, setChartType] = useState<ChartType>(
		initial?.chartType ?? "bar",
	);
	const [mapping, setMapping] = useState<DashboardFieldMapping>(
		initial?.fieldMapping ?? defaultFieldMapping("bar"),
	);

	const pickChartType = (next: ChartType) => {
		setChartType(next);
		setMapping((current) => retargetFieldMapping(current, next));
	};

	const GROUPING_WITH_NONE: Option<DashboardGroupingField | "__none">[] = [
		{ value: "__none", label: "None (single series)" },
		...GROUPING_OPTIONS,
	];

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog vf-widget-config"
				role="dialog"
				aria-modal="true"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>{initial ? "Edit chart" : "Add chart"}</h3>

				<div className="vf-widget-config-types" role="group" aria-label="Chart type">
					{CHART_TYPES.map((type) => (
						<button
							key={type}
							type="button"
							className={`vf-widget-type${chartType === type ? " is-on" : ""}`}
							aria-pressed={chartType === type}
							onClick={() => pickChartType(type)}
						>
							<Icon id={CHART_META[type].icon} size={16} />
							<span>{CHART_META[type].label}</span>
						</button>
					))}
				</div>

				<div className="vf-widget-config-fields">
					{(mapping.chartType === "bar" || mapping.chartType === "pie") && (
						<Select
							label="Group by"
							value={mapping.groupBy}
							options={GROUPING_OPTIONS}
							onChange={(groupBy) =>
								setMapping({ chartType: mapping.chartType, groupBy })
							}
						/>
					)}

					{(mapping.chartType === "line" || mapping.chartType === "timeline") && (
						<>
							<Select
								label="Time axis"
								value={mapping.xField}
								options={TEMPORAL_OPTIONS}
								onChange={(xField) => setMapping({ ...mapping, xField })}
							/>
							<Select
								label="Bucket by"
								value={mapping.bucket}
								options={BUCKET_OPTIONS}
								onChange={(bucket) => setMapping({ ...mapping, bucket })}
							/>
							<Select
								label="Split into series by"
								value={mapping.groupBy ?? "__none"}
								options={GROUPING_WITH_NONE}
								onChange={(value) =>
									setMapping({
										...mapping,
										groupBy:
											value === "__none"
												? null
												: value,
									})
								}
							/>
						</>
					)}

					{mapping.chartType === "kpi" && (
						<KpiFields
							snapshot={snapshot}
							context={context}
							mapping={mapping}
							onChange={setMapping}
						/>
					)}
				</div>

				<div className="vf-dialog-actions">
					<button onClick={onClose}>Cancel</button>
					<button
						className="mod-cta"
						onClick={() => {
							onConfirm({ chartType, fieldMapping: mapping });
							onClose();
						}}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function KpiFields({
	snapshot,
	context,
	mapping,
	onChange,
}: {
	snapshot: WorkspaceSnapshot;
	context: ViewContext;
	mapping: Extract<DashboardFieldMapping, { chartType: "kpi" }>;
	onChange: (mapping: DashboardFieldMapping) => void;
}) {
	const scopeField = mapping.scope?.field ?? "__none";
	const scoped = mapping.scope != null;

	return (
		<>
			<Select
				label="Measure"
				value={mapping.metric}
				options={METRIC_OPTIONS}
				onChange={(metric) => onChange({ ...mapping, metric })}
			/>
			<Select
				label="Scope to"
				value={scopeField}
				options={[
					{ value: "__none", label: "All tasks in filter" },
					...GROUPING_OPTIONS,
				]}
				onChange={(value) => {
					if (value === "__none") {
						onChange({ ...mapping, scope: null });
						return;
					}
					const field = value;
					const first = scopeValueOptions(field, snapshot, context)[0];
					onChange({
						...mapping,
						scope: { field, value: first?.value ?? "" },
					});
				}}
			/>
			{scoped && mapping.scope && (
				<Select
					label={`${GROUPING_OPTIONS.find((o) => o.value === mapping.scope!.field)?.label} is`}
					value={mapping.scope.value}
					options={scopeValueOptions(mapping.scope.field, snapshot, context)}
					onChange={(value) =>
						onChange({
							...mapping,
							scope: { field: mapping.scope!.field, value },
						})
					}
				/>
			)}
		</>
	);
}
