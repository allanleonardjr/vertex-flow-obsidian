/**
 * Option metadata shared by the persistent view-control bar: what you can group
 * by, sort by, and filter on, plus how to render a filter clause's current
 * value. Kept out of the components so the Display chips and the Filter pills
 * agree on labels and never drift.
 */

import { basename } from "../../core/links";
import { listValues } from "../../core/taxonomy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import {
	NONE,
	SELF,
	type GroupByField,
	type SortField,
	type ViewFilters,
	type WorkspaceSnapshot,
} from "../../core/types";
import { FEATURES } from "../features";

export const GROUP_OPTIONS: { value: GroupByField; label: string }[] = [
	{ value: "none", label: "No grouping" },
	{ value: "status", label: "Status" },
	{ value: "priority", label: "Priority" },
	{ value: "taskType", label: "Type" },
	{ value: "assignee", label: "Assignee" },
	{ value: "label", label: "Label" },
	{ value: "project", label: "Project" },
	...(FEATURES.initiatives
		? [{ value: "initiative" as const, label: "Initiative" }]
		: []),
	...(FEATURES.cycles ? [{ value: "cycle" as const, label: "Cycle" }] : []),
];

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
	{ value: "rank", label: "Manual" },
	{ value: "priority", label: "Priority" },
	{ value: "status", label: "Status" },
	{ value: "title", label: "Title" },
	{ value: "dueDate", label: "Due date" },
	{ value: "startDate", label: "Start date" },
	{ value: "estimate", label: "Estimate" },
	{ value: "createdAt", label: "Created" },
	{ value: "updatedAt", label: "Updated" },
	...(FEATURES.cycles
		? [{ value: "cycleRank" as const, label: "Cycle rank" }]
		: []),
];

export const optionLabel = <T extends string>(
	options: { value: T; label: string }[],
	value: T,
): string => options.find((o) => o.value === value)?.label ?? value;

/** The `ViewFilters` keys the bar can add and edit as chip clauses. */
export type FilterKey =
	| "status"
	| "priority"
	| "taskType"
	| "labels"
	| "assignee"
	| "mentions"
	| "project"
	| "text";

export const FILTER_FIELDS: { key: FilterKey; label: string }[] = [
	{ key: "status", label: "Status" },
	{ key: "priority", label: "Priority" },
	{ key: "taskType", label: "Type" },
	{ key: "labels", label: "Label" },
	{ key: "assignee", label: "Assignee" },
	{ key: "mentions", label: "Mentions" },
	{ key: "project", label: "Project" },
	{ key: "text", label: "Title" },
];

/**
 * Filter keys the query bar can set but the chip bar has no editor for — shown
 * as a read-only tag with a ✕ so a query-only filter is never invisible and
 * unremovable. `parent` is the only one left now that Initiatives and Cycles
 * are gone; it would otherwise need a picker over the whole task list.
 */
export type ReadonlyFilterKey = "parent";

export const READONLY_FILTER_FIELDS: { key: ReadonlyFilterKey; label: string }[] = [
	{ key: "parent", label: "Parent" },
];

export const filterFieldLabel = (key: FilterKey | ReadonlyFilterKey): string =>
	FILTER_FIELDS.find((f) => f.key === key)?.label ??
	READONLY_FILTER_FIELDS.find((f) => f.key === key)?.label ??
	key;

export interface Choice {
	value: string;
	label: string;
	color?: string | null;
}

/** The selectable values for a chip-style (non-text) filter clause. */
export function filterChoices(
	key: Exclude<FilterKey, "text">,
	snapshot: WorkspaceSnapshot,
	taxonomies: WorkspaceTaxonomies,
): Choice[] {
	const people: Choice[] = snapshot.workspace.people.map((person) => ({
		value: person.id,
		label: person.name,
	}));
	const taxo = (kind: "status" | "priority" | "taskType" | "label"): Choice[] =>
		listValues(taxonomies[kind]).map((v) => ({
			value: v.id,
			label: v.name,
			color: v.color,
		}));

	switch (key) {
		case "status":
			return taxo("status");
		case "priority":
			return [...taxo("priority"), { value: NONE, label: "No priority" }];
		case "taskType":
			return [...taxo("taskType"), { value: NONE, label: "No type" }];
		case "labels":
			return [...taxo("label"), { value: NONE, label: "No labels" }];
		case "assignee":
			return [
				{ value: SELF, label: "Me" },
				...people,
				{ value: NONE, label: "Unassigned" },
			];
		case "mentions":
			return [{ value: SELF, label: "Me" }, ...people];
		case "project":
			return [
				...snapshot.projects.map((p) => ({ value: p.path, label: p.title })),
				{ value: NONE, label: "No project" },
			];
	}
}

/** A short human summary of a clause's current value, for the pill face. */
export function summarizeClause(
	key: FilterKey | ReadonlyFilterKey,
	filters: ViewFilters,
	snapshot: WorkspaceSnapshot,
	taxonomies: WorkspaceTaxonomies,
): string {
	if (key === "text") return filters.text?.trim() || "…";
	const values = filters[key] ?? [];
	if (values.length === 0) return "any";
	const name =
		key === "parent"
			? (v: string) =>
					snapshot.tasks.find((t) => t.path === v)?.id ?? basename(v)
			: (v: string) => {
					const choices = filterChoices(key, snapshot, taxonomies);
					return choices.find((c) => c.value === v)?.label ?? v;
				};
	if (values.length <= 2) return values.map(name).join(", ");
	return `${name(values[0])} +${values.length - 1}`;
}

/** Clause keys currently carrying a value (ignoring the archived-visibility flag). */
export function activeFilterKeys(filters: ViewFilters): FilterKey[] {
	return FILTER_FIELDS.map((f) => f.key).filter((key) =>
		key === "text" ? Boolean(filters.text?.trim()) : (filters[key]?.length ?? 0) > 0,
	);
}

/** Read-only clause keys currently carrying a value. */
export function activeReadonlyFilterKeys(
	filters: ViewFilters,
): ReadonlyFilterKey[] {
	return READONLY_FILTER_FIELDS.map((f) => f.key).filter(
		(key) => (filters[key]?.length ?? 0) > 0,
	);
}
