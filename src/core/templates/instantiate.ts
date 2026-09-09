/**
 * Turns a `WorkspaceTemplate` into note descriptions.
 *
 * Generalized from the old single-purpose sample generator: it takes any
 * template plus an "include example content?" flag. Like its predecessor it
 * emits plain note descriptions — path, frontmatter, body — and writes nothing
 * itself, so it stays inside the no-Obsidian-imports rule. `Mutations` turns
 * the descriptions into files.
 *
 * `sampleSnapshot()` at the bottom is the fixture the core unit tests build
 * on: the `sample-workspace` fixture template with example content included.
 */

import { joinPath } from "../links";
import { formatTaskId, slugify } from "../ids";
import { serializeComments } from "../serialization/comments";
import { serializeDescription } from "../serialization/description";
import { serializeProject } from "../serialization/entities";
import { serializeTask } from "../serialization/task";
import { serializeView } from "../serialization/views";
import { serializeDashboard } from "../serialization/dashboards";
import {
	createWorkspaceConfig,
	serializeWorkspace,
} from "../serialization/workspace";
import { defaultViews, isSystemViewId } from "../views/defaults";
import { queryContext } from "../query";
import { seedHistory } from "../history/seed";
import type {
	Comment,
	DashboardConfig,
	HistoryEntry,
	SavedView,
	WorkspaceConfig,
	WorkspaceSnapshot,
} from "../types";
import { deriveMentions } from "./helpers";
import { sampleWorkspaceTemplate } from "./sample-workspace";
import type {
	TemplateBuildContext,
	TemplateContent,
	TemplateWorkspaceOverrides,
	WorkspaceTemplate,
} from "./types";

export interface GeneratedNote {
	path: string;
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface GeneratedWorkspace {
	root: string;
	workspace: WorkspaceConfig;
	notes: GeneratedNote[];
	/** The same content as a ready-to-use in-memory snapshot, for tests. */
	snapshot: WorkspaceSnapshot;
	/** Onboarding demo entries, when the workspace ships with history enabled
	 *  *and* example content — the glue layer appends these to `History/` so a
	 *  brand-new workspace opens the hub on a lived-in log, not an empty one.
	 *  `undefined` otherwise (history off, or a populated-less workspace). */
	history?: HistoryEntry[];
	/**
	 * The roster `Person.id` this workspace seeds as its self-person — from
	 * `selfPersonName` or the template's own `mePersonId`. `null` when neither
	 * was given. The glue layer persists it per device, per workspace (see
	 * `src/obsidian/me-storage.ts`) so `self` filters and the history actor
	 * resolve.
	 */
	personId?: string | null;
}

export interface InstantiateOptions {
	template: WorkspaceTemplate;
	root: string;
	name: string;
	idPrefix?: string;
	icon?: string;
	/** When false, the workspace gets the template's taxonomy/views but no
	 *  Projects or Tasks. */
	includeExampleContent: boolean;
	/** When set, creates the "me" person by this name — matching an existing
	 *  register entry if there is one, otherwise appending a new one — and
	 *  surfaces its `personId` on the generated workspace. This is what lets a
	 *  brand-new workspace name its creator. */
	selfPersonName?: string;
	/** When set, forces the workspace's activity-history state, overriding
	 *  whatever the template defined. When omitted, the template's own value
	 *  stands (a frontmatter `history: true` opts the workspace in). */
	enableHistory?: boolean;
	/** Injectable clock so generated fixtures are deterministic in tests. */
	now?: Date;
}

/**
 * Seed the register's "me" person from the creator's name — matching an
 * existing entry by name if there is one, otherwise appending a new one — and
 * return the binding a freshly created workspace should record app-wide.
 */
function seedSelfPersonName(
	workspace: WorkspaceConfig,
	rawName: string,
): string | null {
	const name = rawName.trim();
	if (!name) return null;

	const existing = workspace.people.find(
		(person) => person.name.toLowerCase() === name.toLowerCase(),
	);
	if (existing) return existing.id;

	const id = slugify(name, workspace.people.map((person) => person.id));
	workspace.people = [...workspace.people, { id, name, aliases: [] }];
	return id;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Wrap a template's task description in the plugin's fenced `## Description`
 * block — the only shape `parseDescription` (and therefore the editor) can
 * read back, and the same shape `createTask`/`setDescription` produce for
 * notes created after onboarding.
 *
 * Older template fences and the sample fixture carried the heading as part of
 * their content; a leading `## Description` is structure, not prose, so it's
 * dropped before serializing rather than letting it double up (mirroring how
 * project bodies shed a stray `## Overview`, `extractProjectDescription`).
 */
function descriptionBlockFor(raw: string | undefined): string {
	const content = (raw ?? "")
		.replace(/\r\n/g, "\n")
		.replace(/^\s*##\s+Description\s*\n?/i, "")
		.trim();
	return content ? serializeDescription(content) : "";
}

function applyOverrides(
	base: WorkspaceConfig,
	overrides: TemplateWorkspaceOverrides | undefined,
): void {
	if (!overrides) return;
	if (overrides.statuses) base.statuses = overrides.statuses.map((v) => ({ ...v }));
	if (overrides.priorities)
		base.priorities = overrides.priorities.map((v) => ({ ...v }));
	if (overrides.taskTypes)
		base.taskTypes = overrides.taskTypes.map((v) => ({ ...v }));
	if (overrides.labels) base.labels = overrides.labels.map((v) => ({ ...v }));
	if (overrides.people) base.people = overrides.people.map((v) => ({ ...v }));
	if (overrides.history)
		base.history = { enabled: Boolean(overrides.history.enabled) };
}

export function instantiateTemplate(
	options: InstantiateOptions,
): GeneratedWorkspace {
	const { template, root, includeExampleContent } = options;
	const name = options.name?.trim() || template.name;
	const idPrefix = (options.idPrefix?.trim() || "").toUpperCase();
	const now = options.now ?? new Date();

	const iso = (offsetDays: number) =>
		new Date(now.getTime() + offsetDays * DAY).toISOString();
	const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);

	const ctx: TemplateBuildContext = {
		root,
		idPrefix,
		now,
		iso,
		day,
		taskPath: (n: number) => joinPath(root, "Tasks", formatTaskId(idPrefix, n)),
	};

	// `includeExampleContent` gates the example material — projects, tasks,
	// comments/descriptions, seeded history. A template that opts out of
	// example content entirely (an exported workspace template ships no tasks
	// or projects — only configuration) treats everything it returns as config
	// to apply unconditionally, so the gallery's always-off "populate" toggle
	// can't silently drop its views and dashboards.
	const wantsConfigContent =
		includeExampleContent || template.supportsExampleContent === false;
	const content: TemplateContent | null = wantsConfigContent
		? template.buildExampleContent(ctx)
		: null;

	// --- Workspace config ---------------------------------------------------

	const workspace = createWorkspaceConfig(name, idPrefix, root, options.icon);
	applyOverrides(workspace, template.workspace);
	applyOverrides(workspace, content?.workspace);
	// An explicit creator choice outranks the template's own `history:` value.
	if (options.enableHistory !== undefined)
		workspace.history = { enabled: options.enableHistory };
	let personId: string | null = null;
	if (options.selfPersonName)
		personId = seedSelfPersonName(workspace, options.selfPersonName);
	else if (template.mePersonId) {
		const person = workspace.people.find((p) => p.id === template.mePersonId);
		if (person) personId = person.id;
	}

	// `createWorkspaceConfig` defaults `defaultNewTaskStatus` to the default
	// backlog status id, which a taxonomy override may have removed. A template
	// may also leave `statuses` empty (a blank workspace's override); with no
	// statuses there's nothing to default to, so `defaultNewTaskStatus` becomes
	// `null` and new tasks/projects carry no status rather than a phantom id.
	if (workspace.statuses.length === 0) {
		workspace.defaultNewTaskStatus = null;
	} else if (
		!workspace.statuses.some((s) => s.id === workspace.defaultNewTaskStatus)
	) {
		workspace.defaultNewTaskStatus = workspace.statuses[0].id;
	}

	// --- Views ------------------------------------------------------------

	// The "All Tasks" System View is injected by the index, never a file — so
	// it rides in the returned snapshot but isn't emitted as a note.
	const views: SavedView[] = [
		defaultViews()[0],
		...(template.views ?? []),
		...(content?.views ?? []),
	].map((view) =>
		isSystemViewId(view.id)
			? view
			: { ...view, path: joinPath(root, "Views", view.id) },
	);

	const dashboards: DashboardConfig[] = (content?.dashboards ?? []).map(
		(dashboard) => ({
			...dashboard,
			path: joinPath(root, "Dashboards", dashboard.id),
		}),
	);

	const projects = content?.projects ?? [];
	const tasks = content?.tasks ?? [];

	// --- Notes ----------------------------------------------------------
	//
	// One file per Saved View / Dashboard, under `Views/` / `Dashboards/` —
	// same per-file storage the live app uses. A workspace with no user views
	// or dashboards simply has empty folders.

	// Resolves the pretty tokens a view/dashboard `query:` string prints.
	const qctx = queryContext(
		{ workspace, projects, tasks } as WorkspaceSnapshot,
		personId,
	);

	const notes: GeneratedNote[] = [
		{ path: joinPath(root, "_workspace"), frontmatter: serializeWorkspace(workspace), body: "" },
	];

	for (const view of views) {
		if (isSystemViewId(view.id)) continue;
		notes.push({
			path: view.path,
			frontmatter: serializeView(view, qctx),
			body: "",
		});
	}

	for (const dashboard of dashboards) {
		notes.push({
			path: dashboard.path,
			frontmatter: serializeDashboard(dashboard, qctx),
			body: "",
		});
	}

	// A history-enabled, example-content workspace opens on a seeded log (see
	// `seedHistory`) so the hub demonstrates itself on first visit. History off
	// (or no content to narrate) leaves it `undefined` and the folder empty.
	// System views aren't scaffolded notes, so they don't get seeded either.
	const history =
		workspace.history.enabled && content
			? seedHistory({
					workspace,
					views: views.filter((view) => !isSystemViewId(view.id)),
					dashboards,
					tasks,
					projects,
					now,
				})
			: undefined;
	const commentsByPath = content?.comments ?? new Map<string, Comment[]>();
	const descriptions = content?.descriptions ?? new Map<string, string>();
	const projectDescriptions =
		content?.projectDescriptions ?? new Map<string, string>();

	if (content) {
		// Mentions are derived from comment bodies, exactly as the indexer does.
		deriveMentions(tasks, workspace.people, commentsByPath);

		for (const project of projects) {
			notes.push({
				path: project.path,
				frontmatter: serializeProject(project, qctx),
				// No fallback copy: a template that doesn't describe a Project gets
				// an empty body, not a restated title. `extractProjectDescription`
				// already strips the `## Overview` heading older notes carried.
				body: projectDescriptions.get(project.path) ?? "",
			});
		}
		for (const task of tasks) {
			const descriptionBlock = descriptionBlockFor(descriptions.get(task.path));
			const block = serializeComments(commentsByPath.get(task.path) ?? []);
			const body = [descriptionBlock, block].filter(Boolean).join("\n\n");
			notes.push({
				path: task.path,
				frontmatter: serializeTask(task),
				body: body ? `${body}\n` : "",
			});
		}
	}

	return {
		root,
		workspace,
		notes,
		history,
		personId,
		snapshot: { workspace, tasks, projects, views, dashboards, trash: [] },
	};
}

/** Shorthand used throughout the unit tests: the sample-workspace fixture,
 *  populated, on a fixed clock. */
export function sampleSnapshot(root = "Sample"): WorkspaceSnapshot {
	return instantiateTemplate({
		template: sampleWorkspaceTemplate,
		root,
		name: "Sample Workspace",
		idPrefix: "SMP",
		includeExampleContent: true,
		now: new Date("2026-08-26T12:00:00Z"),
	}).snapshot;
}
