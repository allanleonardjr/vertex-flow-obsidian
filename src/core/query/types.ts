/**
 * Shared shapes for the query layer.
 *
 * Diagnostics are returned as data rather than thrown: the query bar renders
 * them inline under the input, and the tests assert on partial results from a
 * query that didn't fully parse.
 */

import type { ViewDefinition } from "../types";

export interface QuerySpan {
	/** Character offset into the source string, inclusive. */
	start: number;
	/** Character offset into the source string, exclusive. */
	end: number;
}

export type QueryIssueCode =
	/** A field name nothing recognises — `staus:todo`. */
	| "unknown-field"
	/** A field with no value at all — `status:`. */
	| "empty-value"
	/** A value no taxonomy / person / entity matches. Kept verbatim. */
	| "unknown-value"
	/** Legal and lossless, but can never match anything. */
	| "vacuous-value"
	/** Names something `ViewFilters` genuinely cannot express. */
	| "not-expressible"
	| "unterminated-quote"
	/** The same field given twice — values are merged. */
	| "duplicate-field"
	/** `me` used in a workspace where nobody is flagged `isSelf`. */
	| "self-unconfigured";

export interface QueryIssue {
	severity: "error" | "warning";
	code: QueryIssueCode;
	/** One sentence, sentence case, no trailing period. */
	message: string;
	span: QuerySpan;
	/** Replacement text for `span`, when the fix is unambiguous. */
	suggestion?: string;
}

export interface ParsedQuery {
	/**
	 * Always complete and canonical — fields absent from the source take the
	 * built-in view defaults. Populated even when `ok` is false, so the UI can
	 * still show a match count for a partially-valid query.
	 */
	definition: ViewDefinition;
	issues: QueryIssue[];
	/** No issue has severity `"error"`. Warnings do not clear this. */
	ok: boolean;
}
