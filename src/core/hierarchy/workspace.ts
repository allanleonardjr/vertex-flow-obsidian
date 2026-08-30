/**
 * Whole-workspace deletion — the relation cleanup it triggers elsewhere.
 *
 * Deleting a single Task tidies the relations that pointed at it (see
 * `danglingRelationEdits` in `./cascade`). Deleting an entire Workspace removes
 * every Task in it at once, so the same tidy-up has to run **vault-wide** —
 * a `blocks` / `blockedBy` / `related` / `duplicateOf` link living in *another*
 * workspace that points into the doomed one would otherwise be left dangling.
 *
 * This is still not hierarchy, so it stays silent — no prompt, same as the
 * single-task path.
 */

import type { LinkTarget, Task, WorkspaceSnapshot } from "../types";
import { danglingRelationEdits } from "./cascade";

/**
 * Relation-field edits to apply to tasks in *surviving* workspaces when the
 * workspace at `doomedRoot` is deleted.
 *
 * Builds one `HierarchyScope` spanning every workspace except the doomed one,
 * then reuses `danglingRelationEdits` with the doomed workspace's task paths as
 * the deleted set — so the matching rules are identical to the single-task
 * delete. Returns `[]` when `doomedRoot` names no known workspace.
 */
export function danglingRelationEditsForWorkspaceDeletion(
	workspaces: WorkspaceSnapshot[],
	doomedRoot: string,
): { path: LinkTarget; relations: Task["relations"] }[] {
	const doomed = workspaces.find((w) => w.workspace.root === doomedRoot);
	if (!doomed) return [];

	const survivors = workspaces.filter((w) => w.workspace.root !== doomedRoot);
	const scope = {
		tasks: survivors.flatMap((w) => w.tasks),
		projects: survivors.flatMap((w) => w.projects),
	};

	return danglingRelationEdits(
		scope,
		doomed.tasks.map((task) => task.path),
	);
}
