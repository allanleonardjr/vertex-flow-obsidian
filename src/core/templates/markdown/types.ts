/**
 * The intermediate representation a template `.md` file parses into.
 *
 * Deliberately *symbolic*: dates are still offset-or-absolute tokens rather
 * than resolved `IsoDate`s, and every cross-reference is still an anchor string
 * rather than a final `LinkTarget`. Nothing here needs a
 * `TemplateBuildContext` — that only arrives at resolve time, so a template can
 * be parsed once at module load and resolved many times against different
 * clocks and workspace roots.
 *
 * No Obsidian import (Golden Rule), and no dependency on the rest of the
 * template machinery — this file is plain data.
 */

import type {
	DashboardGroupingField,
	DashboardMetric,
	DashboardTemporalField,
	DashboardTimeBucket,
	GroupByField,
	SortDirection,
	SortField,
	ViewType,
} from "../../types";
import type { TemplateMeta, TemplateWorkspaceOverrides } from "../types";

/* ------------------------------------------------------------- errors ----- */

/**
 * Every hard failure in the grammar surfaces as one of these. Carries a line
 * number where the problem is locatable so a broken template fails the build
 * with a pointer rather than a stack trace.
 */
export class TemplateParseError extends Error {
	readonly line?: number;
	/** Set by the caller that knows which file this came from. */
	file?: string;

	constructor(message: string, line?: number) {
		super(message);
		this.name = "TemplateParseError";
		this.line = line;
	}

	/** `templates/foo.md:12 — message`, with whichever parts are known. */
	describe(): string {
		const where = [this.file, this.line !== undefined ? String(this.line) : null]
			.filter(Boolean)
			.join(":");
		return where ? `${where} — ${this.message}` : this.message;
	}
}

/* -------------------------------------------------------------- dates ----- */

/** `-30d` / `+6d` / `0d`, or an absolute ISO date/datetime. */
export type ParsedDate =
	| { kind: "relative"; days: number }
	| { kind: "absolute"; iso: string };

/* ---------------------------------------------------------- body nodes ---- */

export interface ParsedComment {
	/** A person name or alias, resolved against the template's `people`. */
	author: string;
	date: ParsedDate;
	body: string;
	line: number;
}

/** Fields a Project's field line may carry. All optional, all symbolic. */
export interface ParsedProject {
	title: string;
	anchor: string;
	line: number;
	status?: string;
	priority?: string;
	owner?: string;
	labels?: string[];
	start?: ParsedDate;
	due?: ParsedDate;
	created?: ParsedDate;
	updated?: ParsedDate;
	/** `true` with no date means "archived, at ctx.now". */
	archived?: ParsedDate | boolean;
	description?: string;
}

export interface ParsedTask {
	title: string;
	anchor: string;
	line: number;
	/** Heading depth (2 = top-level `##` under `# Tasks`). */
	depth: number;
	/** Anchor of the parent derived from heading nesting, if any. */
	headingParent: string | null;
	/** Explicit `parent:` field — always wins over `headingParent`. */
	parent?: string;
	/** Project title or anchor. Inherited from the nearest ancestor when absent. */
	project?: string;
	type?: string;
	status?: string;
	priority?: string;
	assignee?: string;
	estimate?: number;
	labels?: string[];
	start?: ParsedDate;
	due?: ParsedDate;
	created?: ParsedDate;
	updated?: ParsedDate;
	archived?: ParsedDate | boolean;
	/** Anchors. `undefined` means the field was never declared — which is what
	 *  makes "declared on both sides and disagreeing" distinguishable from
	 *  "declared on one side only, synthesize the inverse". */
	blocks?: string[];
	blockedBy?: string[];
	related?: string[];
	duplicateOf?: string;
	description?: string;
	comments: ParsedComment[];
}

/* -------------------------------------------------------------- views ----- */

export interface ParsedView {
	name: string;
	icon?: string;
	description?: string;
	/** Structured shorthand — ignored entirely when `query` is present. */
	viewType?: ViewType;
	groupBy?: GroupByField;
	sortBy?: SortField;
	sortDirection?: SortDirection;
	/** Text query. Takes precedence over every structured field above. */
	query?: string;
	line: number;
}

/* --------------------------------------------------------- dashboards ---- */

export interface ParsedWidget {
	chartType: "bar" | "pie" | "line" | "timeline" | "kpi";
	title: string;
	/** bar/pie: required. line/timeline: optional secondary split. */
	groupBy?: DashboardGroupingField;
	/** line/timeline. */
	xField?: DashboardTemporalField;
	bucket?: DashboardTimeBucket;
	/** kpi. */
	metric?: DashboardMetric;
	/** kpi — `value` is a name, resolved like every other reference. */
	scope?: { field: DashboardGroupingField; value: string };
	/** Row-layout share. Ignored by the flat `widgets` form. */
	weight?: number;
	line: number;
}

export interface ParsedDashboard {
	name: string;
	icon?: string;
	description?: string;
	/** A filter-only query string, run through `parseQuery` at resolve time. */
	filter?: string;
	/** Widgets grouped into explicit rows. The flat `widgets:` form is
	 *  normalised into this at parse time (two per row), so the resolver only
	 *  ever sees rows. */
	rows: ParsedWidget[][];
	line: number;
}

/* ----------------------------------------------------------- template ----- */

export interface ParsedTemplate {
	meta: TemplateMeta;
	workspaceOverrides: TemplateWorkspaceOverrides;
	views: ParsedView[];
	dashboards: ParsedDashboard[];
	projects: ParsedProject[];
	tasks: ParsedTask[];
	/** Non-fatal notes (e.g. nesting deeper than markdown can express). */
	warnings: string[];
}
