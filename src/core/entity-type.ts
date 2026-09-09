/**
 * Helpers for the `type:` frontmatter discriminant on file-backed entities.
 *
 * Pure and Obsidian-free so both the glue layer (`index-store`, `main`) and the
 * unit suite can share one definition of "which `type:` values mean a task
 * note", "is this value the stale bare spelling", etc.
 *
 * The rename: pre-1.1 notes carry bare values (`task`, `project`, `workspace`,
 * `view`, `dashboard`); 1.1+ writes `vertex-flow-`-prefixed ones. Readers accept
 * both and normalize to the prefixed form; a post-rebuild migration rewrites any
 * surviving bare value on disk (see `src/obsidian/migrate-entity-type.ts`).
 */

import { ENTITY_TYPE, LEGACY_ENTITY_TYPE } from "./types";

/** Every `type:` value, old or new, that identifies a Task note. */
export function isTaskNoteType(value: unknown): boolean {
	return value === ENTITY_TYPE.task || value === "task";
}

/**
 * The stale bare value that should be rewritten, or `null` when the value is
 * already prefixed, unrecognized, or not a string. Drives the migration pass.
 */
export function legacyEntityTypeRewrite(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const canonical = LEGACY_ENTITY_TYPE[value];
	return canonical && canonical !== value ? canonical : null;
}
