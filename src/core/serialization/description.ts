/**
 * The `## Description` section of a task note.
 *
 * A task note's body has up to three parts:
 *
 *     <!-- PLUGIN_DESCRIPTION_START -->
 *     ## Description
 *     …prose, sub-headings…    ← what the editor edits
 *     <!-- PLUGIN_DESCRIPTION_END -->
 *
 *     <!-- PLUGIN_COMMENTS_START -->  ← owned by comments.ts

 *     ## Some other section   ← the user's own writing, never touched
 *
 * Editing the description must not disturb either of the other two. Everything
 * here is string surgery on an already-split body, so it stays testable and
 * free of the Obsidian API.
 */

export const DESCRIPTION_START_TAG = "<!-- PLUGIN_DESCRIPTION_START -->";
export const DESCRIPTION_END_TAG = "<!-- PLUGIN_DESCRIPTION_END -->";
export const DESCRIPTION_HEADING = "## Description";

/**
 * Serializes a description into its fenced block.
 *
 * The block is emitted even when there's nothing to put in it. An empty
 * description used to collapse the whole section away, which left someone
 * editing the raw note with no indication of where the description belongs —
 * and made a cleared description indistinguishable from a note that never had
 * one. The heading is structure rather than content (`parseDescription`
 * strips it), so an empty block round-trips back to `""` and the editor still
 * shows its placeholder.
 */
export function serializeDescription(
  description: string | undefined | null,
): string {
  return [
    DESCRIPTION_START_TAG,
    DESCRIPTION_HEADING,
    // Empty when there's no description, leaving a blank line under the
    // heading for someone hand-editing the note to type into.
    description?.trim() ?? "",
    DESCRIPTION_END_TAG,
  ].join("\n");
}

const escape = (literal: string) =>
  literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The description block, built from the constants above rather than repeating
 * them — otherwise renaming a tag would silently stop the parser matching.
 * `[\s\S]*?` matches multiline content without running past the end tag.
 */
const BLOCK_RE = new RegExp(
  `${escape(DESCRIPTION_START_TAG)}\\s*${escape(
    DESCRIPTION_HEADING,
  )}\\s*([\\s\\S]*?)\\s*${escape(DESCRIPTION_END_TAG)}`,
);

/**
 * Reads the description out of a note body.
 *
 * Only the fenced block counts: the tags, not the heading, are what bound the
 * section, so a description may contain `##` headings of its own without the
 * parser mistaking one for the end of the section. A block with an empty body
 * reads as `""`, the same as a note that has no block at all.
 */
export function parseDescription(fileContent: string): string {
  return fileContent.match(BLOCK_RE)?.[1]?.trim() ?? "";
}
