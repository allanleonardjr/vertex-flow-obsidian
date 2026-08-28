/**
 * Tokenizer.
 *
 * Splits a query into `field:a,b` clauses and bare words, carrying source spans
 * so diagnostics can quote the exact offending text. Knows nothing about which
 * fields exist — that's `parse.ts`'s job.
 *
 * Two lexical rules carry meaning downstream:
 *
 * - A **quoted** token is always a bare value, never a clause. `"status:todo"`
 *   searches for that literal string, which is the escape hatch that lets an
 *   unknown `field:` be treated as an error rather than as text.
 * - A leading `=` **outside** the quotes marks a value verbatim. It sits outside
 *   so "is this verbatim?" is decided lexically, before any string processing —
 *   `="a b"` is verbatim, `"=a b"` is the literal text `=a b`.
 */

import { VERBATIM_PREFIX } from "./grammar";
import type { QueryIssue, QuerySpan } from "./types";

export interface LexedValue {
	/** Decoded: quotes stripped, escapes applied, `=` prefix removed. */
	text: string;
	/** The source had a leading `=` outside any quotes. */
	verbatim: boolean;
	/** Covers the whole source value, including `=` and quotes. */
	span: QuerySpan;
}

export type LexedToken =
	| {
			kind: "clause";
			/** Lower-cased field name, without the colon. */
			field: string;
			fieldSpan: QuerySpan;
			values: LexedValue[];
			span: QuerySpan;
	  }
	| { kind: "bare"; value: LexedValue; span: QuerySpan };

export interface LexResult {
	tokens: LexedToken[];
	issues: QueryIssue[];
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/** Raw (unquoted) values stop at anything structural. */
function isRawChar(char: string): boolean {
	return !WHITESPACE.has(char) && char !== "," && char !== ":" && char !== '"';
}

export function lex(source: string): LexResult {
	const tokens: LexedToken[] = [];
	const issues: QueryIssue[] = [];
	let i = 0;

	/** Reads one value; returns null when there is nothing to read. */
	function readValue(): LexedValue | null {
		const start = i;
		let verbatim = false;

		if (source[i] === VERBATIM_PREFIX) {
			verbatim = true;
			i += 1;
		}

		if (source[i] === '"') {
			i += 1;
			let text = "";
			let closed = false;
			while (i < source.length) {
				const char = source[i];
				if (char === "\\" && (source[i + 1] === '"' || source[i + 1] === "\\")) {
					text += source[i + 1];
					i += 2;
					continue;
				}
				if (char === '"') {
					i += 1;
					closed = true;
					break;
				}
				text += char;
				i += 1;
			}
			if (!closed) {
				issues.push({
					severity: "error",
					code: "unterminated-quote",
					message: "Unterminated quote",
					span: { start, end: source.length },
				});
			}
			return { text, verbatim, span: { start, end: i } };
		}

		let text = "";
		while (i < source.length && isRawChar(source[i])) {
			text += source[i];
			i += 1;
		}

		// Nothing consumed and no `=` seen — there was no value here at all.
		if (text === "" && !verbatim) return null;
		return { text, verbatim, span: { start, end: i } };
	}

	while (i < source.length) {
		if (WHITESPACE.has(source[i])) {
			i += 1;
			continue;
		}

		const tokenStart = i;

		// A quoted token is always text, so it can never open a clause.
		if (source[i] === '"' || source[i] === VERBATIM_PREFIX) {
			const value = readValue();
			if (!value) {
				i += 1;
				continue;
			}
			tokens.push({ kind: "bare", value, span: { start: tokenStart, end: i } });
			continue;
		}

		// Read a bare word, then see whether a colon turns it into a field.
		let word = "";
		while (i < source.length && isRawChar(source[i])) {
			word += source[i];
			i += 1;
		}

		if (source[i] !== ":") {
			if (word === "") {
				// A stray structural character (a lone comma, say). Skip it.
				i += 1;
				continue;
			}
			tokens.push({
				kind: "bare",
				value: { text: word, verbatim: false, span: { start: tokenStart, end: i } },
				span: { start: tokenStart, end: i },
			});
			continue;
		}

		const fieldSpan = { start: tokenStart, end: i };
		i += 1; // consume ':'

		const values: LexedValue[] = [];
		for (;;) {
			const value = readValue();
			if (value) values.push(value);
			if (source[i] === ",") {
				i += 1;
				continue;
			}
			break;
		}

		tokens.push({
			kind: "clause",
			field: word.toLowerCase(),
			fieldSpan,
			values,
			span: { start: tokenStart, end: i },
		});
	}

	return { tokens, issues };
}
