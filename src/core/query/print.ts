/**
 * A view definition → query text.
 *
 * The printer never reasons about *when* a value needs quoting or escaping.
 * For each value it tries candidate renderings prettiest-first and runs the
 * real lexer and resolver over each, taking the first that recovers the exact
 * stored string. The `=verbatim` fallback always succeeds by construction.
 *
 * That matters more than it looks: `parse(print(d)) === d` is the termination
 * proof for the query bar's two-way sync (a value that fails to round-trip
 * turns the box and the chips into an oscillator), so it needs to be a
 * mechanical property of one function rather than a chain of quoting rules
 * somebody has to keep true by hand.
 */

import { basename } from "../links";
import { getValue, type Taxonomy } from "../taxonomy";
import { NONE, SELF, type ViewDefinition } from "../types";
import {
	canonicalizeDefinition,
	FILTER_ARRAY_FIELDS,
	type ArrayFilterKey,
} from "../views/filter";
import { DEFAULT_DEFINITION } from "../views/defaults";
import type { QueryContext, QueryEntity } from "./context";
import {
	DATE_FIELD_VALUES,
	EMPTY_VALUES,
	FIELD_VALUES,
	FILTER_FIELDS,
	FLAG_TOKENS,
	GROUP_VALUES,
	LAYOUT_VALUES,
	SORT_VALUES,
	SUBTASK_VALUES,
	TEXT_FIELD,
	VERBATIM_PREFIX,
	type FilterFieldSpec,
} from "./grammar";
import { lex } from "./lex";
import { resolveValue } from "./resolve";

interface Candidate {
	text: string;
	verbatim: boolean;
}

function quote(text: string): string {
	return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render one value to source, quoting only when the bare form doesn't survive
 * the lexer — decided by running it, not by a character blacklist.
 */
function valueSource(candidate: Candidate): string {
	const prefix = candidate.verbatim ? VERBATIM_PREFIX : "";
	const bare = prefix + candidate.text;
	const lexed = lex(bare);
	const [token] = lexed.tokens;
	if (
		lexed.issues.length === 0 &&
		lexed.tokens.length === 1 &&
		token.kind === "bare" &&
		token.value.text === candidate.text &&
		token.value.verbatim === candidate.verbatim
	) {
		return bare;
	}
	return prefix + quote(candidate.text);
}

function taxonomyFor(
	spec: FilterFieldSpec,
	context: QueryContext,
): Taxonomy | null {
	switch (spec.resolveAs) {
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
	spec: FilterFieldSpec,
	context: QueryContext,
): QueryEntity[] | null {
	if (spec.resolveAs === "project") return context.projects;
	if (spec.resolveAs === "task") return context.tasks;
	return null;
}

/** Prettiest first; the last entry is always guaranteed to work. */
function candidatesFor(
	spec: FilterFieldSpec,
	value: string,
	context: QueryContext,
): Candidate[] {
	if (value === NONE) {
		return [{ text: "unset", verbatim: false }, { text: value, verbatim: true }];
	}
	if (value === SELF && spec.resolveAs === "person") {
		return [{ text: "me", verbatim: false }, { text: value, verbatim: true }];
	}

	const pretty: string[] = [];

	const entities = entitiesFor(spec, context);
	if (entities) {
		const entity = entities.find((candidate) => candidate.path === value);
		if (entity) {
			// A bare basename is the friendliest form, and `linksMatch` resolves
			// it — but only when it's unambiguous, which verification decides.
			pretty.push(basename(entity.path));
			if (entity.title !== basename(entity.path)) pretty.push(entity.title);
		}
		// For an entity the stored value is a full vault path — the ugliest
		// rendering there is — so try the basename/title *first*. `printValue`
		// still verifies every candidate round-trips, so an ambiguous name is
		// skipped and the path is used instead.
		return [
			...pretty.map((text) => ({ text, verbatim: false })),
			{ text: value, verbatim: false },
			{ text: value, verbatim: true },
		];
	}

	const taxonomy = taxonomyFor(spec, context);
	if (taxonomy) {
		// Ids are slug-shaped, so they read better and never need quoting.
		// The name is only a fallback for a value whose id doesn't resolve.
		const found = getValue(taxonomy, value);
		if (found) pretty.push(found.name);
	} else if (spec.resolveAs === "person") {
		const person = context.people.find((candidate) => candidate.id === value);
		if (person) pretty.push(person.name);
	}

	return [
		{ text: value, verbatim: false },
		...pretty.map((text) => ({ text, verbatim: false })),
		{ text: value, verbatim: true },
	];
}

function printValue(
	spec: FilterFieldSpec,
	value: string,
	context: QueryContext,
): string {
	for (const candidate of candidatesFor(spec, value, context)) {
		const source = valueSource(candidate);
		// Re-lex so the check runs on what will actually be in the string, then
		// resolve exactly as the parser will.
		const lexed = lex(source);
		const [token] = lexed.tokens;
		if (lexed.tokens.length !== 1 || token.kind !== "bare") continue;
		const resolved = resolveValue(
			spec,
			token.value.text,
			token.value.verbatim,
			context,
		);
		if (resolved.value === value) return source;
	}
	// Unreachable: the verbatim candidate is the identity.
	return valueSource({ text: value, verbatim: true });
}

/** Bare words when they survive a round-trip, else an explicit `title:"…"`. */
function printText(text: string): string {
	const lexed = lex(text);
	const bare = lexed.tokens.every((token) => token.kind === "bare");
	if (lexed.issues.length === 0 && lexed.tokens.length > 0 && bare) {
		const joined = lexed.tokens
			.map((token) => (token.kind === "bare" ? token.value.text : ""))
			.join(" ");
		if (joined === text) return text;
	}
	return `${TEXT_FIELD.token}:${quote(text)}`;
}

export function printQuery(
	definition: ViewDefinition,
	context: QueryContext,
): string {
	const canonical = canonicalizeDefinition(definition);
	const { filters } = canonical;
	const parts: string[] = [];

	for (const key of FILTER_ARRAY_FIELDS) {
		const values = filters[key as ArrayFilterKey];
		if (!values || values.length === 0) continue;
		const spec = FILTER_FIELDS[key as ArrayFilterKey];
		const rendered = values.map((value) => printValue(spec, value, context));
		parts.push(`${spec.token}:${rendered.join(",")}`);
	}

	if (filters.text) parts.push(printText(filters.text));

	if (filters.archived === "included") {
		parts.push(
			`${FLAG_TOKENS.archivedIncluded.field}:${FLAG_TOKENS.archivedIncluded.value}`,
		);
	} else if (filters.archived === "only") {
		parts.push(
			`${FLAG_TOKENS.archivedOnly.field}:${FLAG_TOKENS.archivedOnly.value}`,
		);
	}
	if (filters.openOnly) {
		parts.push(`${FLAG_TOKENS.openOnly.field}:${FLAG_TOKENS.openOnly.value}`);
	}
	if (filters.unscheduled) {
		parts.push(
			`${FLAG_TOKENS.unscheduled.field}:${FLAG_TOKENS.unscheduled.value}`,
		);
	}

	// `layout` and `empty` only when they differ from the default; `group` and
	// `sort` always, because they're always meaningful and printing them makes
	// the bar teach its own syntax.
	if (canonical.viewType !== DEFAULT_DEFINITION.viewType) {
		parts.push(`layout:${LAYOUT_VALUES[canonical.viewType].token}`);
	}
	parts.push(`group:${GROUP_VALUES[canonical.groupBy].token}`);
	parts.push(
		`sort:${canonical.sortDirection === "desc" ? "-" : ""}${SORT_VALUES[canonical.sortBy].token}`,
	);
	if (canonical.emptyColumnBehavior !== DEFAULT_DEFINITION.emptyColumnBehavior) {
		parts.push(`empty:${EMPTY_VALUES[canonical.emptyColumnBehavior].token}`);
	}
	// Calendar-only, but printed whenever non-default regardless of layout —
	// `hide:` and `empty:` follow the same "keep the clause even if this layout
	// ignores it" rule, so switching layouts never silently drops the setting.
	if (canonical.calendarDateField !== DEFAULT_DEFINITION.calendarDateField) {
		parts.push(`date:${DATE_FIELD_VALUES[canonical.calendarDateField].token}`);
	}
	// Printed whenever non-default, like `hide:` — kept even when the layout
	// ignores it, so switching layouts never silently drops the setting.
	if (canonical.subtaskDisplay !== DEFAULT_DEFINITION.subtaskDisplay) {
		parts.push(`subtasks:${SUBTASK_VALUES[canonical.subtaskDisplay].token}`);
	}
	if (canonical.hiddenFields.length > 0) {
		const tokens = canonical.hiddenFields.map((field) => FIELD_VALUES[field].token);
		parts.push(`hide:${tokens.join(",")}`);
	}

	return parts.join(" ");
}
