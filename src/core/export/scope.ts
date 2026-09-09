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

/** A scope's kind and name, split apart from `scopeLabel` — used to build a
 *  filename's `-<kind>-<name>` segments, and by the Export dialog's locked-
 *  scope display. Label and Person scope are `{ kind: "view", view }` under
 *  the hood (synthesised by `labelView()`/`personView()` in `ui/App.tsx`), so
 *  they're recovered here via the `label:`/`person:` prefix those helpers
 *  stamp on the synthesised view's `id` — the one thing that distinguishes
 *  them from an ordinary saved view at this layer. */
export interface ScopeIdentity {
	kind: "workspace" | "project" | "view" | "label" | "person";
	/** `null` only for "workspace" — a workspace export has nothing beyond
	 *  the workspace itself to name, and it's already in the filename's
	 *  workspace segment. */
	name: string | null;
}

export function scopeIdentity(scope: ExportScope): ScopeIdentity {
	if (scope.kind === "workspace") return { kind: "workspace", name: null };
	if (scope.kind === "project") {
		return { kind: "project", name: scope.project.title };
	}
	if (scope.view.id.startsWith("label:")) {
		return { kind: "label", name: scope.view.name };
	}
	if (scope.view.id.startsWith("person:")) {
		return { kind: "person", name: scope.view.name };
	}
	return { kind: "view", name: scope.view.name };
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
