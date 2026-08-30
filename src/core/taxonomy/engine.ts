/**
 * The generic taxonomy engine.
 *
 * Status, Priority, Task Type and Labels are four *configurations* of this one
 * engine, not four bespoke systems (Golden Rule). The differences between them
 * are entirely data:
 *
 *   | Taxonomy  | Select | Ordered | Categorized |
 *   |-----------|--------|---------|-------------|
 *   | status    | single | yes     | yes         |
 *   | priority  | single | yes     | no          |
 *   | taskType  | single | no      | no          |
 *   | label     | multi  | no      | no          |
 *
 * The deletion guard in `planTaxonomyDeletion` is likewise written once and
 * applies identically to all four.
 */

import { slugify } from "../ids";
import type {
	StatusCategory,
	TaxonomyKind,
	TaxonomyValue,
} from "../types";

/** The shape-of-this-taxonomy configuration. Pure data, no behaviour. */
export interface TaxonomySchema {
	kind: TaxonomyKind;
	/** Labels are the only multi-select taxonomy. */
	multiSelect: boolean;
	/** Ordered taxonomies expose reordering and sort by `order`. */
	ordered: boolean;
	/** Only Status carries the fixed `StatusCategory` enum. */
	categorized: boolean;
	/** Whether a task may leave this field unset. Status is always required. */
	optional: boolean;
	/** Singular display name, for dialogs: "Delete status …". */
	label: string;
}

export const TAXONOMY_SCHEMAS: Record<TaxonomyKind, TaxonomySchema> = {
	status: {
		kind: "status",
		multiSelect: false,
		ordered: true,
		categorized: true,
		optional: false,
		label: "status",
	},
	priority: {
		kind: "priority",
		multiSelect: false,
		ordered: true,
		categorized: false,
		optional: true,
		label: "priority",
	},
	taskType: {
		kind: "taskType",
		multiSelect: false,
		ordered: false,
		categorized: false,
		optional: true,
		label: "task type",
	},
	label: {
		kind: "label",
		multiSelect: true,
		ordered: false,
		categorized: false,
		optional: true,
		label: "label",
	},
};

/** A taxonomy is its schema plus its configured values. */
export interface Taxonomy<V extends TaxonomyValue = TaxonomyValue> {
	schema: TaxonomySchema;
	values: V[];
}

export function createTaxonomy<V extends TaxonomyValue>(
	kind: TaxonomyKind,
	values: V[],
): Taxonomy<V> {
	return { schema: TAXONOMY_SCHEMAS[kind], values: values.slice() };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function getValue<V extends TaxonomyValue>(
	taxonomy: Taxonomy<V>,
	id: string | null | undefined,
): V | null {
	if (!id) return null;
	return taxonomy.values.find((value) => value.id === id) ?? null;
}

export function hasValue(taxonomy: Taxonomy, id: string): boolean {
	return taxonomy.values.some((value) => value.id === id);
}

/** Case-insensitive, trimmed name lookup — the "no two labels alike" check. */
export function findValueByName<V extends TaxonomyValue>(
	taxonomy: Taxonomy<V>,
	name: string,
): V | undefined {
	const needle = name.trim().toLowerCase();
	return taxonomy.values.find((value) => value.name.trim().toLowerCase() === needle);
}

/**
 * Display order: ordered taxonomies by `order`, unordered ones alphabetically.
 * Ties fall back to `id` so the result is deterministic across reloads.
 */
export function listValues<V extends TaxonomyValue>(taxonomy: Taxonomy<V>): V[] {
	const values = taxonomy.values.slice();
	if (taxonomy.schema.ordered) {
		values.sort(
			(a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
		);
	} else {
		values.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
	}
	return values;
}

/** Human-readable name for an id, with a graceful fallback for stale data. */
export function displayName(
	taxonomy: Taxonomy,
	id: string | null | undefined,
	fallback = "None",
): string {
	if (!id) return fallback;
	return getValue(taxonomy, id)?.name ?? id;
}

export function displayColor(
	taxonomy: Taxonomy,
	id: string | null | undefined,
): string | null {
	return getValue(taxonomy, id)?.color ?? null;
}

// ---------------------------------------------------------------------------
// Status-specific reads (the only categorized taxonomy)
// ---------------------------------------------------------------------------

/**
 * The category behind a status id. Categories drive all logic — progress,
 * "is this active", board grouping — regardless of how the user renamed things.
 */
export function categoryOf(
	statuses: Taxonomy,
	statusId: string | null | undefined,
): StatusCategory | null {
	return getValue(statuses, statusId)?.category ?? null;
}

export function isCompleted(statuses: Taxonomy, statusId: string | null): boolean {
	return categoryOf(statuses, statusId) === "completed";
}

export function isCanceled(statuses: Taxonomy, statusId: string | null): boolean {
	return categoryOf(statuses, statusId) === "canceled";
}

/** "Active" = started. Used by default filters and progress display. */
export function isStarted(statuses: Taxonomy, statusId: string | null): boolean {
	return categoryOf(statuses, statusId) === "started";
}

/** Neither completed nor canceled — i.e. still real, outstanding work. */
export function isOpen(statuses: Taxonomy, statusId: string | null): boolean {
	const category = categoryOf(statuses, statusId);
	return category !== "completed" && category !== "canceled";
}

/** Statuses in a category, in display order. A category may have zero. */
export function statusesInCategory<V extends TaxonomyValue>(
	statuses: Taxonomy<V>,
	category: StatusCategory,
): V[] {
	return listValues(statuses).filter((value) => value.category === category);
}

// ---------------------------------------------------------------------------
// Mutation (returns new taxonomies; never mutates in place)
// ---------------------------------------------------------------------------

export interface NewValueInput {
	name: string;
	color: string;
	category?: StatusCategory;
	/** Defaults to the end of the list for ordered taxonomies. */
	order?: number;
	/** Explicit id, else slugified from `name`. */
	id?: string;
}

export function addValue<V extends TaxonomyValue>(
	taxonomy: Taxonomy<V>,
	input: NewValueInput,
): Taxonomy<V> {
	const name = input.name.trim();
	if (!name) throw new Error(`A ${taxonomy.schema.label} needs a name`);

	if (findValueByName(taxonomy, name)) {
		throw new Error(`A ${taxonomy.schema.label} named "${name}" already exists`);
	}

	const taken = taxonomy.values.map((value) => value.id);
	const id = input.id?.trim() || slugify(name, taken);
	if (taken.includes(id)) {
		throw new Error(`A ${taxonomy.schema.label} with id "${id}" already exists`);
	}
	if (taxonomy.schema.categorized && !input.category) {
		throw new Error(`A ${taxonomy.schema.label} needs a category`);
	}

	const value = { id, name, color: input.color } as V;
	if (taxonomy.schema.ordered) {
		value.order = input.order ?? nextOrder(taxonomy);
	}
	if (taxonomy.schema.categorized) {
		value.category = input.category;
	}

	return { ...taxonomy, values: [...taxonomy.values, value] };
}

function nextOrder(taxonomy: Taxonomy): number {
	return (
		taxonomy.values.reduce((max, value) => Math.max(max, value.order ?? 0), 0) + 1
	);
}

export function updateValue<V extends TaxonomyValue>(
	taxonomy: Taxonomy<V>,
	id: string,
	patch: Partial<Omit<V, "id">>,
): Taxonomy<V> {
	if (!hasValue(taxonomy, id)) {
		throw new Error(`No ${taxonomy.schema.label} with id "${id}"`);
	}
	if (typeof patch.name === "string") {
		const clash = findValueByName(taxonomy, patch.name);
		if (clash && clash.id !== id) {
			throw new Error(
				`A ${taxonomy.schema.label} named "${patch.name.trim()}" already exists`,
			);
		}
	}
	return {
		...taxonomy,
		values: taxonomy.values.map((value) =>
			value.id === id ? { ...value, ...patch, id: value.id } : value,
		),
	};
}

/**
 * Reorder an ordered taxonomy to exactly `orderedIds`, renumbering `order`
 * from 1. Ids omitted from `orderedIds` keep their relative position at the end.
 */
export function reorderValues<V extends TaxonomyValue>(
	taxonomy: Taxonomy<V>,
	orderedIds: string[],
): Taxonomy<V> {
	if (!taxonomy.schema.ordered) {
		throw new Error(`${taxonomy.schema.kind} is not an ordered taxonomy`);
	}
	const byId = new Map(taxonomy.values.map((value) => [value.id, value]));
	const result: V[] = [];
	for (const id of orderedIds) {
		const value = byId.get(id);
		if (value) {
			result.push(value);
			byId.delete(id);
		}
	}
	for (const value of listValues({ ...taxonomy, values: [...byId.values()] })) {
		result.push(value);
	}
	return {
		...taxonomy,
		values: result.map((value, index) => ({ ...value, order: index + 1 })),
	};
}

// ---------------------------------------------------------------------------
// Deletion — the uniform guard
// ---------------------------------------------------------------------------

export interface TaxonomyDeletionPlan {
	kind: TaxonomyKind;
	/** Singular display name, for the dialog copy. */
	label: string;
	valueId: string;
	valueName: string;
	/** How many entities currently reference this value. */
	usageCount: number;
	/**
	 * True when the deletion cannot proceed without the caller picking a
	 * replacement. This is the whole guard: in-use values are never silently
	 * orphaned, in any of the four taxonomies.
	 */
	blocked: boolean;
	/** Every other value in the taxonomy, in display order. */
	replacementCandidates: TaxonomyValue[];
	/** True when nothing else exists to reassign to — deletion is impossible. */
	lastValueInUse: boolean;
}

export function planTaxonomyDeletion(
	taxonomy: Taxonomy,
	valueId: string,
	usageCount: number,
): TaxonomyDeletionPlan {
	const value = getValue(taxonomy, valueId);
	if (!value) throw new Error(`No ${taxonomy.schema.label} with id "${valueId}"`);

	const candidates = listValues(taxonomy).filter((v) => v.id !== valueId);
	const blocked = usageCount > 0;

	return {
		kind: taxonomy.schema.kind,
		label: taxonomy.schema.label,
		valueId,
		valueName: value.name,
		usageCount,
		blocked,
		replacementCandidates: candidates,
		lastValueInUse: blocked && candidates.length === 0,
	};
}

/**
 * Remove a value, requiring a replacement whenever the plan says it's blocked.
 * Returns the new taxonomy plus the replacement id the caller must now apply to
 * every affected entity (see `reassignValue`).
 */
export function applyTaxonomyDeletion<V extends TaxonomyValue>(
	taxonomy: Taxonomy<V>,
	plan: TaxonomyDeletionPlan,
	replacementId: string | null,
): { taxonomy: Taxonomy<V>; replacementId: string | null; removeFromAll: boolean } {
	// A multi-select taxonomy (labels) can drop a value from every entity that
	// carries it — a task with no labels is fine. A single-select one can't: a
	// task must always have a status, so a blocked delete needs a replacement.
	const removeFromAll =
		plan.blocked && replacementId == null && taxonomy.schema.multiSelect;

	if (plan.blocked && !removeFromAll) {
		if (!replacementId) {
			throw new Error(
				`Cannot delete ${plan.label} "${plan.valueName}" — it is used by ` +
					`${plan.usageCount} item(s). Choose a replacement first.`,
			);
		}
		if (replacementId === plan.valueId) {
			throw new Error("A value cannot be its own replacement");
		}
		if (!hasValue(taxonomy, replacementId)) {
			throw new Error(`No ${plan.label} with id "${replacementId}"`);
		}
	}

	const values = taxonomy.values.filter((value) => value.id !== plan.valueId);
	const renumbered = taxonomy.schema.ordered
		? values
				.slice()
				.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
				.map((value, index) => ({ ...value, order: index + 1 }))
		: values;

	return {
		taxonomy: { ...taxonomy, values: renumbered },
		replacementId: plan.blocked && !removeFromAll ? replacementId : null,
		removeFromAll,
	};
}

/**
 * Rewrite a single-select field. Returns `current` unchanged when it doesn't
 * reference the removed value, so callers can map over every task and only
 * write the ones that actually changed.
 */
export function reassignValue(
	current: string | null,
	fromId: string,
	toId: string,
): string | null {
	return current === fromId ? toId : current;
}

/** Multi-select equivalent, preserving order and de-duplicating. */
export function reassignValues(
	current: string[],
	fromId: string,
	toId: string,
): string[] {
	if (!current.includes(fromId)) return current;
	const out: string[] = [];
	for (const id of current) {
		const next = id === fromId ? toId : id;
		if (!out.includes(next)) out.push(next);
	}
	return out;
}
