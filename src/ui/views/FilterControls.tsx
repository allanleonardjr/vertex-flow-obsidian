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
 * tag) and `openId` (which single popover on the whole bar is open — a
 * filter clause's editor, or one of the non-filter Row 1 controls) state is
 * owned by the parent via `useFilterClauseState` and handed to both, so the
 * Row 1 trigger and the Row 2 tag list stay in step with each other and with
 * every other bar control.
 */

import {
	useState,
	type CSSProperties,
	type Dispatch,
	type SetStateAction,
} from "react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import { NONE } from "../../core/types";
import type { SavedView, ViewFilters, WorkspaceSnapshot } from "../../core/types";
import { Popover } from "../components/Popover";
import { buildTree, TreeList } from "../components/Tree";
import {
	FILTER_FIELDS,
	activeFilterKeys,
	activeReadonlyFilterKeys,
	dateBoundKey,
	dateFamilyAllowsUnset,
	filterChoices,
	filterFieldLabel,
	isDateFamilyKey,
	summarizeClause,
	type Choice,
	type DateFamilyKey,
	type FilterKey,
} from "./viewOptions";

/** Drop a key when its value goes empty, so the view's note stays tidy. */
function withFilter(
	filters: ViewFilters,
	key: keyof ViewFilters,
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

/**
 * Selected-state fill for a filter chip: the value's own taxonomy color when
 * it has one, the app's accent color (matching `.vf-you-badge`) when it
 * doesn't. Unselected chips get no inline style at all — neutral, regardless
 * of color — so selection is a real color-vs-no-color contrast rather than a
 * subtle shade difference.
 */
function chipTint(
	chosen: boolean,
	color?: string | null,
): CSSProperties | undefined {
	if (!chosen) return undefined;
	if (color) {
		return { borderColor: color, color, backgroundColor: `${color}1e` };
	}
	return {
		borderColor: "var(--interactive-accent)",
		color: "var(--text-accent)",
		backgroundColor:
			"color-mix(in srgb, var(--interactive-accent) 15%, transparent)",
	};
}

/** The non-filter Row 1 controls that share the bar's single open-popover state. */
export type BarControlId =
	| "group"
	| "sort"
	| "subtasks"
	| "recurring"
	| "emptyColumns"
	| "fields"
	| "addFilter"
	| "canvasRelations"
	| "canvasArrange"
	| "stripe";

export interface FilterClauseControl {
	/** Clauses added this session that don't carry a value yet. */
	pending: FilterKey[];
	setPending: Dispatch<SetStateAction<FilterKey[]>>;
	/**
	 * Which popover on this toolbar is open — a filter clause's editor, or
	 * one of the non-filter bar controls (Group, Sort, Fields, etc). Exactly
	 * one shared value so opening any popover on the bar closes any other.
	 */
	openId: FilterKey | BarControlId | null;
	setOpenId: Dispatch<SetStateAction<FilterKey | BarControlId | null>>;
}

/** Owns the shared `pending`/`openId` state — call once in the parent. */
export function useFilterClauseState(): FilterClauseControl {
	const [pending, setPending] = useState<FilterKey[]>([]);
	const [openId, setOpenId] = useState<FilterKey | BarControlId | null>(null);
	return { pending, setPending, openId, setOpenId };
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
	const { pending, setPending, openId, setOpenId } = clause;
	const adding = openId === "addFilter";

	const shownKeys = shownFilterKeys(view.filters, pending);
	const availableFields = FILTER_FIELDS.filter(
		(f) => !shownKeys.includes(f.key),
	);
	// Split into the regular fields and their exclude counterparts so the
	// picker can group them instead of listing all 21+ flat and alphabetic.
	const standardFields = availableFields.filter((f) => !f.key.startsWith("exclude"));
	const excludeFields = availableFields.filter((f) => f.key.startsWith("exclude"));

	const addField = (key: FilterKey) => {
		setPending((keys) => [...keys, key]);
		setOpenId(key);
	};

	return (
		<span className="vf-control-anchor">
			<button
				type="button"
				className={`vf-add-filter${adding ? " is-on" : ""}`}
				onClick={(event) => {
					event.stopPropagation();
					setOpenId((current) => (current === "addFilter" ? null : "addFilter"));
				}}
			>
				+ Filter
			</button>
			{adding && availableFields.length > 0 && (
				<Popover align="left" onClose={() => setOpenId(null)}>
					<div className="vf-option-list vf-option-list-capped">
						{standardFields.map((field) => (
							<button
								key={field.key}
								type="button"
								className="vf-menu-item"
								onClick={() => addField(field.key)}
							>
								{field.label}
							</button>
						))}
						{excludeFields.length > 0 && (
							<>
								<div className="vf-menu-section-label">Exclude</div>
								<div className="vf-menu-divider" />
								{excludeFields.map((field) => (
									<button
										key={field.key}
										type="button"
										className="vf-menu-item"
										onClick={() => addField(field.key)}
									>
										{field.label}
									</button>
								))}
							</>
						)}
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
	const { pending, setPending, openId: editing, setOpenId: setEditing } = clause;

	const shownKeys = shownFilterKeys(filters, pending);
	const readonlyKeys = activeReadonlyFilterKeys(filters);

	const removeClause = (key: FilterKey) => {
		setPending((keys) => keys.filter((k) => k !== key));
		if (editing === key) setEditing(null);
		if (isDateFamilyKey(key)) {
			let next = withFilter(filters, key, undefined);
			next = withFilter(next, dateBoundKey(key, "Before"), undefined);
			next = withFilter(next, dateBoundKey(key, "After"), undefined);
			setFilters(next);
			return;
		}
		setFilters(withFilter(filters, key, undefined));
	};

	return (
		<span className="vf-filter-controls">
			{shownKeys.map((key) => (
				<span key={key} className="vf-control-anchor">
					<span className={`vf-filter-tag${key.startsWith("exclude") ? " is-excluded" : ""}`}>
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
					<span
						className={`vf-filter-tag is-readonly${key.startsWith("exclude") ? " is-excluded" : ""}`}
					>
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

	if (isDateFamilyKey(fieldKey)) {
		return (
			<DateClauseEditor
				fieldKey={fieldKey}
				filters={filters}
				onChange={onChange}
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

	if (
		fieldKey === "labels" ||
		fieldKey === "project" ||
		fieldKey === "excludeLabels" ||
		fieldKey === "excludeProject"
	) {
		return (
			<GroupedFilterField
				choices={filterChoices(fieldKey, snapshot, taxonomies)}
				current={current}
				onToggle={toggle}
			/>
		);
	}

	return (
		<div className="vf-chip-set">
			{filterChoices(fieldKey, snapshot, taxonomies).map((choice) => {
				const chosen = current.includes(choice.value);
				return (
					<button
						key={choice.value}
						type="button"
						className={`vf-chip vf-chip-button${chosen ? " is-on" : ""}`}
						style={chipTint(chosen, choice.color)}
						onClick={() => toggle(choice.value)}
					>
						{choice.label}
					</button>
				);
			})}
		</div>
	);
}

/**
 * Editor for a date-family clause (Due/Start/Created/Updated/Completed): an
 * exact "On" date, exclusive "Before"/"After" bounds, and — where the field's
 * `unsetIsVacuous` in the query grammar allows it — a "No date set" checkbox.
 * "On" and "No date set" are mutually exclusive here: this editor never
 * builds the `[value, NONE]` OR-combination the engine supports, since that
 * needs a list-builder this chip has no room for (see the phase's Non-goals).
 */
function DateClauseEditor({
	fieldKey,
	filters,
	onChange,
}: {
	fieldKey: DateFamilyKey;
	filters: ViewFilters;
	onChange: (next: ViewFilters) => void;
}) {
	const exact = filters[fieldKey] ?? [];
	const isUnset = exact.includes(NONE);
	const onDate = isUnset ? "" : (exact[0] ?? "");
	const beforeKey = dateBoundKey(fieldKey, "Before");
	const afterKey = dateBoundKey(fieldKey, "After");

	const setOnDate = (value: string) => {
		onChange(withFilter(filters, fieldKey, value ? [value] : undefined));
	};

	const setUnset = (checked: boolean) => {
		onChange(withFilter(filters, fieldKey, checked ? [NONE] : undefined));
	};

	return (
		<div className="vf-date-clause-editor">
			<label className="vf-date-clause-row">
				<span>On</span>
				<input
					type="date"
					className="vf-input"
					value={onDate}
					disabled={isUnset}
					onChange={(event) => setOnDate(event.target.value)}
				/>
			</label>
			<label className="vf-date-clause-row">
				<span>Before</span>
				<input
					type="date"
					className="vf-input"
					value={filters[beforeKey] ?? ""}
					onChange={(event) =>
						onChange(withFilter(filters, beforeKey, event.target.value))
					}
				/>
			</label>
			<label className="vf-date-clause-row">
				<span>After</span>
				<input
					type="date"
					className="vf-input"
					value={filters[afterKey] ?? ""}
					onChange={(event) =>
						onChange(withFilter(filters, afterKey, event.target.value))
					}
				/>
			</label>
			{dateFamilyAllowsUnset(fieldKey) && (
				<label className="vf-date-clause-row vf-date-clause-unset">
					<input
						type="checkbox"
						checked={isUnset}
						onChange={(event) => setUnset(event.target.checked)}
					/>
					<span>No date set</span>
				</label>
			)}
		</div>
	);
}

/**
 * Shared searchable-tree editor for the `labels` and `project` filter
 * clauses — both use `/`-nested display names for the same sidebar-style
 * grouping (see `vault-schema.md`'s Labels/Projects group-wildcard notes).
 * A folder node gets its own toggle chip whose value is the group-wildcard
 * pattern `"<path>/*"`; a leaf node gets the ordinary per-choice chip.
 */
function GroupedFilterField({
	choices,
	current,
	onToggle,
}: {
	choices: Choice[];
	current: string[];
	onToggle: (value: string) => void;
}) {
	const [search, setSearch] = useState("");
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

	const noneChoice = choices.find((c) => c.value === NONE);
	const treeChoices = choices.filter((c) => c.value !== NONE);

	const needle = search.trim().toLowerCase();
	const visibleChoices = needle
		? treeChoices.filter((c) => c.label.toLowerCase().includes(needle))
		: treeChoices;

	const tree = buildTree(visibleChoices, (c) => c.label);

	const chip = (value: string, label: string, color?: string | null) => {
		const chosen = current.includes(value);
		return (
			<button
				key={value}
				type="button"
				className={`vf-chip vf-chip-button${chosen ? " is-on" : ""}`}
				style={chipTint(chosen, color)}
				onClick={() => onToggle(value)}
			>
				{label}
			</button>
		);
	};

	return (
		<div className="vf-grouped-filter-field">
			<input
				type="text"
				className="vf-input"
				autoFocus
				value={search}
				placeholder="Search…"
				onChange={(event) => setSearch(event.target.value)}
			/>
			{noneChoice && (
				<div className="vf-chip-set">{chip(noneChoice.value, noneChoice.label)}</div>
			)}
			<div className="vf-chip-set vf-grouped-filter-tree">
				<TreeList
					nodes={tree}
					depth={0}
					groupKeyPrefix="filter-group"
					isCollapsed={(id) => collapsed[id] ?? needle.length === 0}
					onToggle={(id) =>
						setCollapsed((prev) => ({
							...prev,
							[id]: !(prev[id] ?? needle.length === 0),
						}))
					}
					renderLeaf={(choice) => chip(choice.value, choice.label, choice.color)}
					renderFolderExtra={(path) => chip(`${path}/*`, `${path}/*`)}
				/>
			</div>
		</div>
	);
}
