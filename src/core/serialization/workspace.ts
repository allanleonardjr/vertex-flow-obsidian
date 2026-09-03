/**
 * `_workspace.md` — workspace identity plus all taxonomy definitions.
 *
 * A frontmatter-only config note. Kept separate from the Saved View notes because they
 * two change at wildly different rates: taxonomy config is near-static, saved
 * views churn constantly. Splitting them keeps git history meaningful.
 */

import { dirname } from "../links";
import {
	DEFAULT_NEW_TASK_STATUS,
	DEFAULT_PRIORITIES,
	DEFAULT_STATUSES,
	DEFAULT_TASK_TYPES,
} from "../taxonomy/defaults";
import {
	STATUS_CATEGORIES,
	type LabelValue,
	type Person,
	type PriorityValue,
	type StatusCategory,
	type StatusValue,
	type TaskTypeValue,
	type WorkspaceConfig,
} from "../types";
import {
	IssueLog,
	asBoolean,
	asDateTime,
	asNumber,
	asString,
	asStringArray,
	asRecord,
	compact,
	type ParseResult,
} from "./coerce";

const FALLBACK_COLOR = "#94a3b8";

function parseTaxonomyList(
	raw: unknown,
	log: IssueLog,
	kind: string,
	options: { ordered: boolean; categorized: boolean },
): TaxonomyRow[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) {
		log.add(`${kind} must be a list; ignoring it.`);
		return [];
	}

	const rows: TaxonomyRow[] = [];
	const seen = new Set<string>();

	raw.forEach((entry, index) => {
		const record = asRecord(entry);
		const id = asString(record.id);
		if (!id) {
			log.add(`${kind}[${index}] has no id; skipped.`);
			return;
		}
		if (seen.has(id)) {
			log.add(`${kind} id "${id}" is duplicated; keeping the first.`);
			return;
		}
		seen.add(id);

		const row: TaxonomyRow = {
			id,
			name: asString(record.name) ?? id,
			color: asString(record.color) ?? FALLBACK_COLOR,
		};

		const description = asString(record.description);
		if (description) row.description = description;

		if (options.ordered) row.order = asNumber(record.order) ?? rows.length + 1;

		if (options.categorized) {
			const category = asString(record.category) as StatusCategory | null;
			if (category && STATUS_CATEGORIES.includes(category)) {
				row.category = category;
			} else {
				// A status without a valid category can't drive any logic, so it
				// falls back to `backlog` rather than being dropped — losing a
				// status would orphan every task using it.
				log.add(
					`Status "${id}" has an unknown category ${JSON.stringify(category)}; treating it as "backlog".`,
				);
				row.category = "backlog";
			}
		}

		rows.push(row);
	});

	return rows;
}

interface TaxonomyRow {
	id: string;
	name: string;
	color: string;
	order?: number;
	category?: StatusCategory;
	description?: string;
}

function parsePeople(raw: unknown, log: IssueLog): Person[] {
	if (raw == null) return [];
	if (!Array.isArray(raw)) {
		log.add("people must be a list; ignoring it.");
		return [];
	}

	const people: Person[] = [];
	let selfSeen = false;

	for (const entry of raw) {
		const record = asRecord(entry);
		const id = asString(record.id);
		if (!id) continue;

		const isSelf = asBoolean(record.isSelf, false);
		if (isSelf && selfSeen) {
			// `self` filters resolve to exactly one person; a second
			// `isSelf` would make "Assigned to Me" ambiguous.
			log.add(`More than one person is flagged isSelf; ignoring it on "${id}".`);
		}

		people.push({
			id,
			name: asString(record.name) ?? id,
			aliases: asStringArray(record.aliases),
			isSelf: isSelf && !selfSeen,
		});
		if (isSelf) selfSeen = true;
	}

	return people;
}

export interface WorkspaceParseOptions {
	/** Vault path of the `_workspace.md` note. */
	path: string;
}

export function parseWorkspace(
	raw: unknown,
	options: WorkspaceParseOptions,
): ParseResult<WorkspaceConfig> {
	const fm = asRecord(raw);
	const log = new IssueLog();

	const root = dirname(options.path);
	const name = asString(fm.name) ?? (root ? root.split("/").pop() ?? root : "Workspace");

	const archiving = asRecord(fm.archiving);

	const statuses = parseTaxonomyList(fm.statuses, log, "statuses", {
		ordered: true,
		categorized: true,
	}) as StatusValue[];
	const priorities = parseTaxonomyList(fm.priorities, log, "priorities", {
		ordered: true,
		categorized: false,
	}) as PriorityValue[];
	const taskTypes = parseTaxonomyList(fm.taskTypes, log, "taskTypes", {
		ordered: false,
		categorized: false,
	}) as TaskTypeValue[];
	const labels = parseTaxonomyList(fm.labels, log, "labels", {
		ordered: false,
		categorized: false,
	}) as LabelValue[];

	// A blank workspace may have an empty taxonomy (explicitly `[]` or omitted).
	// The file is authoritative: we do NOT backfill the workspace defaults, so
	// Settings/EditorRail show exactly what's configured — nothing, for a blank
	// workspace. With no statuses there is no sensible default status, so
	// `defaultNewTaskStatus` becomes `null` and new tasks/projects carry no
	// status instead of a phantom id that would render as "…(removed)".

	let defaultNewTaskStatus = asString(fm.defaultNewTaskStatus) ?? null;
	if (statuses.length > 0) {
		if (!statuses.some((s) => s.id === defaultNewTaskStatus)) {
			const fallback = statuses[0].id;
			if (defaultNewTaskStatus != null) {
				log.add(
					`defaultNewTaskStatus "${asString(fm.defaultNewTaskStatus)}" is not a configured status; using "${fallback}".`,
				);
			}
			defaultNewTaskStatus = fallback;
		}
	} else {
		defaultNewTaskStatus = null;
	}

	const workspace: WorkspaceConfig = {
		type: "workspace",
		name,
		icon: asString(fm.icon) ?? undefined,
		idPrefix: (asString(fm.idPrefix) ?? "WRK").toUpperCase(),
		archiving: {
			autoArchiveEnabled: asBoolean(archiving.autoArchiveEnabled, false),
			autoArchiveDays: asNumber(archiving.autoArchiveDays) ?? 30,
		},
		defaultNewTaskStatus,
		estimateUnitLabel: asString(fm.estimateUnitLabel),
		deletedAt: asDateTime(fm.deletedAt),
		statuses,
		priorities,
		taskTypes,
		labels,
		people: parsePeople(fm.people, log),
		root,
	};

	return { value: workspace, issues: log.issues };
}

export function serializeWorkspace(
	workspace: WorkspaceConfig,
): Record<string, unknown> {
	return compact({
		type: "workspace",
		name: workspace.name,
		icon: workspace.icon,
		idPrefix: workspace.idPrefix,
		archiving: {
			autoArchiveEnabled: workspace.archiving.autoArchiveEnabled,
			autoArchiveDays: workspace.archiving.autoArchiveDays,
		},
		defaultNewTaskStatus: workspace.defaultNewTaskStatus,
		estimateUnitLabel: workspace.estimateUnitLabel,
		deletedAt: workspace.deletedAt,
		statuses: workspace.statuses.map((value) =>
			compact({
				id: value.id,
				name: value.name,
				color: value.color,
				category: value.category,
				order: value.order,
				description: value.description,
			}),
		),
		priorities: workspace.priorities.map((value) =>
			compact({
				id: value.id,
				name: value.name,
				color: value.color,
				order: value.order,
				description: value.description,
			}),
		),
		taskTypes: workspace.taskTypes.map((value) =>
			compact({
				id: value.id,
				name: value.name,
				color: value.color,
				description: value.description,
			}),
		),
		labels: workspace.labels.map((value) =>
			compact({
				id: value.id,
				name: value.name,
				color: value.color,
				description: value.description,
			}),
		),
		people: workspace.people.map((person) =>
			compact({
				id: person.id,
				name: person.name,
				aliases: person.aliases,
				isSelf: person.isSelf ?? false,
			}),
		),
	});
}

/** A ready-to-write config for a brand-new workspace. */
export function createWorkspaceConfig(
	name: string,
	idPrefix: string,
	root: string,
	icon?: string,
): WorkspaceConfig {
	return {
		type: "workspace",
		name,
		icon,
		idPrefix: idPrefix.toUpperCase(),
		archiving: { autoArchiveEnabled: false, autoArchiveDays: 30 },
		defaultNewTaskStatus: DEFAULT_NEW_TASK_STATUS,
		estimateUnitLabel: null,
		deletedAt: null,
		statuses: DEFAULT_STATUSES.map((value) => ({ ...value })),
		priorities: DEFAULT_PRIORITIES.map((value) => ({ ...value })),
		taskTypes: DEFAULT_TASK_TYPES.map((value) => ({ ...value })),
		labels: [],
		people: [],
		root,
	};
}
