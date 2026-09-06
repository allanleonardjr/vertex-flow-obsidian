/**
 * Everything view evaluation needs to know that isn't the task list itself.
 */

import { workspaceTaxonomies, type WorkspaceTaxonomies } from "../taxonomy";
import type {
	LinkTarget,
	MeBinding,
	Person,
	WorkspaceConfig,
	WorkspaceSnapshot,
} from "../types";

export interface ViewContext {
	workspace: WorkspaceConfig;
	taxonomies: WorkspaceTaxonomies;
	/**
	 * The roster `Person.id` the plugin's app-level `mePerson` points at, or
	 * null when unset or not in this workspace. Resolving `self` filters is the
	 * whole mechanism behind "Assigned to Me" / "Mentions Me" — the substitute
	 * for a dedicated notification panel in v1.
	 */
	selfId: string | null;
	people: Person[];
	/**
	 * Path → title for projects, so grouping by project can show a name instead
	 * of a path. Absent when a caller builds a context from a bare config rather
	 * than a full snapshot.
	 */
	titles?: Map<LinkTarget, string>;
}

/** The roster person `mePerson` names, if this workspace has that id. */
export function selfPerson(
	workspace: WorkspaceConfig,
	me: MeBinding | null,
): Person | null {
	if (!me) return null;
	return workspace.people.find((person) => person.id === me.personId) ?? null;
}

export function viewContext(
	workspace: WorkspaceConfig,
	me: MeBinding | null = null,
): ViewContext {
	return {
		workspace,
		taxonomies: workspaceTaxonomies(workspace),
		selfId: selfPerson(workspace, me)?.id ?? null,
		people: workspace.people,
	};
}

/** The usual entry point: a context that can also name linked entities. */
export function snapshotContext(
	snapshot: WorkspaceSnapshot,
	me: MeBinding | null = null,
): ViewContext {
	const titles = new Map<LinkTarget, string>();
	for (const project of snapshot.projects) titles.set(project.path, project.title);

	return { ...viewContext(snapshot.workspace, me), titles };
}
