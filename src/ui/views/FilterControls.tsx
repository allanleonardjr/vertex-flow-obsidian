/**
 * The filter half of the view bar: one tag per active filter clause and a
 * "+ Filter" affordance. The clause *set* is always visible as flat text tags;
 * clicking a tag opens just its value picker. "Show archived" / "Show
 * sub-tasks" are visibility switches, not clauses — they live in `ViewControls`.
 */

import { useState } from "react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { SavedView, ViewFilters, WorkspaceSnapshot } from "../../core/types";
import { Popover } from "../components/Popover";
import {
	FILTER_FIELDS,
	activeFilterKeys,
	filterChoices,
	filterFieldLabel,
	summarizeClause,
	type FilterKey,
} from "./viewOptions";

/** Drop a key when its value goes empty, so `_views.md` stays tidy. */
function withFilter(
	filters: ViewFilters,
	key: FilterKey,
	value: string[] | string | undefined,
): ViewFilters {
	const next: ViewFilters = { ...filters };
	const empty =
		value === undefined ||
		(typeof value === "string" && value.trim() === "") ||
		(Array.isArray(value) && value.length === 0);
	if (empty) delete next[key];
	else (next as Record<string, unknown>)[key] = value;
	return next;
}

export function FilterControls({
	snapshot,
	view,
	taxonomies,
	onChange,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	taxonomies: WorkspaceTaxonomies;
	onChange: (next: SavedView) => void;
}) {
	const filters = view.filters;
	const setFilters = (next: ViewFilters) => onChange({ ...view, filters: next });

	// Clauses added this session that don't carry a value yet still need a tag.
	const [pending, setPending] = useState<FilterKey[]>([]);
	const [editing, setEditing] = useState<FilterKey | null>(null);
	const [adding, setAdding] = useState(false);

	const activeKeys = activeFilterKeys(filters);
	const shownKeys = [
		...activeKeys,
		...pending.filter((key) => !activeKeys.includes(key)),
	];
	const availableFields = FILTER_FIELDS.filter((f) => !shownKeys.includes(f.key));

	const removeClause = (key: FilterKey) => {
		setPending((keys) => keys.filter((k) => k !== key));
		if (editing === key) setEditing(null);
		setFilters(withFilter(filters, key, undefined));
	};

	return (
		<span className="vf-filter-controls">
			{shownKeys.map((key) => (
				<span key={key} className="vf-control-anchor">
					<span className="vf-filter-tag">
						<button
							type="button"
							className="vf-filter-tag-face"
							onClick={(event) => {
								event.stopPropagation();
								setEditing((current) => (current === key ? null : key));
							}}
						>
							{filterFieldLabel(key)}:{" "}
							<strong>
								{summarizeClause(key, filters, snapshot, taxonomies)}
							</strong>
						</button>
						<button
							type="button"
							className="vf-filter-tag-x"
							aria-label={`Remove ${filterFieldLabel(key)} filter`}
							onClick={() => removeClause(key)}
						>
							✕
						</button>
					</span>

					{editing === key && (
						<Popover
							align="left"
							onClose={() => {
								setEditing(null);
								if (!activeFilterKeys(filters).includes(key)) {
									setPending((keys) => keys.filter((k) => k !== key));
								}
							}}
						>
							<ClauseEditor
								fieldKey={key}
								snapshot={snapshot}
								taxonomies={taxonomies}
								filters={filters}
								onChange={setFilters}
							/>
						</Popover>
					)}
				</span>
			))}

			<span className="vf-control-anchor">
				<button
					type="button"
					className={`vf-add-filter${adding ? " is-on" : ""}`}
					onClick={(event) => {
						event.stopPropagation();
						setAdding((current) => !current);
					}}
				>
					+ Filter
				</button>
				{adding && availableFields.length > 0 && (
					<Popover align="left" onClose={() => setAdding(false)}>
						<div className="vf-option-list">
							{availableFields.map((field) => (
								<button
									key={field.key}
									type="button"
									className="vf-menu-item"
									onClick={() => {
										setAdding(false);
										setPending((keys) => [...keys, field.key]);
										setEditing(field.key);
									}}
								>
									{field.label}
								</button>
							))}
						</div>
					</Popover>
				)}
			</span>
		</span>
	);
}

function ClauseEditor({
	fieldKey,
	snapshot,
	taxonomies,
	filters,
	onChange,
}: {
	fieldKey: FilterKey;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	filters: ViewFilters;
	onChange: (next: ViewFilters) => void;
}) {
	if (fieldKey === "text") {
		return (
			<input
				type="text"
				className="vf-input"
				autoFocus
				value={filters.text ?? ""}
				placeholder="Search titles…"
				onChange={(event) =>
					onChange(withFilter(filters, "text", event.target.value))
				}
			/>
		);
	}

	const current = filters[fieldKey] ?? [];
	const toggle = (value: string) =>
		onChange(
			withFilter(
				filters,
				fieldKey,
				current.includes(value)
					? current.filter((v) => v !== value)
					: [...current, value],
			),
		);

	return (
		<div className="vf-chip-set">
			{filterChoices(fieldKey, snapshot, taxonomies).map((choice) => {
				const chosen = current.includes(choice.value);
				return (
					<button
						key={choice.value}
						type="button"
						className={`vf-chip vf-chip-button${chosen ? " is-on" : ""}`}
						style={
							choice.color
								? {
										borderColor: choice.color,
										color: chosen ? undefined : choice.color,
									}
								: undefined
						}
						onClick={() => toggle(choice.value)}
					>
						{choice.label}
					</button>
				);
			})}
		</div>
	);
}
