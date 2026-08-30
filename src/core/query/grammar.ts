/**
 * The query language's vocabulary — pure data, no logic.
 *
 * Every table here is keyed by a model type (`Record<ArrayFilterKey, …>`,
 * `Record<GroupByField, …>`) rather than written as a free-standing literal.
 * That makes them exhaustive: dropping a field from `ViewFilters` or a member
 * from `GroupByField` surfaces as a type error pointing at the exact entry to
 * delete, instead of leaving a silently-dead token behind.
 */

import type {
	EmptyColumnBehavior,
	GroupByField,
	SortField,
	SubtaskDisplay,
	TaskField,
	ViewType,
} from "../types";
import type { ArrayFilterKey } from "../views/filter";

/** What kind of thing a filter field's values name. */
export type ResolveAs =
	| "status"
	| "priority"
	| "taskType"
	| "label"
	| "person"
	| "project"
	| "task";

export interface FilterFieldSpec {
	/** The canonical token — what the printer emits. */
	token: string;
	/** Extra spellings accepted on input. */
	aliases: readonly string[];
	resolveAs: ResolveAs;
	/**
	 * `unset` parses everywhere it's syntactically legal, but for these fields
	 * it can never match — `Task.status` is non-nullable, and `matchesFilters`
	 * gives `mentions` no NONE branch. Parsed, then warned about.
	 */
	unsetIsVacuous: boolean;
}

export const FILTER_FIELDS: Record<ArrayFilterKey, FilterFieldSpec> = {
	status: {
		token: "status",
		aliases: ["state"],
		resolveAs: "status",
		unsetIsVacuous: true,
	},
	priority: {
		token: "priority",
		aliases: ["p"],
		resolveAs: "priority",
		unsetIsVacuous: false,
	},
	taskType: {
		token: "type",
		aliases: ["tasktype", "kind"],
		resolveAs: "taskType",
		unsetIsVacuous: false,
	},
	labels: {
		token: "label",
		aliases: ["labels", "tag", "tags"],
		resolveAs: "label",
		unsetIsVacuous: false,
	},
	assignee: {
		token: "assignee",
		aliases: ["assigned", "owner"],
		resolveAs: "person",
		unsetIsVacuous: false,
	},
	mentions: {
		token: "mentions",
		aliases: ["mention"],
		resolveAs: "person",
		unsetIsVacuous: true,
	},
	project: {
		token: "project",
		aliases: [],
		resolveAs: "project",
		unsetIsVacuous: false,
	},
	parent: {
		token: "parent",
		aliases: ["subtaskof"],
		resolveAs: "task",
		unsetIsVacuous: false,
	},
};

/** The free-text field. Not in `FILTER_FIELDS` — its value isn't a list. */
export const TEXT_FIELD = { token: "title", aliases: ["text", "search"] };

export interface EnumValueSpec {
	token: string;
	aliases: readonly string[];
}

export const GROUP_VALUES: Record<GroupByField, EnumValueSpec> = {
	none: { token: "none", aliases: [] },
	status: { token: "status", aliases: [] },
	priority: { token: "priority", aliases: [] },
	taskType: { token: "type", aliases: ["tasktype", "kind"] },
	assignee: { token: "assignee", aliases: ["owner"] },
	label: { token: "label", aliases: ["labels", "tag", "tags"] },
	project: { token: "project", aliases: [] },
};

export const SORT_VALUES: Record<SortField, EnumValueSpec> = {
	rank: { token: "rank", aliases: ["manual"] },
	priority: { token: "priority", aliases: [] },
	status: { token: "status", aliases: [] },
	title: { token: "title", aliases: ["name"] },
	dueDate: { token: "due", aliases: ["duedate"] },
	startDate: { token: "start", aliases: ["startdate"] },
	estimate: { token: "estimate", aliases: [] },
	createdAt: { token: "created", aliases: ["createdat"] },
	updatedAt: { token: "updated", aliases: ["updatedat"] },
};

export const LAYOUT_VALUES: Record<ViewType, EnumValueSpec> = {
	list: { token: "list", aliases: [] },
	board: { token: "board", aliases: ["kanban"] },
	timeline: { token: "timeline", aliases: ["gantt"] },
	calendar: { token: "calendar", aliases: ["cal"] },
};

/** Calendar-only: which date field the month grid buckets by (`date:` clause). */
export const DATE_FIELD_VALUES: Record<
	"dueDate" | "startDate",
	EnumValueSpec
> = {
	dueDate: { token: "due", aliases: ["duedate", "due-date"] },
	startDate: { token: "start", aliases: ["startdate", "start-date"] },
};

export const EMPTY_VALUES: Record<EmptyColumnBehavior, EnumValueSpec> = {
	"show-normal": { token: "show-normal", aliases: ["normal", "show"] },
	"auto-collapse": { token: "auto-collapse", aliases: ["collapse"] },
	"auto-hide": { token: "auto-hide", aliases: ["hide"] },
};

/** How the view treats sub-tasks (`subtasks:` clause). */
export const SUBTASK_VALUES: Record<SubtaskDisplay, EnumValueSpec> = {
	nested: { token: "nested", aliases: ["nest", "tree", "indent"] },
	flat: { token: "flat", aliases: ["show", "loose"] },
	hidden: { token: "hidden", aliases: ["hide", "top-level", "toplevel", "root"] },
};

/** Task fields the `hide:` clause can name. Keyed for exhaustiveness. */
export const FIELD_VALUES: Record<TaskField, EnumValueSpec> = {
	type: { token: "type", aliases: ["tasktype", "kind"] },
	project: { token: "project", aliases: ["proj"] },
	priority: { token: "priority", aliases: ["p"] },
	assignee: { token: "assignee", aliases: ["owner", "assigned"] },
	labels: { token: "labels", aliases: ["label", "tag", "tags"] },
	estimate: { token: "estimate", aliases: ["est", "points"] },
	startDate: { token: "start", aliases: ["startdate"] },
	dueDate: { token: "due", aliases: ["duedate"] },
	progress: { token: "progress", aliases: [] },
	relations: { token: "relations", aliases: ["rel", "relation"] },
};

/* ----------------------------------------------------------- keywords ----- */

/** Resolves to `SELF`. `self` is accepted because it's the literal stored value. */
export const SELF_KEYWORDS = ["me", "self"] as const;

/**
 * Resolves to `NONE`.
 *
 * `none` is deliberately **not** here: the default priorities include a real
 * value whose id is literally `"none"` ("No Priority"), so `priority:none` must
 * mean that value. Use `=unset` to filter on a taxonomy value actually named
 * "unset".
 */
export const UNSET_KEYWORDS = ["unset"] as const;

/** Prefix marking a value as verbatim — skip keyword and name resolution. */
export const VERBATIM_PREFIX = "=";

/* ------------------------------------------------------------- flags ------ */

export const FLAG_TOKENS = {
	archivedIncluded: { field: "show", value: "archived", aliases: [] },
	archivedOnly: { field: "show", value: "archived-only", aliases: [] },
	openOnly: { field: "is", value: "open", aliases: [] },
	unscheduled: { field: "is", value: "unscheduled", aliases: [] },
} as const;

/**
 * Legacy spellings of the removed `is:top-level` flag. Still parsed — they set
 * `subtaskDisplay: "hidden"` — so a query written before the tri-state existed
 * keeps working. The printer emits `subtasks:hidden` instead.
 */
export const LEGACY_TOP_LEVEL_VALUES = ["top-level", "toplevel", "root"] as const;

/** `include:archived` reads fine; accept it as a second spelling of `show:`. */
export const FLAG_FIELD_ALIASES: Record<string, string> = { include: "show" };

/**
 * Tokens that look reasonable but name a field `ViewFilters` doesn't have.
 * `is:` and `archived:` aren't real fields; archived visibility is the `show:`
 * flag (`show:archived` to mix archived tasks in, `show:archived-only` to filter
 * to just them). Rejected with a pointer rather than silently misinterpreted.
 */
export const NOT_EXPRESSIBLE: Record<
	string,
	{ message: string; suggestion?: string }
> = {
	"is:archived": {
		message: "Use show:archived-only to filter to just archived tasks.",
		suggestion: "show:archived-only",
	},
	"archived:true": {
		message: "Use show:archived-only to filter to just archived tasks.",
		suggestion: "show:archived-only",
	},
	"archived:only": {
		message: "Use show:archived-only to filter to just archived tasks.",
		suggestion: "show:archived-only",
	},
	"is:sub-task": {
		message: "Filtering to sub-tasks isn't expressible; filter by their parent instead",
		suggestion: "parent:",
	},
	"is:subtask": {
		message: "Filtering to sub-tasks isn't expressible; filter by their parent instead",
		suggestion: "parent:",
	},
};

/* -------------------------------------------------------- lookup tables --- */

function indexBy<T extends { token: string; aliases: readonly string[] }>(
	entries: [string, T][],
): Map<string, string> {
	const out = new Map<string, string>();
	for (const [key, spec] of entries) {
		out.set(spec.token.toLowerCase(), key);
		for (const alias of spec.aliases) out.set(alias.toLowerCase(), key);
	}
	return out;
}

/** Token (or alias) → `ViewFilters` key. Includes the text field. */
export const FILTER_FIELD_BY_TOKEN: Map<string, ArrayFilterKey | "text"> =
	(() => {
		const map = indexBy(
			Object.entries(FILTER_FIELDS) as [ArrayFilterKey, FilterFieldSpec][],
		) as Map<string, ArrayFilterKey | "text">;
		map.set(TEXT_FIELD.token, "text");
		for (const alias of TEXT_FIELD.aliases) map.set(alias, "text");
		return map;
	})();

export const GROUP_BY_TOKEN = indexBy(
	Object.entries(GROUP_VALUES) as [GroupByField, EnumValueSpec][],
) as Map<string, GroupByField>;

export const SORT_BY_TOKEN = indexBy(
	Object.entries(SORT_VALUES) as [SortField, EnumValueSpec][],
) as Map<string, SortField>;

export const LAYOUT_BY_TOKEN = indexBy(
	Object.entries(LAYOUT_VALUES) as [ViewType, EnumValueSpec][],
) as Map<string, ViewType>;

export const DATE_FIELD_BY_TOKEN = indexBy(
	Object.entries(DATE_FIELD_VALUES) as [
		"dueDate" | "startDate",
		EnumValueSpec,
	][],
) as Map<string, "dueDate" | "startDate">;

export const EMPTY_BY_TOKEN = indexBy(
	Object.entries(EMPTY_VALUES) as [EmptyColumnBehavior, EnumValueSpec][],
) as Map<string, EmptyColumnBehavior>;

export const SUBTASK_BY_TOKEN = indexBy(
	Object.entries(SUBTASK_VALUES) as [SubtaskDisplay, EnumValueSpec][],
) as Map<string, SubtaskDisplay>;

export const FIELD_BY_TOKEN = indexBy(
	Object.entries(FIELD_VALUES) as [TaskField, EnumValueSpec][],
) as Map<string, TaskField>;

/** Every field token the parser recognises — the pool for "did you mean…". */
export const ALL_FIELD_TOKENS: readonly string[] = [
	...FILTER_FIELD_BY_TOKEN.keys(),
	"group",
	"sort",
	"layout",
	"empty",
	"hide",
	"date",
	"subtasks",
	"is",
	"show",
	"include",
];
