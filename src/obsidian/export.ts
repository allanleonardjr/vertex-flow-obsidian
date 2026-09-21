/**
 * The Obsidian-only half of the export feature: resolve the scope, fetch task
 * documents when Rich data was requested, hand the results to the pure
 * `core/export` builders, and land the file at `<workspace-root>/Exports/`.
 *
 * Mirrors `mutations.ts`'s role — the logic lives in `core/`, this turns it into
 * vault operations.
 */

import type { TFile } from "obsidian";
import { localTodayIso, localTimeStamp } from "../core/date";
import {
	buildExport,
	exportFilename,
	needsDocuments,
	resolveScopeTasks,
	scopeIdentity,
	type ExportScope,
	type FieldId,
} from "../core/export";
import { serializeTemplateMarkdown } from "../core/templates/markdown/serialize";
import { slugify } from "../core/ids";
import { joinPath } from "../core/links";
import { queryContext } from "../core/query";
import { isSystemViewId, snapshotContext } from "../core/views";
import type { Comment, WorkspaceSnapshot } from "../core/types";
import type { NoteIO } from "./note-io";
import { WORKSPACE_TEMPLATES_FOLDER } from "./template-folder";
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
	/** Pins the export's date/time — the Export dialog threads through the
	 *  same `Date` it already used to preview the filename, so what's shown
	 *  before clicking Export always matches what's actually written.
	 *  Defaults to `new Date()` for other callers. */
	now?: Date;
	onProgress?: (progress: ExportProgress) => void;
}

export async function runExport(
	host: ExportHost,
	input: RunExportInput,
): Promise<{ file: TFile; taskCount: number }> {
	const { snapshot } = input;
	const me = getMePersonId(snapshot.workspace.root);
	const context = snapshotContext(snapshot, me);
	const now = input.now ?? new Date();
	const today = localTodayIso(now);

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

	const { content, taskCount } = buildExport({
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
		scopeIdentity(input.scope),
		input.format,
		now,
	);
	const path = host.io.availableRawPath(
		joinPath(snapshot.workspace.root, "Exports", filename),
	);
	const file = await host.io.writeRaw(path, content);
	return { file, taskCount };
}

/**
 * Capture a workspace's taxonomy, views, dashboards, people roster and Projects
 * (with their descriptions) as a `type: vertex-flow-workspace-template` markdown
 * file under the caller's chosen folder (default vault-root
 * `Vertex Flow Templates/`) — a template exists to create a workspace, so it
 * can't live inside one, and only the vault's templates folder(s) are
 * discovered by the New Workspace gallery.
 *
 * Tasks ride along only when `includeTasks` is set; their descriptions and
 * comments are each independently optional (`includeDescriptions` defaults
 * true, `includeComments` defaults false) and are read on demand (like Task
 * export does) into the template's `# Tasks` body. Archived Projects and
 * Tasks ride along only when `includeArchived` is set, so a full snapshot
 * doesn't leave dangling links.
 *
 * The frontmatter `id` now carries the same date-time stamp as the filename,
 * so two exports can never collide on `id`. Discovery no longer treats `id`
 * as a uniqueness key across a vault's own templates — only a collision with
 * a *built-in* template's id still matters there — so a hand-edited or
 * duplicated `id` can't make a legitimate template silently disappear from
 * the gallery; each vault template's real identity is its file path.
 */
export async function exportAsTemplate(
	host: ExportHost,
	snapshot: WorkspaceSnapshot,
	form: {
		name: string;
		description?: string;
		icon?: string;
		folder?: string;
		includeTasks?: boolean;
		/** Defaults to true when `includeTasks` is set — descriptions are the
		 *  expected case, unlike comments below. */
		includeDescriptions?: boolean;
		/** Defaults to false — comments are more likely to hold private
		 *  back-and-forth someone wouldn't want riding along with a shared
		 *  template. */
		includeComments?: boolean;
		includeArchived?: boolean;
		/** Same `Date` the dialog already used to preview the filename — see
		 *  `RunExportInput.now`. */
		now?: Date;
		onProgress?: (progress: ExportProgress) => void;
	},
): Promise<TFile> {
	const now = form.now ?? new Date();
	const folder = (form.folder ?? WORKSPACE_TEMPLATES_FOLDER).replace(
		/^\/+|\/+$/g,
		"",
	);
	// Reuses the same timestamp `exportFilename()` computes below, so two
	// exports can never collide on `id` — no need to scan the folder for
	// what's already taken. (Discovery no longer treats `id` as a uniqueness
	// key across vault templates anyway — see template-discovery.ts.)
	const id = `${slugify(form.name)}-${localTodayIso(now)}-${localTimeStamp(now)}`;

	// A Project's description lives in its note body, not on the `Project`
	// record — read it on demand, exactly like Task export reads documents.
	const activeProjects = snapshot.projects.filter(
		(project) => form.includeArchived || !project.archived,
	);
	const projectDescriptions: Record<string, string> = {};
	for (const project of activeProjects) {
		const doc = await host.mutations.readProjectDocument(project);
		if (doc.description) projectDescriptions[project.path] = doc.description;
	}

	// Task descriptions and comments are note-body payload too. Read only what
	// the serializer will carry (archived Tasks follow the same toggle, so the
	// reading loop and the filtering agree on the same set). Descriptions and
	// comments are independently optional — a single document read covers
	// both, so the loop only needs to skip *populating* whichever one wasn't
	// asked for, not skip the read itself.
	const wantDescriptions =
		form.includeTasks && (form.includeDescriptions ?? true);
	const wantComments = form.includeTasks && (form.includeComments ?? false);
	let taskDescriptions: Record<string, string> | undefined;
	let taskComments: Record<string, Comment[]> | undefined;
	if (wantDescriptions || wantComments) {
		const carried = snapshot.tasks.filter(
			(task) => form.includeArchived || !task.archived,
		);
		if (wantDescriptions) taskDescriptions = {};
		if (wantComments) taskComments = {};
		let done = 0;
		form.onProgress?.({ current: 0, total: carried.length });
		for (const task of carried) {
			const doc = await host.mutations.readDocument(task);
			if (wantDescriptions && doc.description) {
				taskDescriptions![task.path] = doc.description;
			}
			if (wantComments && doc.comments.length > 0) {
				taskComments![task.path] = doc.comments;
			}
			done += 1;
			form.onProgress?.({ current: done, total: carried.length });
		}
	}

	const content = serializeTemplateMarkdown({
		meta: {
			id,
			name: form.name.trim(),
			description: form.description?.trim() || undefined,
			icon: form.icon,
			createdAt: now.toISOString(),
		},
		workspace: snapshot.workspace,
		views: snapshot.views.filter((view) => !isSystemViewId(view.id)),
		dashboards: snapshot.dashboards,
		projects: snapshot.projects,
		projectDescriptions,
		tasks: form.includeTasks ? snapshot.tasks : undefined,
		taskDescriptions,
		taskComments,
		includeArchived: form.includeArchived,
		queryContext: queryContext(snapshot, getMePersonId(snapshot.workspace.root)),
	});

	const filename = exportFilename(
		snapshot.workspace.name,
		{ kind: "template", name: form.name },
		"md",
		now,
	);
	const path = host.io.availableRawPath(joinPath(folder, filename));
	const file = await host.io.writeRaw(path, content);
	return file;
}
