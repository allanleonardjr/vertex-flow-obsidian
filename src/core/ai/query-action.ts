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
import { estimateTokens, flattenTasks, isOverdueTask, summarizeTasks } from "./snapshot";

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
 * Looser still than `looksLikeQueryAction`: does this response contain a
 * `{...}` substring that's valid JSON and a plain object, regardless of what
 * keys it has? A model can emit JSON that isn't even shaped like an attempted
 * `searchTasks`/`countTasks` call at all (e.g. `{"labels": ["Community/Discord"]}`,
 * naming neither action) — `looksLikeQueryAction`'s own `action` check misses
 * that entirely, so it falls through to being shown as raw text. This is the
 * catch-all: any JSON-shaped output that isn't valid prose should go through
 * the corrective retry, never straight to the user.
 */
export function looksLikeJsonAttempt(response: string): boolean {
	const candidate = extractJsonCandidate(response.trim());
	if (!candidate) return false;

	try {
		return isPlainObject(JSON.parse(candidate));
	} catch {
		return false;
	}
}

/**
 * The broadest of the three checks, and deliberately doesn't require
 * `JSON.parse` to succeed at all — `looksLikeJsonAttempt` still needs the
 * response to parse as valid JSON, but a garbled or concatenated attempt
 * (e.g. two action objects run together — `{"action":"countTasks",...}>{"action":"searchTasks",...}`,
 * not valid JSON as a whole string) fails that too and falls through to being
 * shown raw. This only asks whether the response *looks like* it was reaching
 * for structured output at all: starts with `{`, or contains the literal
 * substring `"action"` anywhere. Ordinary prose essentially never does
 * either, so this stays safe against false positives while catching
 * well-formed, malformed, and garbled/concatenated attempts alike — anything
 * this catches should route to the same corrective retry/fallback as a
 * parseable-but-invalid attempt, never straight to the user.
 */
export function looksLikeAttemptedAction(response: string): boolean {
	const trimmed = response.trim();
	return trimmed.startsWith("{") || trimmed.includes('"action"');
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

/**
 * Hard ceiling on `searchTasks` rows regardless of how much budget is
 * available — a sane sanity bound (nobody needs literally thousands of rows
 * formatted into one message) that the adaptive check in `executeQueryAction`
 * below then narrows further, never widens, to fit whatever budget it's
 * actually given.
 */
const MAX_QUERY_RESULT_ROWS = 100;

export interface QueryActionResult {
	/** Formatted for the model's second call — unchanged by this having grown a `tasks` field alongside it. */
	text: string;
	/**
	 * The real matched `Task` objects behind `text`, capped the same way — only
	 * set for a resolved `searchTasks` action (never `countTasks`, which has no
	 * rows to hand back). Lets a caller (AI Chat's rendering) show an actual
	 * task list next to the model's prose without re-running the query, while
	 * the text sent to the model stays exactly what it already was.
	 */
	tasks?: Task[];
	/**
	 * How many tasks matched in total, before any truncation — only set for
	 * `searchTasks`. Paired with `query` below so a caller can re-run the same
	 * match set later with a larger row count ("Load more" in the rendered
	 * task list) without asking the model again; `tasks.length` alone can't
	 * tell you whether there's more to load.
	 */
	totalMatches?: number;
	/**
	 * The resolved `ViewFilters` (display names already turned into real
	 * ids/paths) plus the `overdue` post-filter flag behind this result —
	 * everything needed to call `applyFilters` again with a larger row count
	 * and reproduce the exact same match set, client-side, no model call
	 * involved. Metadata about how the answer was produced, not user-facing
	 * content — never sent back to the model on a later turn.
	 */
	query?: { filters: ViewFilters; overdue: boolean };
}

/**
 * Runs a validated query action against the real filtering engine and
 * formats the result for the model to read.
 *
 * `availableTokens` bounds how much of the matched `searchTasks` result
 * actually gets formatted: an unfiltered query against a large workspace can
 * produce a flat-capped row count whose formatted text alone blows a smaller
 * model's context window, well before the conversation itself gets anywhere
 * near long — the same class of failure the old full-snapshot design had,
 * fixed the same way (progressively halving the row count until the
 * formatted text fits, same technique, applied to a query result instead of
 * the whole snapshot). Defaults to unlimited so every existing caller
 * (including the full test suite) keeps today's flat-cap-only behavior
 * unless it explicitly opts into a real budget — `AiChatView.tsx`'s `runTurn`
 * is the one caller that does, passing the same remaining-budget figure the
 * context-usage meter computes.
 */
export function executeQueryAction(
	action: TaskQueryAction,
	snapshot: WorkspaceSnapshot,
	context: ViewContext,
	today: IsoDate = new Date().toISOString().slice(0, 10),
	availableTokens: number = Number.POSITIVE_INFINITY,
): QueryActionResult {
	const resolved = resolveFilterValues(action.filters, snapshot, context);
	let matched = applyFilters(snapshot.tasks, resolved, context);

	// Derived state, not a `ViewFilters` field (see `TaskQueryAction.filters`'s
	// doc comment) — applied as an additional AND'd predicate on top of
	// whatever `applyFilters` already matched, consistent with how every other
	// filter field combines.
	const overdue = Boolean(action.filters.overdue);
	if (overdue) {
		matched = matched.filter((task) => isOverdueTask(task, context.taxonomies.status, today));
	}

	// `countTasks` is inherently bounded — a plain sentence naming a number,
	// never per-row content — so it needs no budget check of its own; the
	// adaptive truncation below is `searchTasks`-only by construction.
	if (action.action === "countTasks") {
		return { text: `${matched.length} task(s) matched.` };
	}

	const totalMatches = matched.length;
	const query = { filters: resolved, overdue };

	if (totalMatches === 0) {
		return { text: flattenTasks([]), tasks: [], totalMatches, query };
	}

	// Halve the row count until the formatted text fits the budget, or there's
	// only one row left to show — always show at least one matching task
	// rather than none, even in the pathological case of a budget too small
	// for even that; the note below still makes clear the list is partial.
	let rowCount = Math.min(totalMatches, MAX_QUERY_RESULT_ROWS);
	let capped: Task[];
	let formatted: string;
	// The truncation note itself costs a few tokens too — checked together with
	// the formatted table on every iteration (not the table alone), or a
	// borderline case could still land a hair over `availableTokens` once the
	// note is appended.
	let note = "";
	for (;;) {
		capped = matched.slice(0, rowCount);
		formatted = flattenTasks(summarizeTasks(capped, snapshot, context.taxonomies));
		note =
			rowCount < totalMatches
				? `\n(showing ${rowCount} of ${totalMatches} matching tasks — add a filter to narrow this down)`
				: "";
		if (estimateTokens(formatted + note) <= availableTokens || rowCount <= 1) break;
		rowCount = Math.max(1, Math.floor(rowCount / 2));
	}

	return { text: `${formatted}${note}`, tasks: capped, totalMatches, query };
}
