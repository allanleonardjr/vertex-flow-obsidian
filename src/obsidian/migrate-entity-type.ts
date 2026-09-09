/**
 * Post-rebuild migration: rewrite pre-1.1 bare `type:` frontmatter values
 * (`task`, `project`, `workspace`, `view`, `dashboard`) to the current
 * `vertex-flow-`-prefixed spelling.
 *
 * Runs once after every index rebuild (see `main.ts`). Self-terminating and
 * cheap to leave wired up: once a note is rewritten the serializers keep it
 * prefixed, so every rebuild after the first finds nothing to do and writes
 * nothing. No settings flag guards it — the per-note check already makes a
 * repeat run a no-op.
 *
 * Reading old-format notes is safe indefinitely without this (parsers and
 * `entityKindOf` both accept the bare values); this exists so the vault
 * actually converges rather than tolerating the old form forever.
 */

import { legacyEntityTypeRewrite } from "../core/entity-type";
import type { VaultIndex } from "./index-store";
import { WORKSPACE_NOTE } from "./index-store";
import type { NoteIO } from "./note-io";
import { joinPath } from "../core/links";

/** How many notes to rewrite concurrently, to avoid a long synchronous stall on
 *  a large vault's first migrating rebuild. */
const BATCH_SIZE = 20;

/**
 * Every entity note the index currently knows about — live Tasks/Projects/
 * Views/Dashboards, their trashed counterparts, and each workspace's
 * `_workspace.md`. Deleted workspaces are included so their contents converge
 * too.
 */
function entityNotePaths(index: VaultIndex): string[] {
	const paths = new Set<string>();
	for (const snapshot of index.list({ includeDeleted: true })) {
		paths.add(joinPath(snapshot.workspace.root, WORKSPACE_NOTE));
		for (const task of snapshot.tasks) paths.add(task.path);
		for (const project of snapshot.projects) paths.add(project.path);
		for (const view of snapshot.views) {
			// System Views are synthetic — they have no file until saved.
			if (view.path) paths.add(view.path);
		}
		for (const dashboard of snapshot.dashboards) {
			if (dashboard.path) paths.add(dashboard.path);
		}
		for (const item of snapshot.trash) paths.add(item.entity.path);
	}
	return [...paths];
}

/**
 * Rewrite every stale bare `type:` value found among the index's entity notes.
 * Returns the number of notes rewritten (0 once the vault has converged).
 */
export async function migrateEntityTypes(
	index: VaultIndex,
	io: NoteIO,
): Promise<number> {
	const stale: { file: NonNullable<ReturnType<NoteIO["getFile"]>>; to: string }[] =
		[];

	for (const path of entityNotePaths(index)) {
		const file = io.getFile(path);
		if (!file) continue;
		// Cache-only read — Obsidian has already parsed this frontmatter.
		const to = legacyEntityTypeRewrite(io.readFrontmatter(file)?.type);
		if (to) stale.push({ file, to });
	}

	for (let i = 0; i < stale.length; i += BATCH_SIZE) {
		await Promise.all(
			stale.slice(i, i + BATCH_SIZE).map(({ file, to }) =>
				io.updateFrontmatter(file, (fm) => {
					// Re-check inside the locked read-modify-write: a normal save
					// on this note between the scan and here may already have
					// done it.
					if (legacyEntityTypeRewrite(fm.type)) fm.type = to;
				}),
			),
		);
	}

	return stale.length;
}
