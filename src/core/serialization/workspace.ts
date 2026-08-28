/**
 * `_workspace.md` — workspace identity plus all taxonomy definitions (§4.5).
 *
 * A frontmatter-only config note. Kept separate from `_views.md` because the
 * two change at wildly different rates: taxonomy config is near-static, saved
 * views churn constantly. Splitting them keeps git history meaningful.
 */

import { dirname } from "../links";
import {
	DEFAULT_LABELS,
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
	type RolloverPolicy,
	type StatusCategory,
	type StatusValue,
	type TaskTypeValue,
	type WorkspaceConfig,
} from "../types";
import {
	IssueLog,
	asBoolean,
	asNumber,
	asString,
	asStringArray,
	asRecord,
	compact,
	type ParseResult,
} from "./coerce";

const ROLLOVER_POLICIES: RolloverPolicy[] = [
	"auto-rollover",
	"return-to-backlog",
	"manual",
];

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
			// `self` filters resolve to exactly one person (§4.6); a second
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

	const cycles = asRecord(fm.cycles);
	const rolloverRaw = asString(cycles.rolloverPolicy) as RolloverPolicy | null;
	const rolloverPolicy =
		rolloverRaw && ROLLOVER_POLICIES.includes(rolloverRaw)
			? rolloverRaw
			: "auto-rollover";
	if (rolloverRaw && rolloverPolicy !== rolloverRaw) {
		log.add(`Unknown rolloverPolicy "${rolloverRaw}"; using "auto-rollover".`);
	}

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

	// A workspace with no statuses can't render a board at all, so this is the
	// one taxonomy that gets backfilled rather than left empty.
	const resolvedStatuses = statuses.length > 0 ? statuses : DEFAULT_STATUSES;
	if (statuses.length === 0) log.add("No statuses defined; using the defaults.");

	const declaredDefault = asString(fm.defaultNewTaskStatus);
	let defaultNewTaskStatus = declaredDefault ?? DEFAULT_NEW_TASK_STATUS;
	if (!resolvedStatuses.some((status) => status.id === defaultNewTaskStatus)) {
		const fallback = resolvedStatuses[0].id;
		if (declaredDefault) {
			log.add(
				`defaultNewTaskStatus "${declaredDefault}" is not a configured status; using "${fallback}".`,
			);
		}
		defaultNewTaskStatus = fallback;
	}

	const workspace: WorkspaceConfig = {
		type: "workspace",
		name,
		icon: asString(fm.icon) ?? undefined,
		idPrefix: (asString(fm.idPrefix) ?? "WRK").toUpperCase(),
		cycles: {
			enabled: asBoolean(cycles.enabled, false),
			termLabel: asString(cycles.termLabel) ?? "Cycle",
			rolloverPolicy,
		},
		archiving: {
			autoArchiveEnabled: asBoolean(archiving.autoArchiveEnabled, false),
			autoArchiveDays: asNumber(archiving.autoArchiveDays) ?? 30,
		},
		defaultNewTaskStatus,
		estimateUnitLabel: asString(fm.estimateUnitLabel),
		statuses: resolvedStatuses,
		priorities: priorities.length > 0 ? priorities : DEFAULT_PRIORITIES,
		taskTypes: taskTypes.length > 0 ? taskTypes : DEFAULT_TASK_TYPES,
		labels: labels.length > 0 ? labels : DEFAULT_LABELS,
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
		cycles: {
			enabled: workspace.cycles.enabled,
			termLabel: workspace.cycles.termLabel,
			rolloverPolicy: workspace.cycles.rolloverPolicy,
		},
		archiving: {
			autoArchiveEnabled: workspace.archiving.autoArchiveEnabled,
			autoArchiveDays: workspace.archiving.autoArchiveDays,
		},
		defaultNewTaskStatus: workspace.defaultNewTaskStatus,
		estimateUnitLabel: workspace.estimateUnitLabel,
		statuses: workspace.statuses.map((value) => ({
			id: value.id,
			name: value.name,
			color: value.color,
			category: value.category,
			order: value.order,
		})),
		priorities: workspace.priorities.map((value) => ({
			id: value.id,
			name: value.name,
			color: value.color,
			order: value.order,
		})),
		taskTypes: workspace.taskTypes.map((value) => ({
			id: value.id,
			name: value.name,
			color: value.color,
		})),
		labels: workspace.labels.map((value) => ({
			id: value.id,
			name: value.name,
			color: value.color,
		})),
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

/** A ready-to-write config for a brand-new workspace (§13). */
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
		cycles: {
			enabled: false,
			termLabel: "Cycle",
			rolloverPolicy: "auto-rollover",
		},
		archiving: { autoArchiveEnabled: false, autoArchiveDays: 30 },
		defaultNewTaskStatus: DEFAULT_NEW_TASK_STATUS,
		estimateUnitLabel: null,
		statuses: DEFAULT_STATUSES.map((value) => ({ ...value })),
		priorities: DEFAULT_PRIORITIES.map((value) => ({ ...value })),
		taskTypes: DEFAULT_TASK_TYPES.map((value) => ({ ...value })),
		labels: [],
		people: [],
		root,
	};
}
