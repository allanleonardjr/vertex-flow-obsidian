/**
 * Pure path arithmetic for the workspace-scoped Trash folder.
 *
 * Vertex Flow keeps its own `Workspace/Trash/<Kind>/` folder rather than using
 * Obsidian's "Deleted files" trash, so a reversible delete never depends on a
 * per-machine preference (which is exactly what made Obsidian's own trash
 * unreliable across two synced machines). This module owns the mapping between a
 * live note path and its Trash counterpart.
 *
 * Deliberately free of any `obsidian` import so it stays unit-testable — the
 * `Mutations` / `VaultIndex` glue calls into it, never the other way round.
 */

import { joinPath } from "../core/links";
import type { EntityKind } from "../core/types";

/** Folder under each workspace root that holds trashed items. */
export const TRASH_FOLDER = "Trash";

/**
 * Sub-folder name per kind. Mirrors `FOLDERS` in `index-store.ts` — kept as its
 * own tiny map here only so this module takes no glue-layer import (see header).
 */
const KIND_FOLDER: Record<EntityKind, string> = {
	task: "Tasks",
	project: "Projects",
	view: "Views",
	dashboard: "Dashboards",
};

/** `<root>/<Folder>` — the live folder a note of `kind` lives in. */
export function liveFolder(root: string, kind: EntityKind): string {
	return joinPath(root, KIND_FOLDER[kind]);
}

/** `<root>/Trash/<Folder>` — where a trashed note of `kind` is moved to. */
export function trashFolder(root: string, kind: EntityKind): string {
	return joinPath(root, TRASH_FOLDER, KIND_FOLDER[kind]);
}

/**
 * The kind of a note sitting under `<root>/Trash/`, inferred from its Trash
 * sub-folder — or `null` when the path isn't inside this workspace's Trash at
 * all. Both arguments are extension-less vault paths.
 *
 * Classifying by folder rather than by `type:` frontmatter is the whole point:
 * a trashed task still says `type: task`, so `entityKindOf` would happily
 * resurface it as a live task.
 */
export function trashedItemKind(
	root: string,
	path: string,
): EntityKind | null {
	const prefix = `${joinPath(root, TRASH_FOLDER)}/`;
	if (!path.startsWith(prefix)) return null;
	const sub = path.slice(prefix.length).split("/")[0];
	for (const kind of Object.keys(KIND_FOLDER) as EntityKind[]) {
		if (KIND_FOLDER[kind] === sub) return kind;
	}
	return null;
}

/** Whether an extension-less vault path is inside `<root>/Trash/`. */
export function isInTrash(root: string, path: string): boolean {
	return path.startsWith(`${joinPath(root, TRASH_FOLDER)}/`);
}
