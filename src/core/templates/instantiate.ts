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
 * on: the `software-sprint` template with example content included.
 */

import { joinPath } from "../links";
import { formatTaskId, slugify } from "../ids";
import { serializeComments } from "../serialization/comments";
import { serializeProject } from "../serialization/entities";
import { serializeTask } from "../serialization/task";
import { serializeViews } from "../serialization/views";
import {
	createWorkspaceConfig,
	serializeWorkspace,
} from "../serialization/workspace";
import { defaultViews } from "../views/defaults";
import type {
	Comment,
	SavedView,
	WorkspaceConfig,
	WorkspaceSnapshot,
} from "../types";
import { deriveMentions } from "./helpers";
import { softwareSprintTemplate } from "./software-sprint";
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
	/** When set, ensures the `people` register has an entry for this name
	 *  flagged `isSelf` (matching an existing entry by name if there is one,
	 *  otherwise appending a new one and clearing `isSelf` elsewhere). This is
	 *  what makes `self` filters — "Assigned to Me" / "Mentions Me" (§7.6) —
	 *  resolve in a freshly created workspace. */
	selfPersonName?: string;
	/** Injectable clock so generated fixtures are deterministic in tests. */
	now?: Date;
}

/** Fold the creator's own name into the `people` register as `isSelf`. */
function seedSelfPerson(workspace: WorkspaceConfig, rawName: string): void {
	const name = rawName.trim();
	if (!name) return;

	const existing = workspace.people.find(
		(person) => person.name.toLowerCase() === name.toLowerCase(),
	);
	if (existing) {
		workspace.people = workspace.people.map((person) => ({
			...person,
			isSelf: person.id === existing.id,
		}));
		return;
	}

	const id = slugify(name, workspace.people.map((person) => person.id));
	workspace.people = [
		...workspace.people.map((person) => ({ ...person, isSelf: false })),
		{ id, name, aliases: [], isSelf: true },
	];
}

const DAY = 24 * 60 * 60 * 1000;

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
}

export function instantiateTemplate(
	options: InstantiateOptions,
): GeneratedWorkspace {
	const { template, root, includeExampleContent } = options;
	const name = options.name?.trim() || template.name;
	const idPrefix = (options.idPrefix?.trim() || template.defaultIdPrefix).toUpperCase();
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

	const content: TemplateContent | null = includeExampleContent
		? template.buildExampleContent(ctx)
		: null;

	// --- Workspace config ---------------------------------------------------

	const workspace = createWorkspaceConfig(name, idPrefix, root, options.icon);
	applyOverrides(workspace, template.workspace);
	applyOverrides(workspace, content?.workspace);
	if (options.selfPersonName) seedSelfPerson(workspace, options.selfPersonName);

	// `createWorkspaceConfig` defaults `defaultNewTaskStatus` to the default
	// backlog status id, which a taxonomy override may have removed.
	if (!workspace.statuses.some((s) => s.id === workspace.defaultNewTaskStatus)) {
		workspace.defaultNewTaskStatus = workspace.statuses[0].id;
	}

	// --- Views ------------------------------------------------------------

	const views: SavedView[] = [
		defaultViews()[0],
		...(template.views ?? []),
		...(content?.views ?? []),
	];

	// --- Notes ----------------------------------------------------------

	const notes: GeneratedNote[] = [
		{ path: joinPath(root, "_workspace"), frontmatter: serializeWorkspace(workspace), body: "" },
		{ path: joinPath(root, "_views"), frontmatter: serializeViews(views), body: "" },
	];

	const projects = content?.projects ?? [];
	const tasks = content?.tasks ?? [];
	const commentsByPath = content?.comments ?? new Map<string, Comment[]>();
	const descriptions = content?.descriptions ?? new Map<string, string>();

	if (content) {
		// Mentions are derived from comment bodies, exactly as the indexer does.
		deriveMentions(tasks, workspace.people, commentsByPath);

		for (const project of projects) {
			notes.push({
				path: project.path,
				frontmatter: serializeProject(project),
				body: `## Overview\n${project.title}.\n`,
			});
		}
		for (const task of tasks) {
			const description = descriptions.get(task.path) ?? "";
			const block = serializeComments(commentsByPath.get(task.path) ?? []);
			notes.push({
				path: task.path,
				frontmatter: serializeTask(task),
				body: block ? `${description}\n${block}\n` : description,
			});
		}
	}

	return {
		root,
		workspace,
		notes,
		snapshot: { workspace, tasks, projects, views },
	};
}

/** Shorthand used throughout the unit tests: the software-sprint template,
 *  populated, on a fixed clock. */
export function sampleSnapshot(root = "Sample"): WorkspaceSnapshot {
	return instantiateTemplate({
		template: softwareSprintTemplate,
		root,
		name: "Sample Workspace",
		idPrefix: "SMP",
		includeExampleContent: true,
		now: new Date("2026-08-26T12:00:00Z"),
	}).snapshot;
}
