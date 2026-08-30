/**
 * The always-visible display controls on the view bar: a flat List/Board
 * switch and the Group / Sort text controls. Nothing here is styled as a
 * button — each is quiet text that reveals a faint hover background and opens a
 * short option list (via `Popover`) on click.
 */

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type {
	EmptyColumnBehavior,
	GroupByField,
	SavedView,
	SortField,
	SubtaskDisplay,
	ViewType,
} from "../../core/types";
import { layoutIcon } from "../../core/views";
import { Icon } from "../components/Icon";
import { Popover } from "../components/Popover";
import {
	EMPTY_COLUMN_OPTIONS,
	FIELD_OPTIONS,
	GROUP_OPTIONS,
	SORT_OPTIONS,
	SUBTASK_OPTIONS,
	optionLabel,
	type TaskField,
} from "./viewOptions";

export function LayoutToggle({
	view,
	onChange,
}: {
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	const layouts: { value: ViewType; label: string }[] = [
		{ value: "list", label: "List" },
		{ value: "board", label: "Board" },
		{ value: "timeline", label: "Timeline" },
		{ value: "calendar", label: "Calendar" },
	];
	return (
		<div className="vf-layout-toggle" role="group" aria-label="Layout">
			{layouts.map((layout) => (
				<button
					key={layout.value}
					type="button"
					className={`vf-layout-opt${view.viewType === layout.value ? " is-on" : ""}`}
					aria-pressed={view.viewType === layout.value}
					aria-label={layout.label}
					title={layout.label}
					onClick={() =>
						view.viewType !== layout.value &&
						onChange({ ...view, viewType: layout.value })
					}
				>
					<span className="vf-bar-icon" aria-hidden>
						<Icon id={layoutIcon(layout.value)} size={14} />
					</span>
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

/**
 * How the view treats sub-tasks. Definitional, so it sits with Group and
 * Sort as a display control.
 *
 * `Nested` only means something on the List view — every other layout renders a
 * tree as a flat set — so on Board/Timeline/Calendar the control drops to
 * Flat/Hidden and a stored `nested` reads as `Flat`. The value is still kept, so
 * flipping the view back to List restores the tree (same as `hiddenFields`).
 */
export function SubtasksChip({
	view,
	onChange,
}: {
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	const isList = view.viewType === "list";
	const options = isList
		? SUBTASK_OPTIONS
		: SUBTASK_OPTIONS.filter((option) => option.value !== "nested");
	const value: SubtaskDisplay =
		!isList && view.subtaskDisplay === "nested" ? "flat" : view.subtaskDisplay;

	return (
		<BarSelect
			label="Sub-tasks"
			value={value}
			options={options}
			onSelect={(subtaskDisplay: SubtaskDisplay) =>
				onChange({ ...view, subtaskDisplay })
			}
		/>
	);
}

/**
 * Board-only: empty-column behavior. Previously reachable only through
 * the text query (`empty:auto-collapse`); this surfaces it on the bar like the
 * other display controls.
 */
export function EmptyColumnsChip({
	view,
	onChange,
}: {
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	return (
		<BarSelect
			label="Empty cols"
			value={view.emptyColumnBehavior}
			options={EMPTY_COLUMN_OPTIONS}
			onSelect={(emptyColumnBehavior: EmptyColumnBehavior) =>
				onChange({ ...view, emptyColumnBehavior })
			}
		/>
	);
}

/**
 * Which task fields this view's rows/cards show. Stored as `hiddenFields`
 * but presented positively — a lit row means "visible". Status icon, ID and
 * title are mandatory and never listed. All fields are offered in both layouts;
 * one a layout can't render (e.g. Type on a list) is simply inert there, which
 * is what each option's `hint` is for.
 *
 * A vertical checklist rather than a chip cloud: the list is long enough now
 * that a wrapped cloud has no scan order, and a row leaves space for the
 * eye/eye-off icon that carries the state without relying on colour alone.
 */
export function FieldsControl({
	view,
	onChange,
}: {
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	const [open, setOpen] = useState(false);
	const hidden = view.hiddenFields;
	const visibleCount = FIELD_OPTIONS.length - hidden.length;

	const toggle = (field: TaskField) =>
		onChange({
			...view,
			hiddenFields: hidden.includes(field)
				? hidden.filter((f) => f !== field)
				: [...hidden, field],
		});

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
				<span className="vf-bar-label">Fields</span>
				<span className="vf-bar-value">
					{hidden.length === 0
						? "All"
						: `${visibleCount} of ${FIELD_OPTIONS.length}`}
				</span>
				<span className="vf-bar-caret" aria-hidden>
					⌄
				</span>
			</button>
			{open && (
				<Popover align="left" onClose={() => setOpen(false)}>
					<div className="vf-field-list">
						{FIELD_OPTIONS.map((option) => {
							const shown = !hidden.includes(option.value);
							return (
								<button
									key={option.value}
									type="button"
									className={`vf-field-row${shown ? " is-on" : ""}`}
									aria-pressed={shown}
									title={shown ? `Hide ${option.label}` : `Show ${option.label}`}
									onClick={() => toggle(option.value)}
								>
									<span className="vf-field-eye" aria-hidden>
										{shown ? <Eye size={14} /> : <EyeOff size={14} />}
									</span>
									<span className="vf-field-label">{option.label}</span>
									{option.hint && (
										<span className="vf-field-hint">{option.hint}</span>
									)}
								</button>
							);
						})}
					</div>

					<div className="vf-field-list-footer">
						<button
							type="button"
							className="vf-field-bulk"
							disabled={hidden.length === 0}
							onClick={() => onChange({ ...view, hiddenFields: [] })}
						>
							Show all
						</button>
						<button
							type="button"
							className="vf-field-bulk"
							disabled={hidden.length === FIELD_OPTIONS.length}
							onClick={() =>
								onChange({
									...view,
									hiddenFields: FIELD_OPTIONS.map((o) => o.value),
								})
							}
						>
							Hide all
						</button>
					</div>

					<p className="vf-fields-note">
						Status, ID and title are always shown.
					</p>
				</Popover>
			)}
		</span>
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
