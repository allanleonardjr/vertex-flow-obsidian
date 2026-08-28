/**
 * The always-visible display controls on the view bar: a flat List/Board
 * switch and the Group / Sort text controls. Nothing here is styled as a
 * button — each is quiet text that reveals a faint hover background and opens a
 * short option list (via `Popover`) on click.
 */

import { useState } from "react";
import type { GroupByField, SavedView, SortField, ViewType } from "../../core/types";
import { Popover } from "../components/Popover";
import { GROUP_OPTIONS, SORT_OPTIONS, optionLabel } from "./viewOptions";

export function LayoutToggle({
	view,
	onChange,
}: {
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	const layouts: { value: ViewType; label: string; icon: string }[] = [
		{ value: "list", label: "List", icon: "☰" },
		{ value: "board", label: "Board", icon: "▦" },
	];
	return (
		<div className="vf-layout-toggle" role="group" aria-label="Layout">
			{layouts.map((layout) => (
				<button
					key={layout.value}
					type="button"
					className={`vf-layout-opt${view.viewType === layout.value ? " is-on" : ""}`}
					aria-pressed={view.viewType === layout.value}
					onClick={() =>
						view.viewType !== layout.value &&
						onChange({ ...view, viewType: layout.value })
					}
				>
					<span className="vf-bar-icon" aria-hidden>
						{layout.icon}
					</span>
					{layout.label}
				</button>
			))}
		</div>
	);
}

function BarSelect<T extends string>({
	label,
	value,
	options,
	onSelect,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onSelect: (value: T) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<span className="vf-control-anchor">
			<button
				type="button"
				className={`vf-bar-item${open ? " is-on" : ""}`}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				<span className="vf-bar-label">{label}</span>
				<span className="vf-bar-value">{optionLabel(options, value)}</span>
				<span className="vf-bar-caret" aria-hidden>
					⌄
				</span>
			</button>
			{open && (
				<Popover align="left" onClose={() => setOpen(false)}>
					<div className="vf-option-list">
						{options.map((option) => (
							<button
								key={option.value}
								type="button"
								className={`vf-menu-item${option.value === value ? " is-active" : ""}`}
								onClick={() => {
									onSelect(option.value);
									setOpen(false);
								}}
							>
								{option.label}
							</button>
						))}
					</div>
				</Popover>
			)}
		</span>
	);
}

export function GroupChip({
	view,
	onChange,
}: {
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	return (
		<BarSelect
			label="Group"
			value={view.groupBy}
			options={GROUP_OPTIONS}
			onSelect={(groupBy: GroupByField) => onChange({ ...view, groupBy })}
		/>
	);
}

export function SortChip({
	view,
	onChange,
}: {
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	const flip = () =>
		onChange({
			...view,
			sortDirection: view.sortDirection === "asc" ? "desc" : "asc",
		});
	return (
		<span className="vf-bar-group">
			<BarSelect
				label="Sort"
				value={view.sortBy}
				options={SORT_OPTIONS}
				onSelect={(sortBy: SortField) => onChange({ ...view, sortBy })}
			/>
			<button
				type="button"
				className="vf-bar-item vf-bar-dir"
				title={view.sortDirection === "asc" ? "Ascending" : "Descending"}
				aria-label={`Sort direction: ${view.sortDirection === "asc" ? "ascending" : "descending"}`}
				onClick={flip}
			>
				{view.sortDirection === "asc" ? "↑" : "↓"}
			</button>
		</span>
	);
}
