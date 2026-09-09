/**
 * Export orchestration: a scope + field selection + format → a finished file.
 *
 * Pure and synchronous. The glue layer (`src/obsidian/export.ts`) does the
 * async document fetches for Description/Comments, then hands the results in
 * through `extras`.
 */

import type {
	Comment,
	IsoDate,
	LinkTarget,
	Task,
	WorkspaceSnapshot,
} from "../types";
import { snapshotContext, type ViewContext } from "../views";
import { buildCsv, type CsvColumn } from "./csv";
import {
	FIELDS,
	fieldsForFormat,
	type ExportFormat,
	type FieldId,
} from "./fields";
import { buildIcs, type IcsRow } from "./ics";
import { buildWorkspaceJson, type ExportMeta } from "./json";
import { resolveDisplayRecord, type ResolveLookups } from "./resolve";
import { resolveScopeTasks, type ExportScope } from "./scope";

export * from "./fields";
export * from "./scope";
export { buildCsv, UTF8_BOM } from "./csv";
export { buildIcs, type IcsRow } from "./ics";
export {
	buildWorkspaceJson,
	buildResolved,
	type ExportMeta,
	type ResolvedLookups,
} from "./json";
export { resolveDisplayRecord, type DisplayRecord } from "./resolve";

export interface ExportInput {
	snapshot: WorkspaceSnapshot;
	context?: ViewContext;
	scope: ExportScope;
	format: ExportFormat;
	fields: readonly FieldId[];
	today: IsoDate;
	includeArchived: boolean;
	pluginVersion: string;
	/** Present only when Description was requested. Task id → body. */
	descriptions?: Record<string, string>;
	/** Present only when Comments was requested. Task id → comments. */
	comments?: Record<string, Comment[]>;
}

export interface ExportOutput {
	content: string;
	taskCount: number;
	scopeLabel: string;
}

function taskTitleMap(snapshot: WorkspaceSnapshot): Map<LinkTarget, string> {
	const map = new Map<LinkTarget, string>();
	for (const task of snapshot.tasks) {
		map.set(task.path, task.title.trim() || task.id);
	}
	return map;
}

/** RFC 5545 `SEQUENCE`: the seconds the task has been edited, i.e.
 *  `updatedAt - createdAt`, floored. 0 for absent/unparseable dates; the ICS
 *  emitter additionally clamps negatives to 0. */
function sequenceOf(createdAt: string, updatedAt: string): number {
	const created = new Date(createdAt).getTime();
	const updated = new Date(updatedAt).getTime();
	if (Number.isNaN(created) || Number.isNaN(updated)) return 0;
	return Math.floor((updated - created) / 1000);
}

export function buildExport(input: ExportInput): ExportOutput {
	const context = input.context ?? snapshotContext(input.snapshot);
	const { tasks, scopeLabel } = resolveScopeTasks(
		input.snapshot,
		input.scope,
		context,
		input.today,
		{ includeArchived: input.includeArchived },
	);

	if (input.format === "json") {
		const meta: ExportMeta = {
			exportedAt: input.today,
			pluginVersion: input.pluginVersion,
			workspaceName: input.snapshot.workspace.name,
			workspaceRoot: input.snapshot.workspace.root,
		};
		const set = new Set(input.fields);
		const content = buildWorkspaceJson(input.snapshot, tasks, context, meta, {
			descriptions: set.has("description") ? input.descriptions ?? {} : undefined,
			comments: set.has("comments") ? input.comments ?? {} : undefined,
		});
		return { content, taskCount: tasks.length, scopeLabel };
	}

	const fields = fieldsForFormat(input.format, input.fields);
	const lookups: ResolveLookups = {
		context,
		taskTitleByPath: taskTitleMap(input.snapshot),
		descriptions: input.descriptions,
		comments: input.comments,
	};
	const records = tasks.map((task) => resolveDisplayRecord(task, lookups));

	if (input.format === "csv") {
		const columns: CsvColumn[] = fields.map((id) => ({
			id,
			label: FIELDS[id].label,
		}));
		return {
			content: buildCsv(records, columns),
			taskCount: tasks.length,
			scopeLabel,
		};
	}

	// iCalendar. Only `description` is user-toggleable; the identity, dates and
// status a VEVENT needs are always emitted when the task has them.
	const has = (id: FieldId) => fields.includes(id);
	const rows: IcsRow[] = tasks.map((task, i) => {
		const record = records[i];
		const row: IcsRow = {
			uid: `${task.id}@vertex-flow`,
			summary: record.title || task.id,
			stamp: task.updatedAt || task.createdAt,
			created: task.createdAt || task.updatedAt,
			lastModified: task.updatedAt || task.createdAt,
			sequence: sequenceOf(task.createdAt, task.updatedAt),
		};
		if (task.startDate) row.start = task.startDate;
		if (task.dueDate) row.due = task.dueDate;
		if (record.status) row.status = record.status;
		if (has("description") && record.description) {
			row.description = record.description;
		}
		return row;
	});
	return {
		content: buildIcs(rows, {
			prodId: `-//Vertex Flow//${input.snapshot.workspace.name}//EN`,
		}),
		taskCount: tasks.length,
		scopeLabel,
	};
}

/** lowercase, non-alphanumeric → `-`, trimmed. */
export function exportSlug(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "export"
	);
}

/**
 * `vertex-flow-export-<workspace-slug>-<scope-slug>-<date>.<ext>`
 *
 * The `vertex-flow-export-` prefix leads so an export file stays recognizable
 * once it's out of context (moved, synced, dropped into another folder).
 */
export function exportFilename(
	workspaceName: string,
	scopeLabel: string,
	format: ExportFormat,
	today: IsoDate,
): string {
	const ext = format === "ics" ? "ics" : format;
	return `vertex-flow-export-${exportSlug(workspaceName)}-${exportSlug(scopeLabel)}-${today}.${ext}`;
}
