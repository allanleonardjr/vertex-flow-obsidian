/**
 * Field-diff helpers that turn "the thing before" and "the thing after" into
 * the `changes` array of a history entry. Pure and Obsidian-free, like the rest
 * of `src/core/history/`.
 *
 * The rules that matter:
 *   - `updatedAt` is never a change — it changes on *every* write and would
 *     drown the signal. Same for `rank` during a drag (see `moveTask`), which
 *     is why callers can opt fields out.
 *   - Deeper relations/body are intentionally out of scope: the log records the
 *     frontmatter facts, not the prose.
 */

import { valuesDiffer } from "./index";
import type {
	DashboardConfig,
	HistoryChange,
	Project,
	SavedView,
	TaxonomyValue,
	Task,
	WorkspaceConfig,
} from "../types";

/**
 * Fields the ledger reads naturally when a Task changes, excluding
 * always-churn fields (`updatedAt`) and noisy/fine-grained ones (`rank` —
 * it changes on literally every drag; `relations`/`mentions` edit via
 * frontmatter they're derived from — nothing to log; `createdAt`/`path`).
 */
const TASK_DIFF_FIELDS: ReadonlyArray<keyof Task> = [
	"title",
	"taskType",
	"status",
	"priority",
	"project",
	"parent",
	"assignee",
	"estimate",
	"labels",
	"startDate",
	"dueDate",
	"archived",
	"archivedAt",
];

/** Same idea for Projects; `description` is a body concern, not a field. */
const PROJECT_DIFF_FIELDS: ReadonlyArray<keyof Project> = [
	"title",
	"icon",
	"status",
	"priority",
	"labels",
	"startDate",
	"dueDate",
	"owner",
	"archived",
	"archivedAt",
];

export interface FieldDiffOptions {
	/** Fields to skip, e.g. `["rank"]` when only the drag bookkeeping changed. */
	skip?: readonly (keyof Task)[];
}

export function diffTaskFields(
	from: Task,
	to: Task,
	options: FieldDiffOptions = {},
): HistoryChange[] {
	const seen = new Set<string>(TASK_DIFF_FIELDS);
	options.skip?.forEach((f) => seen.delete(f as string));
	const changes: HistoryChange[] = [];
	for (const field of TASK_DIFF_FIELDS) {
		if (!seen.has(field as string)) continue;
		const a = from[field];
		const b = to[field];
		if (valuesDiffer(a, b)) {
			changes.push({ field: field as string, from: a, to: b });
		}
	}
	return changes;
}

export function diffProjectFields(
	from: Project,
	to: Project,
	options: FieldDiffOptions = {},
): HistoryChange[] {
	const seen = new Set<string>(PROJECT_DIFF_FIELDS);
	options.skip?.forEach((f) => seen.delete(f as string));
	const changes: HistoryChange[] = [];
	for (const field of PROJECT_DIFF_FIELDS) {
		if (!seen.has(field as string)) continue;
		const a = from[field];
		const b = to[field];
		if (valuesDiffer(a, b)) {
			changes.push({ field: field as string, from: a, to: b });
		}
	}
	return changes;
}

/**
 * Identity deltas for Saved Views. Views churn their *definition* constantly —
 * column drags, filter tweaks, sort/group picks — and that state is not
 * history. But what the view *is called* (and its icon/description) is, exactly
 * like renaming a Task or a Project.
 */
const VIEW_IDENTITY_FIELDS: ReadonlyArray<keyof SavedView> = [
	"name",
	"icon",
	"description",
];

export function viewIdentityChanges(
	from: SavedView,
	to: SavedView,
): HistoryChange[] {
	const changes: HistoryChange[] = [];
	for (const field of VIEW_IDENTITY_FIELDS) {
		if (valuesDiffer(from[field], to[field])) {
			changes.push({ field: field as string, from: from[field], to: to[field] });
		}
	}
	return changes;
}

/** Same idea for Dashboards; widgets/filters are churn, name/icon/description aren't. */
const DASHBOARD_IDENTITY_FIELDS: ReadonlyArray<keyof DashboardConfig> = [
	"name",
	"icon",
	"description",
];

export function dashboardIdentityChanges(
	from: DashboardConfig,
	to: DashboardConfig,
): HistoryChange[] {
	const changes: HistoryChange[] = [];
	for (const field of DASHBOARD_IDENTITY_FIELDS) {
		if (valuesDiffer(from[field], to[field])) {
			changes.push({ field: field as string, from: from[field], to: to[field] });
		}
	}
	return changes;
}

// ---------------------------------------------------------------------------
// Workspace config deltas
// ---------------------------------------------------------------------------

const CONFIG_SCALAR_FIELDS: ReadonlyArray<keyof WorkspaceConfig> = [
	"name",
	"icon",
	"idPrefix",
	"defaultNewTaskStatus",
	"estimateUnitLabel",
	"deletedAt",
];

const TAXONOMY_FIELDS: ReadonlyArray<"statuses" | "priorities" | "taskTypes" | "labels"> = [
	"statuses",
	"priorities",
	"taskTypes",
	"labels",
];

/** Per-item attributes worth reporting, keyed by item kind. */
const TAXONOMY_ATTRS: Readonly<Record<string, readonly string[]>> = {
	statuses: ["name", "color", "order", "category"],
	priorities: ["name", "color", "order"],
	taskTypes: ["name", "color", "description"],
	labels: ["name", "color", "description"],
};

const PEOPLE_ATTRS: readonly string[] = ["name", "aliases", "isSelf"];

/**
 * The delta between two workspace configs, flattened to a change list:
 *   - scalar top-level fields as `field` / `from` / `to`;
 *   - `archiving.*` and `history.*` flattened into dotted-field changes
 *     (mirrors the frontmatter block shape, so a reader can map them 1:1);
 *   - each taxonomy + `people` as an identity diff on names ("the set of
 *     statuses you have"), plus per-item attribute changes for edits and
 *     whole-item add/removes for new/disappeared entries id'd by, e.g.,
 *     `statuses.backlog.color`.
 *
 * Both configs carry `root`; it's structural and never a change.
 */
export function workspaceConfigChanges(
	from: WorkspaceConfig,
	to: WorkspaceConfig,
): HistoryChange[] {
	const changes: HistoryChange[] = [];

	for (const field of CONFIG_SCALAR_FIELDS) {
		if (valuesDiffer(from[field], to[field])) {
			changes.push({
				field: field as string,
				from: from[field],
				to: to[field],
			});
		}
	}

	const archivingFields: ReadonlyArray<keyof typeof from.archiving> = [
		"autoArchiveEnabled",
		"autoArchiveDays",
	];
	for (const field of archivingFields) {
		if (valuesDiffer(from.archiving[field], to.archiving[field])) {
			changes.push({
				field: `archiving.${field as string}`,
				from: from.archiving[field],
				to: to.archiving[field],
			});
		}
	}

	if (valuesDiffer(from.history.enabled, to.history.enabled)) {
		changes.push({
			field: "history.enabled",
			from: from.history.enabled,
			to: to.history.enabled,
		});
	}

	for (const field of TAXONOMY_FIELDS) {
		const attrs = TAXONOMY_ATTRS[field];
		pushKeyedItemDiffs(changes, field, from[field], to[field], attrs);
	}
	pushKeyedItemDiffs(changes, "people", from.people, to.people, PEOPLE_ATTRS);

	return changes;
}

function pushKeyedItemDiffs(
	changes: HistoryChange[],
	field: string,
	fromItems: readonly { id: string }[],
	toItems: readonly { id: string }[],
	attrs: readonly string[],
	bareField = field,
): void {
	if (valuesDiffer(fromItems.map((i) => i.id), toItems.map((i) => i.id))) {
		changes.push({
			field: bareField,
			from: fromItems.map((i) => i.id),
			to: toItems.map((i) => i.id),
		});
	}

	const byId = new Map(toItems.map((item) => [item.id, item]));
	for (const prev of fromItems) {
		const next = byId.get(prev.id);
		if (!next) {
			// Removed whole item.
			changes.push({
				field: `${bareField}.${prev.id}`,
				from: pickAttrs(prev as TaxonomyValue, attrs),
			});
			continue;
		}
		for (const attr of attrs) {
			const a = (prev as Record<string, unknown>)[attr];
			const b = (next as Record<string, unknown>)[attr];
			if (valuesDiffer(a, b)) {
				changes.push({
					field: `${bareField}.${prev.id}.${attr}`,
					from: a,
					to: b,
				});
			}
		}
	}
	for (const next of toItems) {
		if (fromItems.some((item) => item.id === next.id)) continue;
		changes.push({
			field: `${bareField}.${next.id}`,
			to: pickAttrs(next as TaxonomyValue, attrs),
		});
	}
}

function pickAttrs(
  item: { id: string },
  attrs: readonly string[],
): Record<string, unknown> {
  const record = item as Record<string, unknown>;
  const out: Record<string, unknown> = { id: item.id };
  for (const attr of attrs) {
    if (record[attr] !== undefined) out[attr] = record[attr];
  }
  return out;
}