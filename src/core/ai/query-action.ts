/**
 * The boundary between untrusted model output and the real Saved-View
 * filtering engine (`applyFilters` from `../views/filter`) — one engine, two
 * consumers, no parallel filter vocabulary invented for AI Chat.
 *
 * The model is only ever shown *display* names and titles (task type "Bug",
 * not the internal id `"bug"`; a project's title, not its vault path) — see
 * `buildTaxonomyLegend`/`buildPeopleRoster`/`flattenTasks` in `./snapshot.ts`.
 * So every filter value it supplies has to be resolved back to the id/path
 * `applyFilters` actually matches against before it can be trusted with a
 * real query. `parseQueryAction` only checks *shape* (never touches the
 * workspace); `executeQueryAction` is where names get resolved to real ids,
 * against this workspace's actual configured values, before anything is
 * matched.
 */

import { findValueByName, hasValue, type Taxonomy } from "../taxonomy/engine";
import { applyFilters, FILTER_ARRAY_FIELDS } from "../views/filter";
import type { ViewContext } from "../views/context";
import {
	NONE,
	SELF,
	type IsoDate,
	type Person,
	type Project,
	type Task,
	type ViewFilters,
	type WorkspaceSnapshot,
} from "../types";
import { flattenTasks, isOverdueTask, summarizeTasks } from "./snapshot";

export interface TaskQueryAction {
	action: "searchTasks" | "countTasks";
	/**
	 * `overdue` is derived state (dueDate + status category + "today"), not a
	 * stored field — there's no `ViewFilters` equivalent, so it's handled
	 * separately from the pass-through `ViewFilters` keys in
	 * `executeQueryAction` rather than being smuggled into `ViewFilters` itself
	 * (non-goal: don't touch `ViewFilters`/`applyFilters`).
	 */
	filters: Partial<ViewFilters> & { overdue?: boolean };
}

/** Matches `filter.ts`'s own boolean/string-scalar filter keys. */
const NON_ARRAY_FILTER_KEYS = [
	"text",
	"archived",
	"openOnly",
	"unscheduled",
	"recurring",
] as const;

/** Boolean-typed like the flags above, but action-only — see `TaskQueryAction.filters`'s doc comment. */
const BOOLEAN_ACTION_ONLY_KEYS = ["overdue"] as const;

const BOOLEAN_FILTER_KEYS = new Set<string>(["openOnly", "unscheduled", "recurring", "overdue"]);

const RECOGNIZED_FILTER_KEYS = new Set<string>([
	...FILTER_ARRAY_FIELDS,
	...NON_ARRAY_FILTER_KEYS,
	...BOOLEAN_ACTION_ONLY_KEYS,
]);

const ARRAY_FILTER_KEY_SET = new Set<string>(FILTER_ARRAY_FIELDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The largest `{...}` substring in the text — tolerates a model that wraps its JSON in prose or a code fence. */
function extractJsonCandidate(text: string): string | null {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) return null;
	return text.slice(start, end + 1);
}

/**
 * A looser check than `parseQueryAction`: does this response even look like
 * an attempted action (valid JSON naming one of the two actions), regardless
 * of whether its `filters` actually validate? Lets the caller distinguish an
 * attempted-but-malformed query (worth one corrective retry) from a plain
 * answer that was never an action to begin with (shown to the user as-is).
 */
export function looksLikeQueryAction(response: string): boolean {
	const candidate = extractJsonCandidate(response.trim());
	if (!candidate) return false;

	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch {
		return false;
	}

	return (
		isPlainObject(parsed) && (parsed.action === "searchTasks" || parsed.action === "countTasks")
	);
}

/**
 * Structural validation only: is this JSON, does `action` name one of the two
 * known actions, and does `filters` hold only recognized `ViewFilters` keys
 * with the right JS type for each (array keys must be string arrays; boolean
 * keys must be booleans; `text`/`archived` must be strings)? Never resolves a
 * value against the workspace — that's `executeQueryAction`'s job, once this
 * has confirmed the shape is safe to look at.
 */
export function parseQueryAction(response: string): TaskQueryAction | null {
	const candidate = extractJsonCandidate(response.trim());
	if (!candidate) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch {
		return null;
	}

	if (!isPlainObject(parsed)) return null;
	if (parsed.action !== "searchTasks" && parsed.action !== "countTasks") return null;
	if (!isPlainObject(parsed.filters)) return null;

	for (const [key, value] of Object.entries(parsed.filters)) {
		if (!RECOGNIZED_FILTER_KEYS.has(key)) return null;

		if (ARRAY_FILTER_KEY_SET.has(key)) {
			if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
				return null;
			}
		} else if (key === "archived") {
			if (value !== "included" && value !== "only") return null;
		} else if (key === "text") {
			if (typeof value !== "string") return null;
		} else if (BOOLEAN_FILTER_KEYS.has(key)) {
			// openOnly | unscheduled | recurring | overdue
			if (typeof value !== "boolean") return null;
		}
	}

	return {
		action: parsed.action,
		filters: parsed.filters as Partial<ViewFilters> & { overdue?: boolean },
	};
}

/** An id if already one, else the id of the taxonomy value with this display name — dropped if neither matches. */
function resolveTaxonomyValues(taxonomy: Taxonomy, values: string[] | undefined): string[] | undefined {
	if (!values) return undefined;
	const resolved = values
		.map((value) => (hasValue(taxonomy, value) ? value : (findValueByName(taxonomy, value)?.id ?? null)))
		.filter((id): id is string => id != null);
	return resolved.length > 0 ? resolved : undefined;
}

/** Same idea as `resolveTaxonomyValues`, for the People roster — preserves the `self`/`__none__` sentinels untouched. */
function resolvePersonValues(people: Person[], values: string[] | undefined): string[] | undefined {
	if (!values) return undefined;
	const resolved = values
		.map((value) => {
			if (value === SELF || value === NONE) return value;
			const byId = people.find((person) => person.id === value);
			if (byId) return byId.id;
			const needle = value.trim().toLowerCase();
			return people.find((person) => person.name.trim().toLowerCase() === needle)?.id ?? null;
		})
		.filter((id): id is string => id != null);
	return resolved.length > 0 ? resolved : undefined;
}

/** A vault path if already one, else the path of the project/task with this title/id — dropped if none match. */
function resolveEntityRefs(
	values: string[] | undefined,
	tasks: Task[],
	projects: Project[],
): string[] | undefined {
	if (!values) return undefined;
	const resolved = values
		.map((value) => {
			if (value === NONE) return value;
			if (tasks.some((task) => task.path === value) || projects.some((project) => project.path === value)) {
				return value;
			}
			const needle = value.trim().toLowerCase();
			const project = projects.find((candidate) => candidate.title.trim().toLowerCase() === needle);
			if (project) return project.path;
			const task = tasks.find(
				(candidate) =>
					candidate.id.toLowerCase() === needle || candidate.title.trim().toLowerCase() === needle,
			);
			return task?.path ?? null;
		})
		.filter((path): path is string => path != null);
	return resolved.length > 0 ? resolved : undefined;
}

/** Resolves every display name / title the model supplied into the real ids/paths `applyFilters` matches against. Deliberately typed to accept the action's `filters` including `overdue` — that key is simply ignored here, since it never becomes a `ViewFilters` field. */
function resolveFilterValues(
	filters: Partial<ViewFilters> & { overdue?: boolean },
	snapshot: WorkspaceSnapshot,
	context: ViewContext,
): ViewFilters {
	return {
		status: resolveTaxonomyValues(context.taxonomies.status, filters.status),
		priority: resolveTaxonomyValues(context.taxonomies.priority, filters.priority),
		taskType: resolveTaxonomyValues(context.taxonomies.taskType, filters.taskType),
		labels: resolveTaxonomyValues(context.taxonomies.label, filters.labels),
		assignee: resolvePersonValues(context.people, filters.assignee),
		mentions: resolvePersonValues(context.people, filters.mentions),
		project: resolveEntityRefs(filters.project, snapshot.tasks, snapshot.projects),
		parent: resolveEntityRefs(filters.parent, snapshot.tasks, snapshot.projects),
		text: filters.text,
		archived: filters.archived,
		openOnly: filters.openOnly,
		unscheduled: filters.unscheduled,
		recurring: filters.recurring,
	};
}

/** Rows returned for a `searchTasks` action beyond this are summarized as a count instead. */
const MAX_QUERY_RESULT_ROWS = 100;

/** Runs a validated query action against the real filtering engine and formats the result for the model to read. */
export function executeQueryAction(
	action: TaskQueryAction,
	snapshot: WorkspaceSnapshot,
	context: ViewContext,
	today: IsoDate = new Date().toISOString().slice(0, 10),
): string {
	const resolved = resolveFilterValues(action.filters, snapshot, context);
	let matched = applyFilters(snapshot.tasks, resolved, context);

	// Derived state, not a `ViewFilters` field (see `TaskQueryAction.filters`'s
	// doc comment) — applied as an additional AND'd predicate on top of
	// whatever `applyFilters` already matched, consistent with how every other
	// filter field combines.
	if (action.filters.overdue) {
		matched = matched.filter((task) => isOverdueTask(task, context.taxonomies.status, today));
	}

	if (action.action === "countTasks") {
		return `${matched.length} task(s) matched.`;
	}

	const capped = matched.slice(0, MAX_QUERY_RESULT_ROWS);
	const summaries = summarizeTasks(capped, snapshot, context.taxonomies);
	const note =
		matched.length > MAX_QUERY_RESULT_ROWS
			? `\n(showing the first ${MAX_QUERY_RESULT_ROWS} of ${matched.length} matches)`
			: "";
	return `${flattenTasks(summaries)}${note}`;
}
