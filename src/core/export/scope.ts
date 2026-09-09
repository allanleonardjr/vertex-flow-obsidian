/**
 * Export scope: which tasks an export covers.
 *
 * Deliberately doesn't special-case the current view versus a saved view — both
 * are just "a resolved `SavedView`, evaluate it". The UI layer decides which
 * view that is (on-disk, a live unsaved draft, or a synthesized
 * label/project/person view).
 */

import { sortTasksByRank } from "../ranking";
import type {
	IsoDate,
	Project,
	SavedView,
	Task,
	WorkspaceSnapshot,
} from "../types";
import { evaluateView, type ViewContext } from "../views";

export type ExportScope =
	| { kind: "view"; view: SavedView }
	| { kind: "project"; project: Project }
	| { kind: "workspace" };

export interface ScopeResult {
	tasks: Task[];
	/** A human label for the scope, used in the export filename and JSON meta. */
	scopeLabel: string;
}

export function resolveScopeTasks(
	snapshot: WorkspaceSnapshot,
	scope: ExportScope,
	context: ViewContext,
	today: IsoDate,
	opts: { includeArchived: boolean },
): ScopeResult {
	let tasks: Task[];
	let scopeLabel: string;

	switch (scope.kind) {
		case "view": {
			tasks = evaluateView(snapshot, scope.view, context, today).tasks;
			scopeLabel = scope.view.name;
			break;
		}
		case "project": {
			tasks = sortTasksByRank(
				snapshot.tasks.filter((task) => task.project === scope.project.path),
			);
			scopeLabel = scope.project.title;
			break;
		}
		case "workspace": {
			// Trashed items are parsed into `snapshot.trash`, never `snapshot.tasks`
			// (see `index-store.ts`), so they're already excluded here.
			tasks = sortTasksByRank(snapshot.tasks);
			scopeLabel = "Whole workspace";
			break;
		}
	}

	// Projected recurrence ghosts are a presentation layer, never real notes.
	tasks = tasks.filter((task) => !task.projected);
	tasks = tasks.filter((task) => opts.includeArchived || !task.archived);

	return { tasks, scopeLabel };
}
