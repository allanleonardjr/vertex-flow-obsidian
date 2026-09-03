/**
 * Template markdown → `ParsedTemplate`.
 *
 * A pure function over a string: no filesystem, no Obsidian, no clock. That is
 * what lets the same parser serve both the build-time templates baked into
 * `generated.ts` and (later) user-authored templates discovered in a vault.
 *
 * The frontmatter is real YAML — nested objects, flow arrays, inline maps — so
 * it goes through the `yaml` package. The *body* deliberately does not: it is
 * scanned line by line here rather than handed to a CommonMark parser, because
 * the only thing this code needs to get right is where each block starts and
 * ends. Description and comment content is never rendered or re-parsed by the
 * plugin — it is stored verbatim — so a full markdown AST would be a large
 * dependency bought for nothing.
 *
 * The scanner tracks four things, and every hard error below comes from one of
 * them disagreeing with the grammar:
 *   - fenced code blocks, so a `#`, `>` or `:::` inside one is never structural
 *   - `:::description` / `:::comment` fences, opaque from open to close
 *   - heading depth, which builds the Project/Task tree
 *   - blockquote continuation across consecutive `>` lines
 */

import { parse as parseYaml } from "yaml";

import {
	DEFAULT_LABELS,
	DEFAULT_PRIORITIES,
	DEFAULT_STATUSES,
	DEFAULT_TASK_TYPES,
	TAXONOMY_PALETTE,
} from "../../taxonomy/defaults";
import {
	STATUS_CATEGORIES,
	type DashboardGroupingField,
	type DashboardMetric,
	type DashboardTemporalField,
	type DashboardTimeBucket,
	type GroupByField,
	type LabelValue,
	type Person,
	type PriorityValue,
	type SortField,
	type StatusCategory,
	type StatusValue,
	type TaskTypeValue,
	type ViewType,
} from "../../types";
import {
	plainSetting,
	settingsFromValues,
	type TemplateMeta,
	type TemplateSetting,
	type TemplateWorkspaceOverrides,
} from "../types";
import {
	TemplateParseError,
	type ParsedDashboard,
	type ParsedDate,
	type ParsedProject,
	type ParsedTask,
	type ParsedTemplate,
	type ParsedView,
	type ParsedWidget,
} from "./types";

/** The grammar version this parser implements (frontmatter `templateSchema`). */
export const TEMPLATE_SCHEMA_VERSION = 1;

function fail(message: string, line?: number): never {
	throw new TemplateParseError(message, line);
}

/* ------------------------------------------------------------ slugging ---- */

/** Bare slugify with no collision suffixing — callers detect collisions
 *  themselves so they can report *both* offending nodes, not silently rename. */
export function slugifyPlain(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "value"
	);
}

/**
 * A tolerant comparison key: lowercase, everything non-alphanumeric stripped.
 *
 * References in the body name taxonomy values by their display *name*, but
 * authors reach for the shape they see elsewhere in the app — `status: todo`
 * for a status named "To Do", `in-progress` for "In Progress". Matching on
 * name, then id, then this key means all three spellings land on the same
 * value without the format having to pick a winner.
 */

/* -------------------------------------------------------------- dates ----- */

const RELATIVE_DATE_RE = /^([+-]?\d+)d$/;

export function parseDateToken(raw: string, line: number): ParsedDate {
	const value = raw.trim();
	const relative = RELATIVE_DATE_RE.exec(value);
	if (relative) return { kind: "relative", days: Number.parseInt(relative[1], 10) };

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		fail(
			`Invalid date "${raw}" — expected a relative offset like "-30d" or an ISO date like "2026-08-26"`,
			line,
		);
	}
	return { kind: "absolute", iso: date.toISOString() };
}

/* ------------------------------------------------------ taxonomy shorthand */

/** `"Name (category, #hex)"` / `"Name (#hex)"` / `"Name"`. */
function splitShorthand(raw: string): { name: string; parts: string[] } {
	const match = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(raw.trim());
	if (!match) return { name: raw.trim(), parts: [] };
	return {
		name: match[1].trim(),
		parts: match[2]
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean),
	};
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Colour for a status that didn't name one — taken from its *category*, not its
 * position.
 *
 * Position is the wrong signal here: cycling the shared palette hands the first
 * status whatever colour happens to sit at index 0, so a template with six
 * statuses would paint "Backlog" alarm-red. Category is what the colour is
 * actually communicating, and every category already has a well-chosen default
 * in `DEFAULT_STATUSES`, so a status inherits the colour of the default status
 * sharing its category.
 */
function statusCategoryColor(category: StatusCategory): string {
	return (
		DEFAULT_STATUSES.find((s) => s.category === category)?.color ??
		TAXONOMY_PALETTE[0]
	);
}

/**
 * Colour for a non-status value that didn't name one. Deterministic by
 * position: the defaults are reused where a taxonomy has one of matching length
 * (so a four-priority template lands on the familiar default colours),
 * otherwise the shared palette cycles.
 */
function paletteColor(
	kind: "priority" | "taskType" | "label",
	index: number,
	total: number,
): string {
	if (kind === "priority" && total === DEFAULT_PRIORITIES.length) {
		return DEFAULT_PRIORITIES[index].color;
	}
	return TAXONOMY_PALETTE[index % TAXONOMY_PALETTE.length];
}

function assertUniqueIds(
	kind: string,
	values: { id: string; name: string }[],
): void {
	const seen = new Map<string, string>();
	for (const value of values) {
		const previous = seen.get(value.id);
		if (previous !== undefined) {
			fail(
				`Two ${kind} values share the id "${value.id}": "${previous}" and "${value.name}"`,
			);
		}
		seen.set(value.id, value.name);
	}
}

function asStringArray(raw: unknown, field: string): string[] | undefined {
	if (raw == null) return undefined;
	if (!Array.isArray(raw)) fail(`"${field}" must be a list`);
	return raw.map((entry, i) => {
		if (typeof entry !== "string") {
			fail(`"${field}[${i}]" must be a string like "Name (#hex)"`);
		}
		return entry;
	});
}

function parseStatuses(raw: unknown): StatusValue[] | undefined {
	const entries = asStringArray(raw, "statuses");
	if (!entries) return undefined;

	const values = entries.map((entry, index) => {
		const { name, parts } = splitShorthand(entry);
		if (!name) fail(`Status ${index + 1} has no name: "${entry}"`);

		const categoryRaw = parts.find((p) => !HEX_RE.test(p));
		if (!categoryRaw) {
			fail(
				`Status "${name}" needs a category — one of ${STATUS_CATEGORIES.join(", ")} — e.g. "${name} (started)"`,
			);
		}
		const category = STATUS_CATEGORIES.find(
			(c) => c === categoryRaw.toLowerCase(),
		);
		if (!category) {
			fail(
				`Status "${name}" has an unknown category "${categoryRaw}" — expected one of ${STATUS_CATEGORIES.join(", ")}`,
			);
		}

		const color = parts.find((p) => HEX_RE.test(p));
		return {
			id: slugifyPlain(name),
			name,
			color: color ?? statusCategoryColor(category),
			category,
			order: index + 1,
		};
	});

	assertUniqueIds("status", values);
	return values;
}

function parseFlatTaxonomy<T extends { id: string; name: string; color: string }>(
	raw: unknown,
	field: string,
	kind: "priority" | "taskType" | "label",
	withOrder: boolean,
): T[] | undefined {
	const entries = asStringArray(raw, field);
	if (!entries) return undefined;

	const values = entries.map((entry, index) => {
		const { name, parts } = splitShorthand(entry);
		if (!name) fail(`${field} entry ${index + 1} has no name: "${entry}"`);
		const color = parts.find((p) => HEX_RE.test(p));
		const unknown = parts.find((p) => !HEX_RE.test(p));
		if (unknown) {
			fail(
				`"${name}" in ${field} carries "(${unknown})" — only a #hex colour is allowed here`,
			);
		}
		const base = {
			id: slugifyPlain(name),
			name,
			color: color ?? paletteColor(kind, index, entries.length),
		};
		return (withOrder ? { ...base, order: index + 1 } : base) as T;
	});

	assertUniqueIds(kind, values);
	return values;
}

/** `"Name"`, `"Name*"`, `"Name (alias)"`, `"Name* (alias)"`. */
function parsePeople(raw: unknown): Person[] | undefined {
	const entries = asStringArray(raw, "people");
	if (!entries) return undefined;

	const people = entries.map((entry) => {
		const { name: head, parts } = splitShorthand(entry);
		const isSelf = head.endsWith("*");
		const name = (isSelf ? head.slice(0, -1) : head).trim();
		if (!name) fail(`A people entry has no name: "${entry}"`);
		const aliases = parts.filter(Boolean);
		return { id: slugifyPlain(name), name, aliases, isSelf };
	});

	const selves = people.filter((p) => p.isSelf);
	if (selves.length > 1) {
		fail(
			`Only one person may be marked "*" (isSelf); found ${selves.length}: ${selves
				.map((p) => p.name)
				.join(", ")}`,
		);
	}
	assertUniqueIds("people", people);
	return people;
}

/* --------------------------------------------------------- frontmatter ---- */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function requireString(
	data: Record<string, unknown>,
	key: string,
): string {
	const value = data[key];
	if (typeof value !== "string" || !value.trim()) {
		fail(`Frontmatter is missing the required "${key}" field`);
	}
	return value.trim();
}

function optionalString(
	data: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = data[key];
	if (value == null) return undefined;
	if (typeof value !== "string") fail(`"${key}" must be a string`);
	return value.trim() || undefined;
}

function optionalBoolean(
	data: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = data[key];
	if (value == null) return undefined;
	if (typeof value !== "boolean") fail(`"${key}" must be true or false`);
	return value;
}

/* --------------------------------------------------------------- views --- */

function enumOr<T extends string>(
	raw: unknown,
	allowed: readonly T[],
	field: string,
	line: number,
): T | undefined {
	if (raw == null) return undefined;
	if (typeof raw !== "string") fail(`"${field}" must be a string`, line);
	const match = allowed.find((a) => a.toLowerCase() === raw.trim().toLowerCase());
	if (!match) {
		fail(
			`"${field}: ${raw}" is not valid — expected one of ${allowed.join(", ")}`,
			line,
		);
	}
	return match;
}

const VIEW_TYPES: readonly ViewType[] = ["list", "board", "timeline", "calendar"];
const GROUP_FIELDS: readonly GroupByField[] = [
	"none",
	"status",
	"priority",
	"taskType",
	"assignee",
	"label",
	"project",
];
const SORT_FIELDS: readonly SortField[] = [
	"rank",
	"priority",
	"status",
	"title",
	"dueDate",
	"startDate",
	"estimate",
	"createdAt",
	"updatedAt",
];

/** The view/dashboard shorthand accepts the query language's friendlier
 *  spellings for a couple of fields, so `sortBy: due` reads naturally. */
const SORT_ALIASES: Record<string, SortField> = {
	due: "dueDate",
	duedate: "dueDate",
	start: "startDate",
	startdate: "startDate",
	created: "createdAt",
	createdat: "createdAt",
	updated: "updatedAt",
	updatedat: "updatedAt",
	name: "title",
	manual: "rank",
};

const GROUP_ALIASES: Record<string, GroupByField> = {
	type: "taskType",
	tasktype: "taskType",
	kind: "taskType",
	owner: "assignee",
	labels: "label",
	tag: "label",
	tags: "label",
};

function parseViews(raw: unknown): ParsedView[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) fail(`"views" must be a list`);

	return raw.map((entry, index) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			fail(`views[${index}] must be a map with at least a "name"`);
		}
		const data = entry as Record<string, unknown>;
		const name = requireString(data, "name");
		const line = 0;

		const rawSort = optionalString(data, "sortBy");
		const rawGroup = optionalString(data, "groupBy");

		return {
			name,
			icon: optionalString(data, "icon"),
			description: optionalString(data, "description"),
			viewType: enumOr(data.type ?? data.viewType, VIEW_TYPES, "type", line),
			groupBy: rawGroup
				? enumOr(
						GROUP_ALIASES[rawGroup.toLowerCase()] ?? rawGroup,
						GROUP_FIELDS,
						"groupBy",
						line,
					)
				: undefined,
			sortBy: rawSort
				? enumOr(
						SORT_ALIASES[rawSort.toLowerCase()] ?? rawSort,
						SORT_FIELDS,
						"sortBy",
						line,
					)
				: undefined,
			sortDirection: enumOr(
				data.sortDirection,
				["asc", "desc"] as const,
				"sortDirection",
				line,
			),
			query: optionalString(data, "query"),
			line,
		};
	});
}

/* ---------------------------------------------------------- dashboards ---- */

const CHART_TYPES = ["bar", "pie", "line", "timeline", "kpi"] as const;
const GROUPING_FIELDS: readonly DashboardGroupingField[] = [
	"status",
	"priority",
	"taskType",
	"label",
	"assignee",
	"project",
];
const TEMPORAL_FIELDS: readonly DashboardTemporalField[] = [
	"dueDate",
	"startDate",
	"createdAt",
];
const TIME_BUCKETS: readonly DashboardTimeBucket[] = ["day", "week", "month"];
const METRICS: readonly DashboardMetric[] = ["count", "estimateSum", "estimateAvg"];

function parseWidget(raw: unknown, where: string): ParsedWidget {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		fail(`${where} must be a map like {type: bar, title: ..., groupBy: status}`);
	}
	const data = raw as Record<string, unknown>;
	const line = 0;

	const chartType = enumOr(data.type ?? data.chartType, CHART_TYPES, "type", line);
	if (!chartType) fail(`${where} is missing "type"`);
	const title = requireString(data, "title");

	const groupBy = enumOr(data.groupBy, GROUPING_FIELDS, "groupBy", line);
	const widget: ParsedWidget = { chartType, title, line };

	if (chartType === "bar" || chartType === "pie") {
		if (!groupBy) fail(`${where} ("${title}") — a ${chartType} chart needs "groupBy"`);
		widget.groupBy = groupBy;
	} else if (chartType === "line" || chartType === "timeline") {
		const xField = enumOr(data.xField, TEMPORAL_FIELDS, "xField", line);
		if (!xField) {
			fail(
				`${where} ("${title}") — a ${chartType} chart needs "xField" (one of ${TEMPORAL_FIELDS.join(", ")})`,
			);
		}
		widget.xField = xField;
		widget.bucket = enumOr(data.bucket, TIME_BUCKETS, "bucket", line) ?? "week";
		widget.groupBy = groupBy;
	} else {
		const metric = enumOr(data.metric, METRICS, "metric", line);
		if (!metric) {
			fail(
				`${where} ("${title}") — a kpi widget needs "metric" (one of ${METRICS.join(", ")})`,
			);
		}
		widget.metric = metric;
		if (data.scope != null) {
			const scope = data.scope;
			if (typeof scope !== "object" || Array.isArray(scope)) {
				fail(`${where} ("${title}") — "scope" must be {field: ..., value: ...}`);
			}
			const scopeData = scope as Record<string, unknown>;
			const field = enumOr(scopeData.field, GROUPING_FIELDS, "scope.field", line);
			if (!field) fail(`${where} ("${title}") — "scope" needs a "field"`);
			widget.scope = { field, value: String(scopeData.value ?? "").trim() };
			if (!widget.scope.value) {
				fail(`${where} ("${title}") — "scope" needs a "value"`);
			}
		}
	}

	if (data.weight != null) {
		const weight = Number(data.weight);
		if (!Number.isFinite(weight) || weight <= 0) {
			fail(`${where} ("${title}") — "weight" must be a positive number`);
		}
		widget.weight = weight;
	}

	return widget;
}

/** The flat `widgets:` form packs two per row; a trailing single widget takes
 *  the whole row rather than sitting half-width next to nothing. */
function packPairs(widgets: ParsedWidget[]): ParsedWidget[][] {
	const rows: ParsedWidget[][] = [];
	for (let i = 0; i < widgets.length; i += 2) rows.push(widgets.slice(i, i + 2));
	return rows;
}

function parseDashboards(raw: unknown): ParsedDashboard[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) fail(`"dashboards" must be a list`);

	return raw.map((entry, index) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			fail(`dashboards[${index}] must be a map with at least a "name"`);
		}
		const data = entry as Record<string, unknown>;
		const name = requireString(data, "name");
		const where = `dashboards["${name}"]`;

		if (data.widgets != null && data.rows != null) {
			fail(
				`${where} declares both "widgets" and "rows" — use one or the other`,
			);
		}

		let rows: ParsedWidget[][];
		if (data.rows != null) {
			if (!Array.isArray(data.rows)) fail(`${where}.rows must be a list of rows`);
			rows = data.rows.map((row, r) => {
				if (!Array.isArray(row)) {
					fail(`${where}.rows[${r}] must be a list of widgets`);
				}
				return row.map((w, c) => parseWidget(w, `${where}.rows[${r}][${c}]`));
			});
		} else if (data.widgets != null) {
			if (!Array.isArray(data.widgets)) fail(`${where}.widgets must be a list`);
			rows = packPairs(
				data.widgets.map((w, i) => parseWidget(w, `${where}.widgets[${i}]`)),
			);
		} else {
			rows = [];
		}

		return {
			name,
			icon: optionalString(data, "icon"),
			description: optionalString(data, "description"),
			filter: optionalString(data, "filter"),
			rows,
			line: 0,
		};
	});
}

/* ------------------------------------------------------- body: field line - */

const PROJECT_FIELDS = new Set([
	"status",
	"priority",
	"owner",
	"start",
	"due",
	"created",
	"updated",
	"archived",
	"labels",
]);

const TASK_FIELDS = new Set([
	"project",
	"parent",
	"type",
	"status",
	"priority",
	"assignee",
	"estimate",
	"labels",
	"start",
	"due",
	"created",
	"updated",
	"archived",
	"blocks",
	"blockedby",
	"related",
	"duplicateof",
]);

/**
 * A line is the node's field line only if *every* pipe-separated segment is
 * `knownKey: value`. Anything else is prose — which is what keeps a description
 * whose first sentence happens to contain a colon from being eaten as fields.
 */
function readFieldLine(
	line: string,
	known: Set<string>,
): Map<string, string> | null {
	const segments = line.split("|");
	const fields = new Map<string, string>();

	for (const segment of segments) {
		const colon = segment.indexOf(":");
		if (colon === -1) return null;
		const key = segment.slice(0, colon).trim().toLowerCase();
		if (!/^[a-z]+$/.test(key) || !known.has(key)) return null;
		fields.set(key, segment.slice(colon + 1).trim());
	}

	return fields.size > 0 ? fields : null;
}

function readList(raw: string): string[] {
	const inner = /^\[(.*)\]$/s.exec(raw.trim());
	const body = inner ? inner[1] : raw;
	return body
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

function readArchived(raw: string, line: number): ParsedDate | boolean {
	const value = raw.trim().toLowerCase();
	if (value === "true") return true;
	if (value === "false" || value === "") return false;
	return parseDateToken(raw, line);
}

/* ----------------------------------------------------------- body scan ---- */

const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*(?:\{#([^}\s]+)\})?[ \t]*$/;

interface BodyResult {
	projects: ParsedProject[];
	tasks: ParsedTask[];
	warnings: string[];
}

function scanBody(body: string, firstLine: number): BodyResult {
	const lines = body.split(/\r?\n/);
	const projects: ParsedProject[] = [];
	const tasks: ParsedTask[] = [];
	const warnings: string[] = [];

	/** Line number in the whole file, for diagnostics. */
	const at = (i: number) => firstLine + i;

	let section: "projects" | "tasks" | null = null;
	/** The node the scanner is currently filling in. */
	let current: ParsedProject | ParsedTask | null = null;
	let currentIsTask = false;
	/** Whether the field line slot is still open (only the first non-blank
	 *  line under a heading may be one). */
	let fieldLineOpen = false;
	let descriptionLines: string[] = [];
	/** Set once a `:::description` fence has claimed the description, so stray
	 *  prose after it can't quietly append to it. */
	let descriptionFenced = false;
	/** Open task headings by depth, for default-parent resolution. */
	const taskStack: ParsedTask[] = [];

	function flushDescription(): void {
		if (!current || descriptionFenced) {
			descriptionLines = [];
			return;
		}
		const text = descriptionLines.join("\n").trim();
		if (text) current.description = text;
		descriptionLines = [];
	}

	function closeNode(): void {
		flushDescription();
		current = null;
		currentIsTask = false;
		fieldLineOpen = false;
		descriptionFenced = false;
	}

	let i = 0;
	let inCode = false;

	while (i < lines.length) {
		const raw = lines[i];
		const trimmed = raw.trim();

		// --- fenced code: opaque, and never structural -----------------------
		if (trimmed.startsWith("```")) {
			inCode = !inCode;
			if (current) descriptionLines.push(raw);
			i += 1;
			continue;
		}
		if (inCode) {
			if (current) descriptionLines.push(raw);
			i += 1;
			continue;
		}

		// --- ::: fences: opaque from open to matching close ------------------
		if (trimmed === ":::description" || trimmed.startsWith(":::comment")) {
			const isComment = trimmed.startsWith(":::comment");
			const openedAt = at(i);
			if (!current) {
				fail(
					`A ${isComment ? ":::comment" : ":::description"} fence must follow a Project or Task heading`,
					openedAt,
				);
			}

			const header = trimmed;
			const content: string[] = [];
			i += 1;
			let closed = false;
			while (i < lines.length) {
				if (lines[i].trim() === ":::") {
					closed = true;
					i += 1;
					break;
				}
				content.push(lines[i]);
				i += 1;
			}
			if (!closed) {
				fail(`Unclosed ${isComment ? ":::comment" : ":::description"} fence`, openedAt);
			}

			const text = content.join("\n").trim();
			if (isComment) {
				if (!currentIsTask) {
					fail(`Comments belong to Tasks, not Projects`, openedAt);
				}
				const meta = /^:::comment\s+(.*?)\s*\(([^)]*)\)\s*$/.exec(header);
				if (!meta) {
					fail(
						`Malformed comment fence — expected ":::comment Author (offset)"`,
						openedAt,
					);
				}
				(current as ParsedTask).comments.push({
					author: meta[1].trim(),
					date: parseDateToken(meta[2], openedAt),
					body: text,
					line: openedAt,
				});
			} else {
				if (current.description !== undefined || descriptionLines.length > 0) {
					flushDescription();
				}
				current.description = text;
				descriptionFenced = true;
			}
			fieldLineOpen = false;
			continue;
		}

		// --- headings ---------------------------------------------------------
		if (/^#{7,}[ \t]/.test(trimmed)) {
			warnings.push(
				`Line ${at(i)}: heading is deeper than H6, which markdown cannot express — treating it as text`,
			);
		}

		const heading = HEADING_RE.exec(raw);
		if (heading) {
			closeNode();
			const depth = heading[1].length;
			const title = heading[2].trim();
			const anchor = heading[3]?.trim();

			if (depth === 1) {
				const key = title.toLowerCase();
				if (key !== "projects" && key !== "tasks") {
					fail(
						`Unknown top-level section "# ${title}" — a template has exactly "# Projects" and "# Tasks"`,
						at(i),
					);
				}
				section = key;
				taskStack.length = 0;
				i += 1;
				continue;
			}

			if (section === null) {
				fail(
					`"${title}" appears before any "# Projects" or "# Tasks" section`,
					at(i),
				);
			}
			if (!title) fail(`Heading on line ${at(i)} has no title`, at(i));

			if (section === "projects") {
				if (depth !== 2) {
					fail(
						`"${title}" is an H${depth} under "# Projects", where every entry must be an H2 — use a :::description fence for headings inside a Project's overview`,
						at(i),
					);
				}
				const project: ParsedProject = {
					title,
					anchor: anchor ?? slugifyPlain(title),
					line: at(i),
				};
				projects.push(project);
				current = project;
				currentIsTask = false;
			} else {
				while (taskStack.length > 0 && taskStack[taskStack.length - 1].depth >= depth) {
					taskStack.pop();
				}
				const parent = taskStack[taskStack.length - 1] ?? null;
				const expected = parent ? parent.depth + 1 : 2;
				if (depth !== expected) {
					fail(
						`"${title}" is an H${depth} but the nesting expects an H${expected} — a sub-task sits exactly one level deeper than its parent`,
						at(i),
					);
				}
				const task: ParsedTask = {
					title,
					anchor: anchor ?? slugifyPlain(title),
					line: at(i),
					depth,
					headingParent: parent ? parent.anchor : null,
					comments: [],
				};
				tasks.push(task);
				taskStack.push(task);
				current = task;
				currentIsTask = true;
			}

			fieldLineOpen = true;
			descriptionLines = [];
			descriptionFenced = false;
			i += 1;
			continue;
		}

		// --- blank lines ------------------------------------------------------
		if (!trimmed) {
			if (current && descriptionLines.length > 0) descriptionLines.push("");
			i += 1;
			continue;
		}

		// --- shorthand blockquote comment ------------------------------------
		if (trimmed.startsWith(">")) {
			if (!currentIsTask) {
				fail(`Comments belong to Tasks, not Projects`, at(i));
			}
			const openedAt = at(i);
			const quoted: string[] = [];
			while (i < lines.length && lines[i].trim().startsWith(">")) {
				quoted.push(lines[i].trim().replace(/^>\s?/, ""));
				i += 1;
			}
			const first = quoted[0] ?? "";
			const meta = /^(.*?)\s*\(([^)]*)\)\s*:\s*([\s\S]*)$/.exec(first);
			if (!meta) {
				fail(
					`Malformed comment — expected "> Author (offset): body"`,
					openedAt,
				);
			}
			const body = [meta[3], ...quoted.slice(1)].join("\n").trim();
			(current as ParsedTask).comments.push({
				author: meta[1].trim(),
				date: parseDateToken(meta[2], openedAt),
				body,
				line: openedAt,
			});
			fieldLineOpen = false;
			continue;
		}

		// --- field line -------------------------------------------------------
		if (current && fieldLineOpen) {
			const fields = readFieldLine(
				trimmed,
				currentIsTask ? TASK_FIELDS : PROJECT_FIELDS,
			);
			fieldLineOpen = false;
			if (fields) {
				applyFields(current, currentIsTask, fields, at(i));
				i += 1;
				continue;
			}
		}

		// --- description prose ------------------------------------------------
		if (!current) {
			fail(
				`Text outside any Project or Task: "${trimmed.slice(0, 60)}"`,
				at(i),
			);
		}
		if (descriptionFenced) {
			fail(
				`Text after a :::description fence — put it inside the fence`,
				at(i),
			);
		}
		descriptionLines.push(raw);
		i += 1;
	}

	closeNode();
	return { projects, tasks, warnings };
}

function applyFields(
	node: ParsedProject | ParsedTask,
	isTask: boolean,
	fields: Map<string, string>,
	line: number,
): void {
	const project = node as ParsedProject;
	const task = node as ParsedTask;

	for (const [key, value] of fields) {
		switch (key) {
			case "status":
				node.status = value;
				break;
			case "priority":
				node.priority = value;
				break;
			case "labels":
				node.labels = readList(value);
				break;
			case "start":
				node.start = parseDateToken(value, line);
				break;
			case "due":
				node.due = parseDateToken(value, line);
				break;
			case "created":
				node.created = parseDateToken(value, line);
				break;
			case "updated":
				node.updated = parseDateToken(value, line);
				break;
			case "archived":
				node.archived = readArchived(value, line);
				break;
			case "owner":
				project.owner = value;
				break;
			case "project":
				task.project = value;
				break;
			case "parent":
				task.parent = value;
				break;
			case "type":
				task.type = value;
				break;
			case "assignee":
				task.assignee = value;
				break;
			case "estimate": {
				const n = Number(value);
				if (!Number.isFinite(n)) {
					fail(`"estimate: ${value}" is not a number`, line);
				}
				task.estimate = n;
				break;
			}
			case "blocks":
				task.blocks = readList(value);
				break;
			case "blockedby":
				task.blockedBy = readList(value);
				break;
			case "related":
				task.related = readList(value);
				break;
			case "duplicateof":
				task.duplicateOf = value.trim();
				break;
			default:
				fail(`Unknown ${isTask ? "task" : "project"} field "${key}"`, line);
		}
	}
}

/* ------------------------------------------------------- card settings ---- */

/**
 * The gallery card preview.
 *
 * Derived from the frontmatter taxonomy alone — never from resolved example
 * content — so rendering a card stays free of `buildExampleContent()`, exactly
 * as it is for the hand-written TypeScript templates. A taxonomy the template
 * doesn't override is shown as the workspace default *only when the template
 * overrides at least one other taxonomy*; a template that overrides nothing
 * gets no taxonomy rows at all (it's saying "use the defaults" wholesale,
 * which is what the created workspace will actually get).
 */
function cardSettings(overrides: TemplateWorkspaceOverrides): TemplateSetting[] {
	// A template with *no* taxonomy override is deliberately saying "use the
	// workspace defaults" — so the card lists nothing it configured, rather than
	// restating the system defaults as if the template chose them. "Default view"
	// always applies, so it stays. This keeps ("blank"-style) templates honest
	// without special-casing any id.
	const rows: TemplateSetting[] = [
		plainSetting("Default view", "All Tasks (List, grouped by Status)"),
	];
	// An override counts for the card only if it carries at least one value. A
	// template that overrides nothing, or that explicitly empties every taxonomy
	// (a blank workspace) — the latter yields a non-empty key set but all-empty
	// arrays — deliberately shows no taxonomy rows rather than rows of nothing.
	const hasValues = Object.values(overrides).some(
		(arr) => Array.isArray(arr) && arr.length > 0,
	);
	if (!hasValues) return rows;
	return [
		settingsFromValues("Statuses", overrides.statuses ?? DEFAULT_STATUSES),
		settingsFromValues("Priorities", overrides.priorities ?? DEFAULT_PRIORITIES),
		settingsFromValues("Task Types", overrides.taskTypes ?? DEFAULT_TASK_TYPES),
		settingsFromValues("Labels", overrides.labels ?? DEFAULT_LABELS),
		...rows,
	];
}

/* ------------------------------------------------------------- entry ------ */

export function parseTemplateMarkdown(source: string): ParsedTemplate {
	const normalized = source.replace(/^\uFEFF/, "");
	const match = FRONTMATTER_RE.exec(normalized);
	if (!match) {
		fail(
			`Template has no YAML frontmatter — it must start with a "---" line`,
			1,
		);
	}

	let data: Record<string, unknown>;
	try {
		const parsed: unknown = parseYaml(match[1]);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			fail(`Frontmatter must be a YAML map`, 1);
		}
		data = parsed as Record<string, unknown>;
	} catch (error) {
		if (error instanceof TemplateParseError) throw error;
		fail(`Frontmatter is not valid YAML: ${(error as Error).message}`, 1);
	}

	// --- schema gate ---------------------------------------------------------
	if (data.templateSchema == null) {
		fail(
			`Frontmatter is missing "templateSchema" — add "templateSchema: ${TEMPLATE_SCHEMA_VERSION}"`,
			2,
		);
	}
	const schema = Number(data.templateSchema);
	if (!Number.isInteger(schema)) {
		fail(`"templateSchema" must be an integer, got "${data.templateSchema}"`, 2);
	}
	if (schema > TEMPLATE_SCHEMA_VERSION) {
		fail(
			`This template needs templateSchema ${schema}, but this version of Vertex Flow only understands up to ${TEMPLATE_SCHEMA_VERSION} — update the plugin`,
			2,
		);
	}

	const kind = data.kind;
	if (kind == null) fail(`Frontmatter is missing "kind" — add "kind: template"`, 3);
	if (kind !== "template") {
		fail(
			kind === "snapshot"
				? `"kind: snapshot" is not yet supported — only "kind: template" can be loaded`
				: `Unknown "kind: ${String(kind)}" — only "kind: template" is supported`,
			3,
		);
	}

	// --- taxonomy ------------------------------------------------------------
	const statuses = parseStatuses(data.statuses);
	const priorities = parseFlatTaxonomy<PriorityValue>(
		data.priorities,
		"priorities",
		"priority",
		true,
	);
	const taskTypes = parseFlatTaxonomy<TaskTypeValue>(
		data.taskTypes,
		"taskTypes",
		"taskType",
		false,
	);
	const labels = parseFlatTaxonomy<LabelValue>(data.labels, "labels", "label", false);
	const people = parsePeople(data.people);

	const workspaceOverrides: TemplateWorkspaceOverrides = {};
	if (statuses) workspaceOverrides.statuses = statuses;
	if (priorities) workspaceOverrides.priorities = priorities;
	if (taskTypes) workspaceOverrides.taskTypes = taskTypes;
	if (labels) workspaceOverrides.labels = labels;
	if (people) workspaceOverrides.people = people;

	const meta: TemplateMeta = {
		id: requireString(data, "id"),
		name: requireString(data, "name"),
		description: requireString(data, "description"),
		icon: optionalString(data, "icon"),
		supportsExampleContent: optionalBoolean(data, "supportsExampleContent"),
		author: optionalString(data, "author"),
		authorUrl: optionalString(data, "authorUrl"),
		templateVersion: optionalString(data, "templateVersion"),
		source: optionalString(data, "source"),
		settings: cardSettings(workspaceOverrides),
	};

	const views = parseViews(data.views);
	const dashboards = parseDashboards(data.dashboards);

	// --- body ----------------------------------------------------------------
	const frontmatterLines = match[0].split(/\r?\n/).length - 1;
	const body = normalized.slice(match[0].length);
	const { projects, tasks, warnings } = scanBody(body, frontmatterLines + 1);

	// Projects and Tasks share one anchor namespace: a `project:` reference and
	// a `parent:` reference are resolved through the same lookup, so a collision
	// between the two would be genuinely ambiguous rather than merely untidy.
	const anchors = new Map<string, { title: string; line: number }>();
	for (const node of [...projects, ...tasks]) {
		const clash = anchors.get(node.anchor);
		if (clash) {
			fail(
				`Duplicate anchor "${node.anchor}" — "${clash.title}" (line ${clash.line}) and "${node.title}" (line ${node.line}). Give one of them an explicit {#anchor}.`,
				node.line,
			);
		}
		anchors.set(node.anchor, { title: node.title, line: node.line });
	}

	return {
		meta,
		workspaceOverrides,
		views,
		dashboards,
		projects,
		tasks,
		warnings,
	};
}
