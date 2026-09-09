/**
 * Everything the query layer needs to turn names into stored ids and back.
 *
 * Deliberately *not* `ViewContext`: that carries one flat optional path→title
 * map that points the wrong way for name→id resolution and has no task list (so
 * `parent:` couldn't resolve). This shape is built for lookup in both directions.
 */

import type {
	LinkTarget,
	Person,
	WorkspaceConfig,
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

export function queryContext(
	snapshot: WorkspaceSnapshot,
	me: string | null = null,
): QueryContext {
	return {
		...workspaceQueryContext(snapshot.workspace, me),
		projects: snapshot.projects.map((p) => ({ path: p.path, title: p.title })),
		tasks: snapshot.tasks.map((t) => ({ path: t.path, title: t.id })),
	};
}

/**
 * A context built from a workspace's config alone — taxonomies and people, with
 * empty project/task lists. Enough for the serialization layer: `printQuery`
 * quotes an unresolved project path and `resolveValue` keeps an unresolved
 * project/task value verbatim, so a view/dashboard `query:` round-trips exactly
 * without the full snapshot. Used by the index's one-time format migrations,
 * which run before the snapshot's entity lists are populated.
 */
/**
 * A context with nothing to resolve against — empty taxonomies, no people, no
 * entities. The serialization layer's fallback when a caller has no workspace
 * handy: every taxonomy id, project path and person id then round-trips
 * verbatim, which is exactly what a format migration needs.
 */
export function emptyQueryContext(): QueryContext {
	return workspaceQueryContext({
		statuses: [],
		priorities: [],
		taskTypes: [],
		labels: [],
		people: [],
	} as unknown as WorkspaceConfig);
}

export function workspaceQueryContext(
	workspace: WorkspaceConfig,
	me: string | null = null,
): QueryContext {
	const self = me
		? workspace.people.find((p) => p.id === me) ?? null
		: null;
	return {
		taxonomies: workspaceTaxonomies(workspace),
		people: workspace.people,
		// Computed here rather than imported from `core/views`, so the query and
		// view modules stay independent of one another.
		selfId: self?.id ?? null,
		projects: [],
		tasks: [],
	};
}
