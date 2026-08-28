/**
 * The query language's vocabulary — pure data, no logic.
 *
 * Every table here is keyed by a model type (`Record<ArrayFilterKey, …>`,
 * `Record<GroupByField, …>`) rather than written as a free-standing literal.
 * That makes them exhaustive: dropping a field from `ViewFilters` or a member
 * from `GroupByField` surfaces as a type error pointing at the exact entry to
 * delete, instead of leaving a silently-dead token behind.
 *
 * `advertise: false` marks a token that still parses and prints — so a view
 * already carrying it round-trips losslessly — but is kept out of autocomplete
 * and docs. Initiatives and Cycles are on their way out of the product; this is
 * how they stay representable until the types themselves go.
 */

import type {
	EmptyColumnBehavior,
	GroupByField,
	SortField,
	ViewType,
} from "../types";
import type { ArrayFilterKey } from "../views/filter";

/**
 * What kind of thing a filter field's values name.
 *
 * `"opaque"` means "normalise the link and otherwise store it verbatim" — no
 * name lookup, because there's no entity list to look in. It's what the
 * retained Initiative/Cycle fields use, and it still round-trips exactly.
 */
export type ResolveAs =
	| "status"
	| "priority"
	| "taskType"
	| "label"
	| "person"
	| "project"
	| "task"
	| "opaque";

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
	advertise: boolean;
}

export const FILTER_FIELDS: Record<ArrayFilterKey, FilterFieldSpec> = {
	status: {
		token: "status",
		aliases: ["state"],
		resolveAs: "status",
		unsetIsVacuous: true,
		advertise: true,
	},
	priority: {
		token: "priority",
		aliases: ["p"],
		resolveAs: "priority",
		unsetIsVacuous: false,
		advertise: true,
	},
	taskType: {
		token: "type",
		aliases: ["tasktype", "kind"],
		resolveAs: "taskType",
		unsetIsVacuous: false,
		advertise: true,
	},
	labels: {
		token: "label",
		aliases: ["labels", "tag", "tags"],
		resolveAs: "label",
		unsetIsVacuous: false,
		advertise: true,
	},
	assignee: {
		token: "assignee",
		aliases: ["assigned", "owner"],
		resolveAs: "person",
		unsetIsVacuous: false,
		advertise: true,
	},
	mentions: {
		token: "mentions",
		aliases: ["mention"],
		resolveAs: "person",
		unsetIsVacuous: true,
		advertise: true,
	},
	project: {
		token: "project",
		aliases: [],
		resolveAs: "project",
		unsetIsVacuous: false,
		advertise: true,
	},
	parent: {
		token: "parent",
		aliases: ["subtaskof"],
		resolveAs: "task",
		unsetIsVacuous: false,
		advertise: true,
	},
	// Retained for round-trip fidelity only — see the module comment.
	initiative: {
		token: "initiative",
		aliases: [],
		resolveAs: "opaque",
		unsetIsVacuous: false,
		advertise: false,
	},
	cycle: {
		token: "cycle",
		aliases: [],
		resolveAs: "opaque",
		unsetIsVacuous: false,
		advertise: false,
	},
};

/** The free-text field. Not in `FILTER_FIELDS` — its value isn't a list. */
export const TEXT_FIELD = { token: "title", aliases: ["text", "search"] };

export interface EnumValueSpec {
	token: string;
	aliases: readonly string[];
	advertise: boolean;
}

export const GROUP_VALUES: Record<GroupByField, EnumValueSpec> = {
	none: { token: "none", aliases: [], advertise: true },
	status: { token: "status", aliases: [], advertise: true },
	priority: { token: "priority", aliases: [], advertise: true },
	taskType: { token: "type", aliases: ["tasktype", "kind"], advertise: true },
	assignee: { token: "assignee", aliases: ["owner"], advertise: true },
	label: { token: "label", aliases: ["labels", "tag", "tags"], advertise: true },
	project: { token: "project", aliases: [], advertise: true },
	initiative: { token: "initiative", aliases: [], advertise: false },
	cycle: { token: "cycle", aliases: [], advertise: false },
};

export const SORT_VALUES: Record<SortField, EnumValueSpec> = {
	rank: { token: "rank", aliases: ["manual"], advertise: true },
	priority: { token: "priority", aliases: [], advertise: true },
	status: { token: "status", aliases: [], advertise: true },
	title: { token: "title", aliases: ["name"], advertise: true },
	dueDate: { token: "due", aliases: ["duedate"], advertise: true },
	startDate: { token: "start", aliases: ["startdate"], advertise: true },
	estimate: { token: "estimate", aliases: [], advertise: true },
	createdAt: { token: "created", aliases: ["createdat"], advertise: true },
	updatedAt: { token: "updated", aliases: ["updatedat"], advertise: true },
	cycleRank: { token: "cyclerank", aliases: [], advertise: false },
};

export const LAYOUT_VALUES: Record<ViewType, EnumValueSpec> = {
	list: { token: "list", aliases: [], advertise: true },
	board: { token: "board", aliases: ["kanban"], advertise: true },
};

export const EMPTY_VALUES: Record<EmptyColumnBehavior, EnumValueSpec> = {
	"show-normal": { token: "show-normal", aliases: ["normal", "show"], advertise: true },
	"auto-collapse": { token: "auto-collapse", aliases: ["collapse"], advertise: true },
	"auto-hide": { token: "auto-hide", aliases: ["hide"], advertise: true },
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
	topLevelOnly: { field: "is", value: "top-level", aliases: ["toplevel", "root"] },
	includeArchived: { field: "show", value: "archived", aliases: [] },
} as const;

/** `include:archived` reads fine; accept it as a second spelling of `show:`. */
export const FLAG_FIELD_ALIASES: Record<string, string> = { include: "show" };

/**
 * Tokens that look reasonable but name something `ViewFilters` cannot express.
 * Rejected with a pointer rather than silently misinterpreted — `includeArchived`
 * only *widens*, so accepting `is:archived` ("only archived") would be a footgun.
 */
export const NOT_EXPRESSIBLE: Record<
	string,
	{ message: string; suggestion?: string }
> = {
	"is:archived": {
		message: "Archived tasks can only be added to a view, not shown on their own",
		suggestion: "show:archived",
	},
	"archived:true": {
		message: "Archived tasks can only be added to a view, not shown on their own",
		suggestion: "show:archived",
	},
	"archived:only": {
		message: "Archived tasks can only be added to a view, not shown on their own",
		suggestion: "show:archived",
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

export const EMPTY_BY_TOKEN = indexBy(
	Object.entries(EMPTY_VALUES) as [EmptyColumnBehavior, EnumValueSpec][],
) as Map<string, EmptyColumnBehavior>;

/** Every field token the parser recognises — the pool for "did you mean…". */
export const ALL_FIELD_TOKENS: readonly string[] = [
	...FILTER_FIELD_BY_TOKEN.keys(),
	"group",
	"sort",
	"layout",
	"empty",
	"is",
	"show",
	"include",
];
