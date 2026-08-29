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
 * Serializes a description string into a safely fenced markdown block.
 * If the description is empty or undefined, it returns an empty string.
 */
export function serializeDescription(
  description: string | undefined | null,
): string {
  console.log("description", description);
  if (!description || description.trim().length === 0) {
    return "";
  }

  return [
    DESCRIPTION_START_TAG,
    DESCRIPTION_HEADING,
    description.trim(),
    DESCRIPTION_END_TAG,
  ].join("\n");
}

/**
 * Parses a description from the raw file content using regex matching.
 * It strictly looks for content within the boundaries of the START and END tags,
 * ignoring any internal markdown syntax that might otherwise break section parsing.
 */
export function parseDescription(fileContent: string): string {
  // [\s\S]*? ensures we match multiline content safely without being greedy
  const blockRegex =
    /<!-- PLUGIN_DESCRIPTION_START -->\s*## Description\s*([\s\S]*?)\s*<!-- PLUGIN_DESCRIPTION_END -->/;
  const match = fileContent.match(blockRegex);

  if (match && match[1]) {
    const parsedDescription = match[1].trim();
    return parsedDescription.length > 0 ? parsedDescription : "";
  }

  return "";
}
