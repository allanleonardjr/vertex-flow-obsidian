/**
 * Query text → a complete view definition.
 *
 * Never throws. Fields absent from the source take the built-in defaults, so
 * the result is always a definition you can apply as-is; `ok` tells you whether
 * anything went wrong badly enough that you probably shouldn't.
 *
 * An unknown `field:` is an **error**, not free text — GitHub's "treat it as a
 * search term" rule would silently widen a view on a typo, which is exactly the
 * mistake this bar exists to catch. A quoted token is always text, so
 * `"status:todo"` remains the escape hatch.
 */

import type {
	CanvasArrangement,
	CanvasDirection,
	CanvasRelationKind,
	EmptyColumnBehavior,
	GroupByField,
	SortField,
	SubtaskDisplay,
	TaskField,
	ViewDefinition,
	ViewFilters,
	ViewType,
} from "../types";
import { canonicalizeDefinition } from "../views/filter";
import { DEFAULT_DEFINITION } from "../views/defaults";
import type { QueryContext } from "./context";
import {
	ALL_FIELD_TOKENS,
	CANVAS_DIRECTION_BY_TOKEN,
	CANVAS_LAYOUT_BY_TOKEN,
	DATE_FIELD_BY_TOKEN,
	EMPTY_BY_TOKEN,
	FIELD_BY_TOKEN,
	FILTER_FIELDS,
	FILTER_FIELD_BY_TOKEN,
	FLAG_FIELD_ALIASES,
	FLAG_TOKENS,
	GROUP_BY_TOKEN,
	LAYOUT_BY_TOKEN,
	LAYOUT_ONLY_CLAUSES,
	LEGACY_TOP_LEVEL_VALUES,
	NOT_EXPRESSIBLE,
	RELATION_KIND_BY_TOKEN,
	SORT_BY_TOKEN,
	SUBTASK_BY_TOKEN,
} from "./grammar";
import { lex, type LexedToken } from "./lex";
import { resolveValue } from "./resolve";
import type { ParsedQuery, QueryIssue, QuerySpan } from "./types";

/* --------------------------------------------------------- suggestions ---- */

function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i += 1) {
		const current = [i];
		for (let j = 1; j <= b.length; j += 1) {
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[b.length];
}

function nearestField(word: string): string | undefined {
	let best: string | undefined;
	let bestDistance = 3; // only suggest within edit distance 2
	for (const candidate of ALL_FIELD_TOKENS) {
		const distance = editDistance(word, candidate);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = candidate;
		}
	}
	return best;
}

/* --------------------------------------------------------------- parse ---- */

export function parseQuery(
	source: string,
	context: QueryContext,
): ParsedQuery {
	const { tokens, issues } = lex(source);

	const filters: ViewFilters = {};
	const textParts: string[] = [];
	let viewType: ViewType = DEFAULT_DEFINITION.viewType;
	let groupBy: GroupByField = DEFAULT_DEFINITION.groupBy;
	let sortBy: SortField = DEFAULT_DEFINITION.sortBy;
	let sortDirection = DEFAULT_DEFINITION.sortDirection;
	let emptyColumnBehavior: EmptyColumnBehavior =
		DEFAULT_DEFINITION.emptyColumnBehavior;
	const hiddenFields: TaskField[] = [...DEFAULT_DEFINITION.hiddenFields];
	let subtaskDisplay: SubtaskDisplay = DEFAULT_DEFINITION.subtaskDisplay;
	let calendarDateField = DEFAULT_DEFINITION.calendarDateField;
	let canvasArrangement: CanvasArrangement =
		DEFAULT_DEFINITION.canvasArrangement;
	let canvasDirection: CanvasDirection = DEFAULT_DEFINITION.canvasDirection;
	const canvasHiddenRelationKinds: CanvasRelationKind[] = [
		...DEFAULT_DEFINITION.canvasHiddenRelationKinds,
	];
	let recurringPreview = DEFAULT_DEFINITION.recurringPreview;

	const seen = new Set<string>();

	const fail = (
		code: QueryIssue["code"],
		message: string,
		span: QuerySpan,
		suggestion?: string,
	) => issues.push({ severity: "error", code, message, span, suggestion });

	const noteDuplicate = (field: string, span: QuerySpan) => {
		if (seen.has(field)) {
			issues.push({
				severity: "warning",
				code: "duplicate-field",
				message: `"${field}" appears more than once`,
				span,
			});
			return true;
		}
		seen.add(field);
		return false;
	};

	/** Single-valued fields: one value, or an error. */
	const soleValue = (token: Extract<LexedToken, { kind: "clause" }>) => {
		if (token.values.length === 0) {
			fail("empty-value", `"${token.field}" needs a value`, token.span);
			return null;
		}
		return token.values[0];
	};

	for (const token of tokens) {
		if (token.kind === "bare") {
			textParts.push(token.value.text);
			continue;
		}

		const field = FLAG_FIELD_ALIASES[token.field] ?? token.field;

		// Tokens that name something ViewFilters genuinely cannot express.
		if (token.values.length === 1) {
			const key = `${field}:${token.values[0].text.trim().toLowerCase()}`;
			const rejection = NOT_EXPRESSIBLE[key];
			if (rejection) {
				fail(
					"not-expressible",
					rejection.message,
					token.span,
					rejection.suggestion,
				);
				continue;
			}
		}

		/* -- flags -- */

		if (field === "is") {
			const value = soleValue(token);
			if (!value) continue;
			const lowered = value.text.trim().toLowerCase();
			// `is:top-level` is retired; keep parsing it as `subtasks:hidden`.
			if (LEGACY_TOP_LEVEL_VALUES.includes(lowered as never)) {
				noteDuplicate("subtasks", token.span);
				subtaskDisplay = "hidden";
			} else if (lowered === FLAG_TOKENS.openOnly.value) {
				filters.openOnly = true;
			} else if (lowered === FLAG_TOKENS.unscheduled.value) {
				filters.unscheduled = true;
			} else if (lowered === FLAG_TOKENS.recurring.value) {
				filters.recurring = true;
			} else {
				fail("unknown-value", `"is:${lowered}" isn't a known flag`, token.span);
			}
			continue;
		}

		if (field === "show") {
			const value = soleValue(token);
			if (!value) continue;
			// `show:archived` and `show:archived-only` both set `filters.archived`,
			// so a query with both is a real conflict — dedupe on that key.
			// `show:recurring` is a separate presentation flag on the view.
			const lowered = value.text.trim().toLowerCase();
			if (lowered === FLAG_TOKENS.archivedIncluded.value) {
				noteDuplicate("archived", token.span);
				filters.archived = "included";
			} else if (lowered === FLAG_TOKENS.archivedOnly.value) {
				noteDuplicate("archived", token.span);
				filters.archived = "only";
			} else if (lowered === FLAG_TOKENS.recurringPreview.value) {
				noteDuplicate("recurringPreview", token.span);
				recurringPreview = true;
			} else {
				fail("unknown-value", `"show:${lowered}" isn't a known flag`, token.span);
			}
			continue;
		}

		/* -- presentation enums -- */

		if (
			field === "group" ||
			field === "sort" ||
			field === "layout" ||
			field === "empty" ||
			field === "date" ||
			field === "subtasks" ||
			field === "canvas-layout" ||
			field === "canvas-direction"
		) {
			const value = soleValue(token);
			if (!value) continue;
			noteDuplicate(field, token.span);

			let raw = value.text.trim().toLowerCase();
			let descending = false;
			if (field === "sort" && raw.startsWith("-")) {
				descending = true;
				raw = raw.slice(1);
			}

			// Closed unions, unlike taxonomy ids — a stale one would just be
			// coerced away on save, so there's nothing to preserve verbatim.
			if (field === "group") {
				const match = GROUP_BY_TOKEN.get(raw);
				if (!match) fail("unknown-value", `"${raw}" isn't a grouping`, value.span);
				else groupBy = match;
			} else if (field === "sort") {
				const match = SORT_BY_TOKEN.get(raw);
				if (!match) fail("unknown-value", `"${raw}" isn't a sort field`, value.span);
				else {
					sortBy = match;
					sortDirection = descending ? "desc" : "asc";
				}
			} else if (field === "layout") {
				const match = LAYOUT_BY_TOKEN.get(raw);
				if (!match) fail("unknown-value", `"${raw}" isn't a layout`, value.span);
				else viewType = match;
			} else if (field === "canvas-layout") {
				const match = CANVAS_LAYOUT_BY_TOKEN.get(raw);
				if (!match) {
					fail(
						"unknown-value",
						`"${raw}" isn't a canvas arrangement`,
						value.span,
					);
				} else canvasArrangement = match;
			} else if (field === "canvas-direction") {
				const match = CANVAS_DIRECTION_BY_TOKEN.get(raw);
				if (!match) {
					fail(
						"unknown-value",
						`"${raw}" isn't a canvas direction`,
						value.span,
					);
				} else canvasDirection = match;
			} else if (field === "date") {
				const match = DATE_FIELD_BY_TOKEN.get(raw);
				if (!match) {
					fail(
						"unknown-value",
						`"${raw}" isn't a calendar date field`,
						value.span,
					);
				} else calendarDateField = match;
			} else if (field === "subtasks") {
				const match = SUBTASK_BY_TOKEN.get(raw);
				if (!match) {
					fail("unknown-value", `"${raw}" isn't a sub-task mode`, value.span);
				} else subtaskDisplay = match;
			} else {
				const match = EMPTY_BY_TOKEN.get(raw);
				if (!match) {
					fail("unknown-value", `"${raw}" isn't an empty-column rule`, value.span);
				} else emptyColumnBehavior = match;
			}
			continue;
		}

		/* -- hidden fields -- */

		if (field === "hide") {
			if (token.values.length === 0) {
				fail("empty-value", `"hide" needs a value`, token.span);
				continue;
			}
			noteDuplicate("hide", token.span);
			for (const value of token.values) {
				const raw = value.text.trim().toLowerCase();
				const match = FIELD_BY_TOKEN.get(raw);
				if (!match) {
					fail("unknown-value", `"${raw}" isn't a task field`, value.span);
				} else if (!hiddenFields.includes(match)) {
					hiddenFields.push(match);
				}
			}
			continue;
		}

		/* -- canvas relation visibility -- */

		if (field === "relations") {
			if (token.values.length === 0) {
				fail("empty-value", `"relations" needs a value`, token.span);
				continue;
			}
			noteDuplicate("relations", token.span);
			for (const value of token.values) {
				const raw = value.text.trim().toLowerCase();
				const match = RELATION_KIND_BY_TOKEN.get(raw);
				if (!match) {
					fail("unknown-value", `"${raw}" isn't a relation kind`, value.span);
				} else if (!canvasHiddenRelationKinds.includes(match)) {
					canvasHiddenRelationKinds.push(match);
				}
			}
			continue;
		}

		/* -- filters -- */

		const filterKey = FILTER_FIELD_BY_TOKEN.get(field);
		if (!filterKey) {
			fail(
				"unknown-field",
				`"${token.field}" isn't a field`,
				token.fieldSpan,
				nearestField(token.field),
			);
			continue;
		}

		if (token.values.length === 0) {
			fail("empty-value", `"${token.field}" needs a value`, token.span);
			continue;
		}

		if (filterKey === "text") {
			for (const value of token.values) textParts.push(value.text);
			continue;
		}

		noteDuplicate(filterKey, token.span);

		const key = filterKey;
		const spec = FILTER_FIELDS[key];
		const collected = filters[key] ?? [];
		for (const value of token.values) {
			const resolved = resolveValue(spec, value.text, value.verbatim, context);
			if (resolved.issue) issues.push({ ...resolved.issue, span: value.span });
			collected.push(resolved.value);
		}
		filters[key] = collected;
	}

	const text = textParts.join(" ").trim();
	if (text) filters.text = text;

	const definition: ViewDefinition = canonicalizeDefinition({
		filters,
		viewType,
		groupBy,
		sortBy,
		sortDirection,
		emptyColumnBehavior,
		hiddenFields,
		subtaskDisplay,
		calendarDateField,
		canvasArrangement,
		canvasDirection,
		canvasHiddenRelationKinds,
		recurringPreview,
	});

	return {
		definition,
		issues,
		ok: !issues.some((issue) => issue.severity === "error"),
	};
}

export interface ParsedFilterQuery {
	filters: ViewFilters;
	issues: QueryIssue[];
	ok: boolean;
}

/**
 * Parse a filter-only query — the grammar a dashboard `filter:` line uses.
 * Identical to `parseQuery` but any layout clause (`group:`/`sort:`/`hide:`/…)
 * is an error rather than being silently applied to a definition nobody reads.
 */
export function parseFilterQuery(
	source: string,
	context: QueryContext,
): ParsedFilterQuery {
	const result = parseQuery(source, context);
	const issues = [...result.issues];
	for (const token of lex(source).tokens) {
		if (token.kind === "clause" && LAYOUT_ONLY_CLAUSES.has(token.field)) {
			issues.push({
				severity: "error",
				code: "not-expressible",
				message: `"${token.field}:" configures a view layout, not a filter`,
				span: token.span,
			});
		}
	}
	return {
		filters: result.definition.filters,
		issues,
		ok: !issues.some((issue) => issue.severity === "error"),
	};
}
