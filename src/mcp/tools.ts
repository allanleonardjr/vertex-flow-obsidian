/**
 * MCP tool registration — the 27-tool read-only surface.
 *
 * Thin glue over the pure builders in `src/core/mcp/`: each tool validates its
 * inputs (a workspace must exist, a query must parse, a topic must be found),
 * pulls the one extra piece of I/O core can't reach (note bodies for a task's
 * comments / description), and wraps the resulting payload. Every tool returns
 * JSON in a text block; invalid input is an `isError` result with a message the
 * model can act on — never an MCP protocol-level error.
 *
 * `workspace` is optional on every workspace-scoped tool: omitted, it
 * resolves to whatever `set_active_workspace` last set for this running
 * server, else the workspace actually showing in the Obsidian window (see
 * `resolveWorkspace` inside `createMcpServer`). Supplied, it's matched by
 * exact root path first, then by a case-insensitive substring of the
 * workspace's name (see `matchWorkspace`) — so a client can address a
 * workspace by name without ever having seen its internal root path.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Comment, IsoDate, ViewFilters } from "../core/types";
import type { NoteIO } from "../obsidian/note-io";
import type { VaultIndex } from "../obsidian/index-store";
import { queryContext } from "../core/query";
import { parseQuery } from "../core/query/parse";
import { parseComments, splitBody } from "../core/serialization/comments";
import {
	commentRows,
	countProjects,
	countTasks,
	dashboardDetail,
	dashboardRow,
	errorPayload,
	getStats,
	getSummary,
	labelDetail,
	labelRows,
	pageList,
	personDetail,
	personRows,
	projectDetail,
	projectRows,
	readDashboard,
	recurringRows,
	runView,
	taskDetail,
	taskRows,
	viewDetail,
	viewRow,
	workspaceDetail,
	workspaceRow,
} from "../core/mcp/responses";
import { getHelpTopic, helpTopicRef, searchHelp } from "../core/mcp/help";
import type { McpHelpHit } from "../core/mcp/help";
import { buildVaultUri } from "../core/mcp/uris";
import type { McpErrorPayload } from "../core/mcp/responses";
import { searchWorkspace } from "../obsidian/workspace-search";

export interface McpDeps {
	index: VaultIndex;
	io: NoteIO;
	version: string;
	/** Resolve the device's "me" person for a workspace, for `self:` filters. */
	me: (root: string) => string | null;
	/** The workspace the Obsidian window is actually showing right now, if any — the default when `workspace` is omitted and no `set_active_workspace` override is in effect. */
	activeWorkspace: () => WorkspaceSnapshot | null;
	/** The user's local calendar day as `YYYY-MM-DD` — what date-based filters and the "today" buckets measure against. */
	today: () => IsoDate;
}

const MAX_DETAIL_DOC_CHARS = 20_000;

function ok(payload: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload) }],
	};
}

function fail(payload: McpErrorPayload) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload) }],
		isError: true as const,
	};
}

function unknownWorkspace(query: string) {
	return withHelpDocs(
		errorPayload(
			"unknown-workspace",
			`No workspace matches "${query}" — tried it as a root path and as a workspace name.`,
		),
		"concepts-workspaces",
	);
}

function ambiguousWorkspace(query: string, matches: WorkspaceSnapshot[]) {
	const candidates = matches
		.map((m) => `"${m.workspace.name}" (${m.workspace.root})`)
		.join(", ");
	return withHelpDocs(
		errorPayload(
			"ambiguous-workspace",
			`"${query}" matches more than one workspace: ${candidates}. Be more specific, or pass the exact root path.`,
		),
		"concepts-workspaces",
	);
}

/**
 * Attach a "read this help topic" pointer to an error payload, so a failing
 * tool call both says what went wrong and points at the docs that explain how
 * to get it right — the model can open the `vaultUri` in the plugin.
 */
function withHelpDocs(
	payload: McpErrorPayload,
	topicId: string,
	anchor?: string,
): McpErrorPayload & { help?: McpHelpHit[] } {
	const ref = helpTopicRef(topicId);
	if (!ref) return payload;
	return {
		...payload,
		help: [
			{
				...ref,
				...(anchor ? { vaultUri: buildVaultUri({ action: "help", topicId, anchor }) } : {}),
			},
		],
	};
}

type WorkspaceSnapshot = NonNullable<ReturnType<VaultIndex["get"]>>;

/**
 * Resolve a user-supplied `workspace` string against `deps.index`: an exact
 * `root` match first (unchanged, existing behavior), else a case-insensitive
 * substring match against `workspace.name` across every indexed workspace.
 * Shared by `resolveWorkspace`'s "workspace was supplied" branch and the
 * `set_active_workspace` tool, which resolve the same way.
 */
function matchWorkspace(
	deps: McpDeps,
	query: string,
): { snapshot: WorkspaceSnapshot } | { error: McpErrorPayload } {
	const exact = deps.index.get(query);
	if (exact) return { snapshot: exact };

	const needle = query.toLocaleLowerCase();
	const matches = deps.index
		.list()
		.filter((snapshot) => snapshot.workspace.name.toLocaleLowerCase().includes(needle));

	if (matches.length === 1) return { snapshot: matches[0] };
	if (matches.length === 0) return { error: unknownWorkspace(query) };
	return { error: ambiguousWorkspace(query, matches) };
}

/** The `{ workspace, … }` scope block every workspace-scoped tool shares. */
function scopeOf(snapshot: WorkspaceSnapshot): {
	workspace: { id: string; name: string };
} {
	return {
		workspace: {
			id: snapshot.workspace.root,
			name: snapshot.workspace.name,
		},
	};
}

/** `vaultUri` for a quick-switcher hit, where the URI grammar has a route. */
function vaultUriForHit(
	hit: { kind: string; id: string },
	root: string,
): string | undefined {
	switch (hit.kind) {
		case "task":
		case "project":
			return buildVaultUri({ action: "open-task", path: hit.id, target: "vf" });
		case "view":
			return buildVaultUri({ action: "open-view", viewId: hit.id, root });
		default:
			// Dashboard / label / person have no URI route yet — omit rather
			// than send a useless link.
			return undefined;
	}
}

export function createMcpServer(deps: McpDeps): McpServer {
	const server = new McpServer(
		{ name: "vertex-flow", version: deps.version },
		{ capabilities: { tools: {} } },
	);

	// Session-scoped default workspace, settable via `set_active_workspace`
	// below. One `createMcpServer` call backs one client session, so this is
	// per-connected-client state: each client gets its own default, threaded
	// entirely through tool parameters (no shared mutable state in the HTTP
	// layer). It resets when that client's session ends (reconnect, disconnect
	// from Settings, or a server restart) rather than persisting — "sticky
	// until changed" means for the life of this connected session, not forever.
	let defaultWorkspaceRoot: string | null = null;

	/** Snapshot a tool's `workspace` resolves against, or an error payload. */
	function resolveWorkspace(
		workspace: string | undefined,
	): { snapshot: WorkspaceSnapshot } | { error: McpErrorPayload } {
		const trimmed = workspace?.trim();
		if (trimmed) return matchWorkspace(deps, trimmed);

		if (defaultWorkspaceRoot) {
			const snapshot = deps.index.get(defaultWorkspaceRoot);
			if (snapshot) return { snapshot };
		}

		const active = deps.activeWorkspace();
		if (active) return { snapshot: active };

		return {
			error: errorPayload(
				"missing-parameter",
				"No workspace was given and no workspace is currently active " +
					"— this vault may not have a workspace yet.",
			),
		};
	}

	/* ------------------------------------------------------------ workspaces -- */

	server.registerTool(
		"list_workspaces",
		{
			description:
				"List every workspace in the vault. Every other tool's " +
				"`workspace` is optional — it defaults to the workspace " +
				"currently open in the Obsidian window, or whatever " +
				"`set_active_workspace` last set. Use this to discover a " +
				"workspace's name, or to address one that isn't the default.",
		},
		async () =>
			ok(
				pageList(
					deps.index
						.list()
						.map((snapshot) => workspaceRow(snapshot)),
				),
			),
	);

	server.registerTool(
		"set_active_workspace",
		{
			description:
				"Set the default workspace every other tool uses when " +
				"workspace is omitted, by name (or part of it) or by root " +
				"path. Stays in effect until changed again or this client's " +
				"session ends. Does not change what's open in the Obsidian " +
				"window — this only affects MCP tool calls.",
			inputSchema: {
				workspace: z
					.string()
					.describe("A workspace's name (or part of it), or its root folder path."),
			},
		},
		async ({ workspace }) => {
			const resolved = matchWorkspace(deps, workspace.trim());
			if ("error" in resolved) return fail(resolved.error);
			defaultWorkspaceRoot = resolved.snapshot.workspace.root;
			return ok(scopeOf(resolved.snapshot));
		},
	);

	server.registerTool(
		"get_workspace",
		{
			description:
				"The full shape of one workspace: its taxonomies (statuses, " +
				"priorities, task types, labels, people), plus summaries of its " +
				"projects, views and dashboards, with counts.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			return ok(workspaceDetail(resolved.snapshot));
		},
	);

	/* -------------------------------------------------------------- projects -- */

	server.registerTool(
		"list_projects",
		{
			description:
				"List a workspace's projects — id (its note path), title, status, " +
				"owner, dates and how many tasks each contains. Archived-only " +
				"hidden by default.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				status: z.string().optional().describe("A status id to filter by."),
				showArchived: z
					.boolean()
					.optional()
					.describe("Also include archived projects."),
			},
		},
		async ({ workspace, status, showArchived }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			return ok({
				...scopeOf(resolved.snapshot),
				...pageList(
					projectRows(resolved.snapshot, {
						status: status ?? undefined,
						archived: showArchived === true ? true : undefined,
					}),
				),
			});
		},
	);

	server.registerTool(
		"get_project",
		{
			description:
				"One project's detail: everything `list_projects` carries plus its " +
				"description text. `projectId` can be the path or the title.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				projectId: z
					.string()
					.describe("The project's note path, or its title."),
			},
		},
		async ({ workspace, projectId }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const query = projectId.trim();
			const project = resolved.snapshot.projects.find(
				(p) =>
					p.path === query ||
					p.title.toLocaleLowerCase() === query.toLocaleLowerCase(),
			);
			if (!project) {
				return fail(
					errorPayload(
						"unknown-project",
						`No project matches "${projectId}" in this workspace.`,
					),
				);
			}
			return ok(
				projectDetail(
					resolved.snapshot,
					project,
					deps.index.projectDescription(project.path),
				),
			);
		},
	);

	/* ---------------------------------------------------------------- tasks -- */

	server.registerTool(
		"list_tasks",
		{
			description:
				"List tasks in a workspace, optionally filtered with the Vertex " +
				"Flow query language (see the 'Saved Views' help topic, section " +
				"'Query language', for the full grammar). Examples: " +
				"`status:in-progress`, `assignee:Alice label:frontend`, " +
				"`project:\"Core App\" due:\"this week\"`, `parent:TSK-0012` (a " +
				"task's sub-tasks — get_task also returns this as `subtasksQuery` " +
				"when applicable), `is:open sort:due`. Sorting uses the query's " +
				"`sort:` clause faithfully (e.g. `sort:-due`, `sort:comments`, " +
				"`sort:subtasks`); without one, tasks stay in their manual rank " +
				"order. Rows are capped at 200; check `total`/`truncated` and " +
				"narrow the query if truncated. Archived tasks are hidden unless " +
				"`showArchived` is set.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				query: z
					.string()
					.optional()
					.describe("Query-language filter text; omit for all visible tasks."),
				showArchived: z
					.boolean()
					.optional()
					.describe("Include archived tasks."),
			},
		},
		async ({ workspace, query, showArchived }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const me = deps.me(resolved.snapshot.workspace.root);
			const source = (query ?? "").trim();
			if (source) {
				const parsed = parseQuery(source, queryContext(resolved.snapshot, me));
				if (!parsed.ok) {
					const issue = parsed.issues.find((i) => i.severity === "error");
					return fail(
						withHelpDocs(
							errorPayload(
								"invalid-query",
								issue
									? issue.message
									: `"${source}" didn't parse into a valid filter`,
							),
							"views-saved-views",
							"query-language",
						),
					);
				}
				const showArchive = showArchived === true;
				const rows = taskRows(
					resolved.snapshot,
					parsed.definition.filters,
					me,
					showArchive,
					{
						sortBy: parsed.definition.sortBy,
						sortDirection: parsed.definition.sortDirection,
						tableSort: parsed.definition.tableSort,
					},
				);
				return ok({ ...scopeOf(resolved.snapshot), ...pageList(rows) });
			}
			return ok({
				...scopeOf(resolved.snapshot),
				...pageList(
					taskRows(resolved.snapshot, {}, me, showArchived === true),
				),
			});
		},
	);

	server.registerTool(
		"get_task",
		{
			description:
				"One task's full detail: its summary, resolved names (status, " +
				"priority, label, assignee, parent, project, relations), " +
				"description text, recurrence and comments. `taskId` can be the " +
				"id (e.g. TSK-0012) or the note path. The result's `vaultUri` " +
				"deep-links into the plugin. When the task has sub-tasks, " +
				"`subtasksQuery` is a ready-to-use list_tasks query for them.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				taskId: z.string().describe("The task's id, or its note path."),
			},
		},
		async ({ workspace, taskId }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const query = taskId.trim();
			const task = resolved.snapshot.tasks.find(
				(t) => t.id === query || t.path === query,
			);
			if (!task) {
				return fail(
					errorPayload(
						"unknown-task",
						`No task matches "${taskId}" in this workspace.`,
					),
				);
			}
			let description = deps.index.taskDescription(task.path);
			let comments: Comment[] = [];
			const file = deps.io.getFile(task.path);
			if (file) {
				const body = await deps.io.readBody(file);
				if (body) {
					description = splitBody(body).description.trim() || description;
					comments = parseComments(body);
				}
			}
			const detail = taskDetail(
				resolved.snapshot,
				task,
				description,
				deps.me(resolved.snapshot.workspace.root),
			);
			return ok({
				...scopeOf(resolved.snapshot),
				...detail,
				...(comments.length > 0 ? { comments: commentRows(comments) } : {}),
			});
		},
	);

	/* ---------------------------------------------------------------- views -- */

	server.registerTool(
		"list_views",
		{
			description:
				"List a workspace's Saved Views — id, name, layout and sort. The " +
				"result's `vaultUri` opens each view in the plugin.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const rows = [...resolved.snapshot.views]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((v) => viewRow(resolved.snapshot.workspace.root, v));
			return ok({ ...scopeOf(resolved.snapshot), ...pageList(rows) });
		},
	);

	server.registerTool(
		"get_view",
		{
			description:
				"One Saved View's full definition: filters, grouping, sorting, " +
				"hidden fields and layout options, so a query can be reproduced " +
				"or extended.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				viewId: z.string().describe("The Saved View's id."),
			},
		},
		async ({ workspace, viewId }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const view = resolved.snapshot.views.find(
				(v) => v.id === viewId.trim(),
			);
			if (!view) {
				return fail(
					errorPayload(
						"unknown-view",
						`No Saved View matches "${viewId}" in this workspace.`,
					),
				);
			}
			return ok(viewDetail(resolved.snapshot.workspace.root, view));
		},
	);

	/* ------------------------------------------------------------ dashboards -- */

	server.registerTool(
		"list_dashboards",
		{
			description:
				"List a workspace's dashboards — id, name and widget count.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const rows = [...resolved.snapshot.dashboards]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((d) => dashboardRow(resolved.snapshot.workspace.root, d));
			return ok({ ...scopeOf(resolved.snapshot), ...pageList(rows) });
		},
	);

	server.registerTool(
		"get_dashboard",
		{
			description:
				"One dashboard's detail: its wide filter and per-widget chart types.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				dashboardId: z.string().describe("The dashboard's id."),
			},
		},
		async ({ workspace, dashboardId }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const dashboard = resolved.snapshot.dashboards.find(
				(d) => d.id === dashboardId.trim(),
			);
			if (!dashboard) {
				return fail(
					errorPayload(
						"unknown-dashboard",
						`No dashboard matches "${dashboardId}" in this workspace.`,
					),
				);
			}
			return ok(dashboardDetail(resolved.snapshot.workspace.root, dashboard));
		},
	);

	/* ---------------------------------------------------------------- labels -- */

	server.registerTool(
		"list_labels",
		{
			description:
				"List a workspace's labels — id, name, color and how many tasks " +
				"carry each.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const rows = [...labelRows(resolved.snapshot)].sort((a, b) =>
				a.name.localeCompare(b.name),
			);
			return ok({ ...scopeOf(resolved.snapshot), ...pageList(rows) });
		},
	);

	server.registerTool(
		"get_label",
		{
			description: "One label's detail plus its task count.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				labelId: z.string().describe("The label's id."),
			},
		},
		async ({ workspace, labelId }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			try {
				return ok(labelDetail(resolved.snapshot, labelId.trim()));
			} catch {
				return fail(
					errorPayload(
						"unknown-label",
						`No label matches "${labelId}" in this workspace.`,
					),
				);
			}
		},
	);

	/* ---------------------------------------------------------------- people -- */

	server.registerTool(
		"list_people",
		{
			description:
				"List a workspace's People register — id, name, aliases and how " +
				"many tasks each person is assigned.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const rows = [...personRows(resolved.snapshot)].sort((a, b) =>
				a.name.localeCompare(b.name),
			);
			return ok({ ...scopeOf(resolved.snapshot), ...pageList(rows) });
		},
	);

	server.registerTool(
		"get_person",
		{
			description: "One person's register entry and task tallies.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted — don't ask the user for " +
						"this; omit it, or call list_workspaces yourself if you need to " +
						"see the options.",
					),
				personId: z
					.string()
					.describe("The person's id — or their display name."),
			},
		},
		async ({ workspace, personId }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const haystack = personId.trim().toLocaleLowerCase();
			const person = resolved.snapshot.workspace.people.find(
				(p) =>
					p.id === haystack ||
					p.name.toLocaleLowerCase() === haystack ||
					(p.aliases ?? []).some(
						(a) => a.toLocaleLowerCase() === haystack,
					),
			);
			if (!person) {
				return fail(
					errorPayload(
						"unknown-person",
						`No person matches "${personId}" in this workspace.`,
					),
				);
			}
			return ok({
				...scopeOf(resolved.snapshot),
				...personDetail(resolved.snapshot, person.id),
			});
		},
	);

	/* ---------------------------------------------------------- analytics -- */

	server.registerTool(
		"count_tasks",
		{
			description:
				"Count tasks in a workspace — `total`, `open` (neither completed " +
				"nor canceled), `archived` — optionally broken down by status, " +
				"priority, task type, label, assignee or project via the `by` " +
				"array. Accepts the same query-language filter as list_tasks (e.g. " +
				"`assignee:me`, `due:\"this week\"`); the count is exact and " +
				"uncapped, unlike list_tasks' 200-row cap. Buckets use resolved " +
				"display names, and a task with no value lands in a `(none)` bucket.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
				query: z
					.string()
					.optional()
					.describe("Query-language filter text; omit to count all visible tasks."),
				showArchived: z
					.boolean()
					.optional()
					.describe("Include archived tasks in every count."),
				by: z
					.array(
						z.enum([
							"status",
							"priority",
							"taskType",
							"label",
							"assignee",
							"project",
						]),
					)
					.optional()
					.describe("Which breakdowns to include."),
			},
		},
		async ({ workspace, query, showArchived, by }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const me = deps.me(resolved.snapshot.workspace.root);
			const source = (query ?? "").trim();
			let filters: ViewFilters = {};
			if (source) {
				const parsed = parseQuery(source, queryContext(resolved.snapshot, me));
				if (!parsed.ok) {
					const issue = parsed.issues.find((i) => i.severity === "error");
					return fail(
						withHelpDocs(
							errorPayload(
								"invalid-query",
								issue
									? issue.message
									: `"${source}" didn't parse into a valid filter`,
							),
							"views-saved-views",
							"query-language",
						),
					);
				}
				filters = parsed.definition.filters;
			}
			return ok({
				...scopeOf(resolved.snapshot),
				...countTasks(
					resolved.snapshot,
					filters,
					me,
					showArchived === true,
					by ?? [],
				),
			});
		},
	);

	server.registerTool(
		"count_projects",
		{
			description:
				"Count a workspace's projects — `total`, `archived` — with an " +
				"optional per-status breakdown using the same status taxonomy " +
				"tasks use.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
				showArchived: z
					.boolean()
					.optional()
					.describe("Count archived projects too (they're excluded from `total` otherwise)."),
				byStatus: z
					.boolean()
					.optional()
					.describe("Add a per-status breakdown."),
			},
		},
		async ({ workspace, showArchived, byStatus }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			return ok({
				...scopeOf(resolved.snapshot),
				...countProjects(
					resolved.snapshot,
					showArchived === true,
					byStatus === true,
				),
			});
		},
	);

	server.registerTool(
		"get_summary",
		{
			description:
				"One workspace at a glance: task and project tallies (open / " +
				"completed / canceled / archived), subtasks, how many are overdue " +
				"and due today (against the user's local date), plus people, " +
				"labels, saved views, dashboards and recurring-task series. The " +
				"cheap, one-call answer to \"how is this workspace doing?\".",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			return ok({
				...scopeOf(resolved.snapshot),
				...getSummary(resolved.snapshot, deps.today()),
			});
		},
	);

	server.registerTool(
		"get_stats",
		{
			description:
				"Numeric health of a workspace: task counts by category, " +
				"estimates (sum and average), due-date coverage, overdue and " +
				"due-today counts, newest/oldest tasks by createdAt, the five " +
				"most-commented tasks, and a per-author comment tally. The extra " +
				"numbers get_summary leaves out.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			return ok({
				...scopeOf(resolved.snapshot),
				...getStats(
					resolved.snapshot,
					deps.today(),
					deps.index.commentCountsByPerson(resolved.snapshot.workspace.root),
				),
			});
		},
	);

	server.registerTool(
		"list_recurring",
		{
			description:
				"Every recurring-task series in a workspace: the parent task, " +
				"its trigger (on-date / on-close), frequency and interval, the " +
				"next projected occurrence date, how many occurrences the chain " +
				"has produced, a human-readable summary (e.g. \"every week, " +
				"starts today (on close)\") and a vaultUri to the note. See the " +
				"'Recurring tasks' help topic.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			return ok({
				...scopeOf(resolved.snapshot),
				...recurringRows(resolved.snapshot, deps.today()),
			});
		},
	);

	server.registerTool(
		"run_view",
		{
			description:
				"Evaluate a saved view exactly as the plugin renders it — the " +
				"same filter, sort and grouping engine, so \"what does the Board " +
				"show?\" gets one authoritative answer. Returns the matched tasks " +
				"(capped at 200, like list_tasks) plus the view's total and how " +
				"many it filtered out; `withGroups` adds the board columns with " +
				"their own capped lists. A view with the `show:recurring` " +
				"preview enabled includes projected future occurrences.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
				view: z
					.string()
					.describe("The saved view's id, or its name."),
				withGroups: z
					.boolean()
					.optional()
					.describe("Also return the grouped board/calendar/timeline breakdown."),
			},
		},
		async ({ workspace, view, withGroups }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const query = view.trim();
			const saved = resolved.snapshot.views.find(
				(v) =>
					v.id === query ||
					v.name.toLocaleLowerCase() === query.toLocaleLowerCase(),
			);
			if (!saved) {
				return fail(
					errorPayload(
						"unknown-view",
						`No saved view matches "${view}" in this workspace.`,
					),
				);
			}
			const me = deps.me(resolved.snapshot.workspace.root);
			return ok({
				...scopeOf(resolved.snapshot),
				...runView(
					resolved.snapshot,
					saved,
					me,
					deps.today(),
					withGroups === true,
				),
			});
		},
	);

	/* ----------------------------------------------------------- insights -- */

	server.registerTool(
		"find",
		{
			description:
				"Fuzzy-search a workspace by title, task id, description and " +
				"person-name alias — the same quick-switcher search as the " +
				"plugin's own palette. Returns ranked hits across tasks, " +
				"projects, views, dashboards, labels and people, each with a " +
				"`vaultUri` to jump straight to the note.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
				query: z.string().describe("Text to search for."),
			},
		},
		async ({ workspace, query }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const hits = searchWorkspace(resolved.snapshot, deps.index, query).map(
				(hit) => ({
					kind: hit.kind,
					id: hit.id,
					title: hit.title,
					taskId: hit.taskId,
					snippet: hit.snippet,
					icon: hit.icon,
					color: hit.color,
					personName: hit.personName,
					vaultUri: vaultUriForHit(hit, resolved.snapshot.workspace.root),
				}),
			);
			if (hits.length === 0) {
				return fail(
					errorPayload(
						"no-find-match",
						`Nothing in this workspace matched "${query}".`,
					),
				);
			}
			return ok({ ...scopeOf(resolved.snapshot), ...pageList(hits) });
		},
	);

	server.registerTool(
		"get_index_report",
		{
			description:
				"Diagnostics about the plugin's index cache: how many " +
				"workspaces are indexed, per-workspace entity counts, and every " +
				"note with parse issues (the \"issues\" badge). For spotting " +
				"workspaces whose files aren't loading cleanly — not part of " +
				"normal task questions.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
			},
		},
		async ({ workspace }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const issues = [...deps.index.allIssues().entries()].filter(([path]) =>
				path.startsWith(resolved.snapshot.workspace.root),
			);
			const detail = {
				...scopeOf(resolved.snapshot),
				revision: deps.index.revision,
				indexedNotePaths: resolved.snapshot.tasks.length + resolved.snapshot.projects.length,
				issues: {
					total: issues.reduce((sum, [, list]) => sum + list.length, 0),
					notes: issues.map(([path, list]) => ({ path, messages: list })),
				},
			};
			return ok(detail);
		},
	);

	server.registerTool(
		"search_descriptions",
		{
			description:
				"Search task descriptions across a workspace by substring or " +
				"regex (" + `\`${"..."}\`` + " described in the query-language " +
				"help topic). Description text comes from the plugin's index " +
				"cache, so results may lag an edit by a few seconds — no " +
				"additional note reads. Returns matched tasks with a snippet.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
				text: z
					.string()
					.describe("Plain substring, or a `/…/` wrapped pattern for regex."),
				project: z
					.string()
					.optional()
					.describe("Limit to a project by path or title."),
			},
		},
		async ({ workspace, text, project }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const needle = text.trim();
			if (!needle) {
				return fail(
					errorPayload("invalid-query", "`text` must not be empty."),
				);
			}
			const regexp = /^\/(.+)\/([a-z]*)$/.exec(needle);
			let pattern: RegExp;
			try {
				pattern = regexp
					? new RegExp(regexp[1], regexp[2])
					: new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
			} catch {
				return fail(
					errorPayload("invalid-query", `"${needle}" isn't a valid pattern.`),
				);
			}
			let projectPath: string | null = null;
			if (project && project.trim()) {
				const p = project.trim();
				const match = resolved.snapshot.projects.find(
					(pr) =>
						pr.path === p ||
						pr.title.toLocaleLowerCase() === p.toLocaleLowerCase(),
				);
				if (!match) {
					return fail(
						errorPayload(
							"unknown-project",
							`No project matches "${project}" in this workspace.`,
						),
					);
				}
				projectPath = match.path;
			}
			const matches: Array<{
				taskId: string;
				title: string;
				path: string;
				snippet: string;
				vaultUri: string;
			}> = [];
			for (const task of resolved.snapshot.tasks) {
				if (projectPath && task.project !== projectPath) continue;
				if (task.archived) continue;
				const description = deps.index.taskDescription(task.path);
				if (!description) continue;
				const hit = pattern.exec(description);
				if (!hit) continue;
				const start = Math.max(0, (hit.index ?? 0) - 80);
				const snippet =
					(start > 0 ? "…" : "") +
					description.slice(start, start + 200).replace(/\s+/g, " ").trim() +
					(start + 200 < description.length ? "…" : "");
				matches.push({
					taskId: task.id,
					title: task.title,
					path: task.path,
					snippet,
					vaultUri: buildVaultUri({
						action: "open-task",
						path: task.path,
						target: "vf",
					}),
				});
			}
			if (matches.length === 0) {
				return fail(
					errorPayload(
						"no-description-match",
						`No task description in this workspace matched "${text}".`,
					),
				);
			}
			return ok({ ...scopeOf(resolved.snapshot), ...pageList(matches) });
		},
	);

	server.registerTool(
		"read_dashboard",
		{
			description:
				"A dashboard's chart-ready data: the dashboard-wide filter " +
				"+ each widget's computed series (the same numbers the chart " +
				"renders), not just its config. Lets a model answer \"what does " +
				"the pie chart show?\" directly.",
			inputSchema: {
				workspace: z
					.string()
					.optional()
					.describe(
						"A workspace's name (or part of it), or its root folder path. " +
						"Defaults to the active workspace (or the one set via " +
						"set_active_workspace) when omitted.",
					),
				dashboardId: z
					.string()
					.describe("The dashboard's id, or its display name."),
			},
		},
		async ({ workspace, dashboardId }) => {
			const resolved = resolveWorkspace(workspace);
			if ("error" in resolved) return fail(resolved.error);
			const query = dashboardId.trim();
			const dashboard = resolved.snapshot.dashboards.find(
				(d) =>
					d.id === query ||
					d.name.toLocaleLowerCase() === query.toLocaleLowerCase(),
			);
			if (!dashboard) {
				return fail(
					errorPayload(
						"unknown-dashboard",
						`No dashboard matches "${dashboardId}" in this workspace.`,
					),
				);
			}
			const me = deps.me(resolved.snapshot.workspace.root);
			return ok({
				...scopeOf(resolved.snapshot),
				...readDashboard(resolved.snapshot, dashboard, me),
			});
		},
	);

	/* ------------------------------------------------------------------ help -- */

	server.registerTool(
		"search_help_docs",
		{
			description:
				"Search the plugin's Help documentation. Returns ranked topic ids, " +
				"titles, their breadcrumb path (e.g. two ids deep under " +
				"\"concepts\"), and a vaultUri that opens the topic in the Help " +
				"pane. Follow up with get_help_topic to read one. Use this before " +
				"answering questions about the query language, commands, views or " +
				"config — the docs are authoritative.",
			inputSchema: {
				query: z
					.string()
					.describe("A free-text description of what you need."),
			},
		},
		async ({ query }) => {
			const hits = searchHelp(query);
			if (hits.length === 0) {
				return fail(
					errorPayload(
						"no-help-match",
						`Nothing in the help docs matched "${query}".`,
					),
				);
			}
			return ok({ matches: hits });
		},
	);

	server.registerTool(
		"get_help_topic",
		{
			description:
				"The full markdown of one help topic, by id (from search_help_docs " +
				"or this plugin's docs). Includes the topic's breadcrumb path, " +
				"a vaultUri that opens it in the Help pane, and `anchors` — the " +
				"heading slugs you can append to vaultUri's `anchor` param to " +
				"deep-link straight to a section. Long topics are truncated to " +
				"keep the response sized.",
			inputSchema: {
				topicId: z
					.string()
					.describe("A topic id returned by search_help_docs."),
			},
		},
		async ({ topicId }) => {
			const topic = getHelpTopic(topicId.trim());
			if (!topic) {
				return fail(
					errorPayload(
						"unknown-topic",
						`No help topic "${topicId}" exists.`,
					),
				);
			}
			if (topic.content.length > MAX_DETAIL_DOC_CHARS) {
				topic.content =
					topic.content.slice(0, MAX_DETAIL_DOC_CHARS) +
					"\n…[truncated]";
			}
			return ok(topic);
		},
	);

	return server;
}