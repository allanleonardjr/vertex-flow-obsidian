/**
 * The `## Description` section of a task note.
 *
 * A task note's body has up to three parts:
 *
 *     ## Description          ← what the editor edits
 *     …prose, sub-headings…
 *
 *     ## Some other section   ← the user's own writing, never touched
 *
 *     <!-- PLUGIN_COMMENTS_START -->  ← owned by comments.ts
 *
 * Editing the description must not disturb either of the other two. Everything
 * here is string surgery on an already-split body, so it stays testable and
 * free of the Obsidian API.
 */

import { splitBody, withComments, parseComments } from "./comments";

export const DESCRIPTION_HEADING = "## Description";

/** A level-1 or level-2 heading ends the description; `###` sub-sections don't. */
const SECTION_BOUNDARY = /^#{1,2}\s/;
const DESCRIPTION_RE = /^##\s+description\s*$/i;

interface DescriptionSpan {
	/** Line index of the `## Description` heading, or -1 when absent. */
	heading: number;
	/** First line of content (inclusive). */
	start: number;
	/** One past the last line of content. */
	end: number;
}

function locate(lines: string[]): DescriptionSpan {
	const heading = lines.findIndex((line) => DESCRIPTION_RE.test(line.trim()));

	// No heading: the whole prose *is* the description. Notes created by hand,
	// or by another tool, shouldn't have their text hidden from the editor just
	// because they lack our heading.
	if (heading === -1) return { heading: -1, start: 0, end: lines.length };

	let end = lines.length;
	for (let i = heading + 1; i < lines.length; i++) {
		if (SECTION_BOUNDARY.test(lines[i])) {
			end = i;
			break;
		}
	}
	return { heading, start: heading + 1, end };
}

/** The description text of a note body, without its heading. */
export function extractDescription(body: string): string {
	const prose = splitBody(body).description;
	const lines = prose.split("\n");
	const span = locate(lines);
	return lines.slice(span.start, span.end).join("\n").trim();
}

/**
 * Write the description back, preserving every other section and the comment
 * block. A note without the heading gains one on first save, so subsequent
 * edits become surgical.
 */
export function withDescription(body: string, text: string): string {
	const split = splitBody(body);
	const lines = split.description.split("\n");
	const span = locate(lines);
	const content = text.trim();

	const before = span.heading === -1 ? [] : lines.slice(0, span.heading);
	const after = lines.slice(span.end);

	const section =
		content.length > 0 ? [DESCRIPTION_HEADING, "", content, ""] : [];

	const prose = [...before, ...section, ...after]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	// Round-trip through the comments writer so the delimited block, and any
	// trailing content after it, are reassembled exactly as they were.
	return withComments(
		prose ? `${prose}\n` : "",
		parseComments(body),
	);
}
