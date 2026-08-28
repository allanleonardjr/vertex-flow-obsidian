/**
 * Everything the query layer needs to turn names into stored ids and back.
 *
 * Deliberately *not* `ViewContext`: that carries one flat optional path→title
 * map that can't tell a project from a cycle, points the wrong way for name→id
 * resolution, and has no task list (so `parent:` couldn't resolve). This shape
 * is built for lookup in both directions.
 */

import type {
	LinkTarget,
	Person,
	WorkspaceSnapshot,
} from "../types";
import { workspaceTaxonomies, type WorkspaceTaxonomies } from "../taxonomy";

export interface QueryEntity {
	/** The stored link target, e.g. `Projects/Core App Experience`. */
	path: LinkTarget;
	/** What a human would type. Tasks use their id, since that's what's memorable. */
	title: string;
}

export interface QueryContext {
	taxonomies: WorkspaceTaxonomies;
	people: Person[];
	selfId: string | null;
	projects: QueryEntity[];
	tasks: QueryEntity[];
}

export function queryContext(snapshot: WorkspaceSnapshot): QueryContext {
	return {
		taxonomies: workspaceTaxonomies(snapshot.workspace),
		people: snapshot.workspace.people,
		// Computed here rather than imported from `core/views`, so the query and
		// view modules stay independent of one another.
		selfId: snapshot.workspace.people.find((p) => p.isSelf)?.id ?? null,
		projects: snapshot.projects.map((p) => ({ path: p.path, title: p.title })),
		tasks: snapshot.tasks.map((t) => ({ path: t.path, title: t.id })),
	};
}
