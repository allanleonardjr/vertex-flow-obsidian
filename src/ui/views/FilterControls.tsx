/**
 * The filter half of the view bar, split into two components that share state:
 *
 * - `AddFilterTrigger` — the "+ Filter" button and its field-picker popover.
 *   Lives on the always-present display row, so the first filter can be added
 *   even when the filters row doesn't exist yet.
 * - `FilterControls` — one tag per active filter clause (plus any query-only
 *   clause as a read-only tag). Lives on the filters row, which the parent
 *   mounts only when there's at least one clause to show.
 *
 * The `pending` (a clause added this session with no value yet still needs a
 * tag) and `editing` (a freshly-added clause opens its editor popover
 * immediately) state is owned by the parent via `useFilterClauseState` and
 * handed to both, so the Row 1 trigger and the Row 2 tag list stay in step.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { SavedView, ViewFilters, WorkspaceSnapshot } from "../../core/types";
import { Popover } from "../components/Popover";
import {
	FILTER_FIELDS,
	activeFilterKeys,
	activeReadonlyFilterKeys,
	filterChoices,
	filterFieldLabel,
	summarizeClause,
	type FilterKey,
	type ReadonlyFilterKey,
} from "./viewOptions";

/** Drop a key when its value goes empty, so the view's note stays tidy. */
function withFilter(
	filters: ViewFilters,
	key: FilterKey | ReadonlyFilterKey,
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

export interface FilterClauseControl {
	/** Clauses added this session that don't carry a value yet. */
	pending: FilterKey[];
	setPending: Dispatch<SetStateAction<FilterKey[]>>;
	/** The clause whose editor popover is open, or null. */
	editing: FilterKey | null;
	setEditing: Dispatch<SetStateAction<FilterKey | null>>;
}

/** Owns the shared `pending`/`editing` state — call once in the parent. */
export function useFilterClauseState(): FilterClauseControl {
	const [pending, setPending] = useState<FilterKey[]>([]);
	const [editing, setEditing] = useState<FilterKey | null>(null);
	return { pending, setPending, editing, setEditing };
}

/** The clause keys the filters row shows: those with a value, plus valueless pending ones. */
export function shownFilterKeys(
	filters: ViewFilters,
	pending: FilterKey[],
): FilterKey[] {
	const active = activeFilterKeys(filters);
	return [...active, ...pending.filter((key) => !active.includes(key))];
}

export function AddFilterTrigger({
	view,
	clause,
}: {
	view: SavedView;
	clause: FilterClauseControl;
}) {
	const [adding, setAdding] = useState(false);
	const { pending, setPending, setEditing } = clause;

	const shownKeys = shownFilterKeys(view.filters, pending);
	const availableFields = FILTER_FIELDS.filter(
		(f) => !shownKeys.includes(f.key),
	);

	return (
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
	);
}

export function FilterControls({
	snapshot,
	view,
	taxonomies,
	onChange,
	clause,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	taxonomies: WorkspaceTaxonomies;
	onChange: (next: SavedView) => void;
	clause: FilterClauseControl;
}) {
	const filters = view.filters;
	const setFilters = (next: ViewFilters) => onChange({ ...view, filters: next });
	const { pending, setPending, editing, setEditing } = clause;

	const shownKeys = shownFilterKeys(filters, pending);
	const readonlyKeys = activeReadonlyFilterKeys(filters);

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

			{readonlyKeys.map((key) => (
				<span key={key} className="vf-control-anchor">
					<span className="vf-filter-tag is-readonly">
						<span
							className="vf-filter-tag-face"
							title="Editable from the query bar"
						>
							{filterFieldLabel(key)}:{" "}
							<strong>
								{summarizeClause(key, filters, snapshot, taxonomies)}
							</strong>
						</span>
						<button
							type="button"
							className="vf-filter-tag-x"
							aria-label={`Remove ${filterFieldLabel(key)} filter`}
							onClick={() => setFilters(withFilter(filters, key, undefined))}
						>
							✕
						</button>
					</span>
				</span>
			))}
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

	if (fieldKey === "archived") {
		// A single-select enum, not a multi-select taxonomy list — its own
		// three-option menu rather than the generic chip toggle-set below.
		const current = filters.archived;
		const options: { value: ViewFilters["archived"]; label: string }[] = [
			{ value: undefined, label: "Hidden" },
			{ value: "included", label: "Included" },
			{ value: "only", label: "Only" },
		];
		return (
			<div className="vf-option-list">
				{options.map((option) => (
					<button
						key={option.label}
						type="button"
						className={`vf-menu-item${current === option.value ? " is-active" : ""}`}
						onClick={() =>
							onChange(withFilter(filters, "archived", option.value))
						}
					>
						{option.label}
					</button>
				))}
			</div>
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
