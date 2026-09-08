/**
 * The Obsidian-only half of the export feature: resolve the scope, fetch task
 * documents when Rich data was requested, hand the results to the pure
 * `core/export` builders, and land the file at `<workspace-root>/Exports/`.
 *
 * Mirrors `mutations.ts`'s role — the logic lives in `core/`, this turns it into
 * vault operations.
 */

import type { TFile } from "obsidian";
import { localTodayIso } from "../core/date";
import {
	buildExport,
	exportFilename,
	needsDocuments,
	resolveScopeTasks,
	type ExportScope,
	type FieldId,
} from "../core/export";
import { serializeTemplateMarkdown } from "../core/templates/markdown/serialize";
import { WORKSPACE_TEMPLATES } from "../core/templates";
import { slugify } from "../core/ids";
import { joinPath } from "../core/links";
import { queryContext } from "../core/query";
import { isSystemViewId, snapshotContext } from "../core/views";
import type { Comment, WorkspaceSnapshot } from "../core/types";
import type { NoteIO } from "./note-io";
import type { Mutations } from "./mutations";
import { getMePersonId } from "./me-storage";

/** The plugin surface this module needs — decoupled from `main.ts`. */
interface ExportHost {
	io: NoteIO;
	mutations: Mutations;
	manifest: { version: string };
}

export interface ExportProgress {
	current: number;
	total: number;
}

export interface RunExportInput {
	snapshot: WorkspaceSnapshot;
	scope: ExportScope;
	format: "csv" | "json" | "ics";
	fields: FieldId[];
	includeArchived: boolean;
	onProgress?: (progress: ExportProgress) => void;
}

export async function runExport(
	host: ExportHost,
	input: RunExportInput,
): Promise<{ file: TFile; taskCount: number }> {
	const { snapshot } = input;
	const me = getMePersonId(snapshot.workspace.root);
	const context = snapshotContext(snapshot, me);
	const today = localTodayIso();

	let descriptions: Record<string, string> | undefined;
	let comments: Record<string, Comment[]> | undefined;

	if (needsDocuments(input.fields)) {
		const { tasks } = resolveScopeTasks(snapshot, input.scope, context, today, {
			includeArchived: input.includeArchived,
		});
		descriptions = {};
		comments = {};
		let done = 0;
		input.onProgress?.({ current: 0, total: tasks.length });
		for (const task of tasks) {
			const doc = await host.mutations.readDocument(task);
			if (doc.description) descriptions[task.id] = doc.description;
			if (doc.comments.length > 0) comments[task.id] = doc.comments;
			done += 1;
			input.onProgress?.({ current: done, total: tasks.length });
		}
	}

	const { content, taskCount, scopeLabel } = buildExport({
		snapshot,
		context,
		scope: input.scope,
		format: input.format,
		fields: input.fields,
		today,
		includeArchived: input.includeArchived,
		pluginVersion: host.manifest.version,
		descriptions,
		comments,
	});

	const filename = exportFilename(
		snapshot.workspace.name,
		scopeLabel,
		input.format,
		today,
	);
	const path = host.io.availableRawPath(
		joinPath(snapshot.workspace.root, "Exports", filename),
	);
	const file = await host.io.writeRaw(path, content);
	return { file, taskCount };
}

/**
 * Capture a workspace's taxonomy, views, dashboards and people roster as a
 * `type: vertex-flow-workspace-template` markdown file under the caller's
 * chosen folder (default vault-root `Templates/`) — a template exists to create
 * a workspace, so it can't live inside one, and only the canonical `Templates/`
 * folder is discovered by the New Workspace gallery.
 *
 * The frontmatter `id` stays unprefixed (it's what the gallery keys on); only
 * the filename gains the `vertex-flow-template-` prefix so the file stays
 * recognizable once it's out of context.
 */
export async function exportAsTemplate(
	host: ExportHost,
	snapshot: WorkspaceSnapshot,
	form: {
		name: string;
		description?: string;
		icon?: string;
		folder?: string;
	},
): Promise<TFile> {
	const folder = (form.folder ?? "Templates").replace(/^\/+|\/+$/g, "");
	const existingIds = host.io
		.listFiles(folder)
		.filter((file) => file.extension === "md")
		.map((file) => file.basename);
	const taken = new Set<string>([
		...WORKSPACE_TEMPLATES.map((template) => template.id),
		...existingIds,
	]);
	const id = slugify(form.name, taken);

	const content = serializeTemplateMarkdown({
		meta: {
			id,
			name: form.name.trim(),
			description: form.description?.trim() || undefined,
			icon: form.icon,
		},
		workspace: snapshot.workspace,
		views: snapshot.views.filter((view) => !isSystemViewId(view.id)),
		dashboards: snapshot.dashboards,
		queryContext: queryContext(snapshot, getMePersonId(snapshot.workspace.root)),
	});

	const path = host.io.availableRawPath(
		joinPath(folder, `vertex-flow-template-${id}.md`),
	);
	const file = await host.io.writeRaw(path, content);
	return file;
}
