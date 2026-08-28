/**
 * Value resolution — the one place a typed word becomes a stored id.
 *
 * Every path ends in a stored value, never a failure: an unmatched word is kept
 * **verbatim** with a warning rather than dropped. Saved views routinely
 * reference deleted statuses, departed people and moved projects, and a filter
 * that silently vanished on an unrelated edit would be far worse than one the
 * bar flags as unrecognised.
 *
 * The printer calls back into this module to verify its own output (see
 * `print.ts`), so anything added here is automatically honoured in both
 * directions.
 */

import { basename, parseLink } from "../links";
import { findValueByName, getValue, type Taxonomy } from "../taxonomy";
import { NONE, SELF } from "../types";
import type { QueryContext, QueryEntity } from "./context";
import {
	SELF_KEYWORDS,
	UNSET_KEYWORDS,
	type FilterFieldSpec,
	type ResolveAs,
} from "./grammar";
import type { QueryIssue } from "./types";

/** An issue without its span — the caller knows where the value came from. */
export type SpanlessIssue = Omit<QueryIssue, "span">;

export interface Resolved {
	value: string;
	issue?: SpanlessIssue;
}

function equalsCI(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function taxonomyFor(
	kind: ResolveAs,
	context: QueryContext,
): Taxonomy | null {
	switch (kind) {
		case "status":
			return context.taxonomies.status;
		case "priority":
			return context.taxonomies.priority;
		case "taskType":
			return context.taxonomies.taskType;
		case "label":
			return context.taxonomies.label;
		default:
			return null;
	}
}

function entitiesFor(
	kind: ResolveAs,
	context: QueryContext,
): QueryEntity[] | null {
	if (kind === "project") return context.projects;
	if (kind === "task") return context.tasks;
	return null;
}

/** Exactly one match, or nothing — never a guess. */
function soleMatch(
	entities: QueryEntity[],
	predicate: (entity: QueryEntity) => boolean,
): QueryEntity | "ambiguous" | null {
	const hits = entities.filter(predicate);
	if (hits.length === 1) return hits[0];
	if (hits.length > 1) return "ambiguous";
	return null;
}

function resolveTaxonomyValue(
	taxonomy: Taxonomy,
	raw: string,
	label: string,
): Resolved {
	if (getValue(taxonomy, raw)) return { value: raw };

	const byId = taxonomy.values.find((value) => equalsCI(value.id, raw));
	if (byId) return { value: byId.id };

	const byName = findValueByName(taxonomy, raw);
	if (byName) return { value: byName.id };

	return {
		value: raw,
		issue: {
			severity: "warning",
			code: "unknown-value",
			message: `No ${label} named "${raw}" — keeping it as written`,
		},
	};
}

function resolvePerson(raw: string, context: QueryContext): Resolved {
	const { people } = context;

	const exact = people.find((person) => person.id === raw);
	if (exact) return { value: exact.id };

	const byId = people.find((person) => equalsCI(person.id, raw));
	if (byId) return { value: byId.id };

	const byName = people.find((person) => equalsCI(person.name, raw));
	if (byName) return { value: byName.id };

	const byAlias = people.find((person) =>
		person.aliases?.some((alias) => equalsCI(alias, raw)),
	);
	if (byAlias) return { value: byAlias.id };

	return {
		value: raw,
		issue: {
			severity: "warning",
			code: "unknown-value",
			message: `Nobody named "${raw}" in this workspace — keeping it as written`,
		},
	};
}

function resolveEntity(
	raw: string,
	entities: QueryEntity[],
	label: string,
): Resolved {
	const normalized = parseLink(raw) ?? raw;

	const exact = entities.find((entity) => entity.path === normalized);
	if (exact) return { value: exact.path };

	const byTitle = soleMatch(entities, (entity) =>
		equalsCI(entity.title, normalized),
	);
	if (byTitle === "ambiguous") {
		return {
			value: normalized,
			issue: {
				severity: "warning",
				code: "unknown-value",
				message: `More than one ${label} is called "${raw}" — use the full path`,
			},
		};
	}
	if (byTitle) return { value: byTitle.path };

	const byBasename = soleMatch(entities, (entity) =>
		equalsCI(basename(entity.path), normalized),
	);
	if (byBasename === "ambiguous") {
		return {
			value: normalized,
			issue: {
				severity: "warning",
				code: "unknown-value",
				message: `More than one ${label} is called "${raw}" — use the full path`,
			},
		};
	}
	if (byBasename) return { value: byBasename.path };

	return {
		value: normalized,
		issue: {
			severity: "warning",
			code: "unknown-value",
			message: `No ${label} named "${raw}" — keeping it as written`,
		},
	};
}

/**
 * Resolve one clause value.
 *
 * `verbatim` (a leading `=` in the source) short-circuits everything: it is what
 * makes a taxonomy value literally named "unset", or a stale id, expressible.
 */
export function resolveValue(
	spec: FilterFieldSpec,
	raw: string,
	verbatim: boolean,
	context: QueryContext,
): Resolved {
	if (verbatim) return { value: raw };

	const lowered = raw.trim().toLowerCase();

	// Reserved keywords always win over taxonomy values. The alternative —
	// letting a value shadow them — means a query silently changes meaning the
	// day somebody adds a label called "unset". `=` is the escape.
	if (UNSET_KEYWORDS.includes(lowered as (typeof UNSET_KEYWORDS)[number])) {
		return {
			value: NONE,
			issue: spec.unsetIsVacuous
				? {
						severity: "warning",
						code: "vacuous-value",
						message: `${spec.token}:${lowered} can never match anything`,
					}
				: undefined,
		};
	}

	if (
		spec.resolveAs === "person" &&
		SELF_KEYWORDS.includes(lowered as (typeof SELF_KEYWORDS)[number])
	) {
		return {
			value: SELF,
			issue: context.selfId
				? undefined
				: {
						severity: "warning",
						code: "self-unconfigured",
						message: "Nobody is marked as you yet, so this matches nothing",
					},
		};
	}

	const taxonomy = taxonomyFor(spec.resolveAs, context);
	if (taxonomy) return resolveTaxonomyValue(taxonomy, raw, spec.token);

	if (spec.resolveAs === "person") return resolvePerson(raw, context);

	const entities = entitiesFor(spec.resolveAs, context);
	if (entities) return resolveEntity(raw, entities, spec.token);

	// Unreachable: every `ResolveAs` is handled above. Kept as a total fallback
	// that still normalises a pasted wikilink rather than throwing.
	return { value: parseLink(raw) ?? raw };
}
