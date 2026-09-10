/**
 * Post-rebuild migration: backfill `completedAt` for tasks that were already in
 * a `"completed"`-category status before the field shipped.
 *
 * Best-guess only — `completedAt` is set to the task's `updatedAt`, since the
 * real completion moment wasn't recorded at the time. Going forward
 * `Mutations.updateTask` stamps it precisely on the status change.
 *
 * Runs once after every index rebuild (see `main.ts`), in the same spirit as
 * `migrateEntityTypes`: self-terminating and cheap to leave wired up. A task
 * that already carries a non-null `completedAt` (whether stamped live or
 * backfilled on an earlier pass) is skipped, so every rebuild after the vault
 * converges writes nothing.
 */

import { isCompleted, workspaceTaxonomies } from "../core/taxonomy";
import type { VaultIndex } from "./index-store";
import type { NoteIO } from "./note-io";

/** How many notes to write concurrently, to avoid a long synchronous stall on
 *  a large vault's first migrating rebuild. */
const BATCH_SIZE = 20;

/**
 * Backfill `completedAt` on every already-completed live task that lacks it.
 * Returns the number of tasks backfilled (0 once the vault has converged).
 */
export async function migrateCompletedAt(
	index: VaultIndex,
	io: NoteIO,
): Promise<number> {
	const pending: {
		file: NonNullable<ReturnType<NoteIO["getFile"]>>;
		completedAt: string;
	}[] = [];

	for (const snapshot of index.list()) {
		const statusTaxonomy = workspaceTaxonomies(snapshot.workspace).status;
		for (const task of snapshot.tasks) {
			if (task.completedAt != null) continue;
			if (!isCompleted(statusTaxonomy, task.status)) continue;
			const file = io.getFile(task.path);
			if (!file) continue;
			pending.push({ file, completedAt: task.updatedAt });
		}
	}

	for (let i = 0; i < pending.length; i += BATCH_SIZE) {
		await Promise.all(
			pending.slice(i, i + BATCH_SIZE).map(({ file, completedAt }) =>
				io.updateFrontmatter(file, (fm) => {
					// Re-check inside the locked read-modify-write: a live status
					// change or an earlier batch entry may already have stamped it.
					if (fm.completedAt == null) fm.completedAt = completedAt;
				}),
			),
		);
	}

	return pending.length;
}
