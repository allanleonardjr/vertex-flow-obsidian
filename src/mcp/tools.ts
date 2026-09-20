/**
 * MCP tool registration — the 16-tool read-only surface.
 *
 * Thin glue over the pure builders in `src/core/mcp/`: each tool validates its
 * inputs (a workspace must exist, a query must parse, a topic must be found),
 * pulls the one extra piece of I/O core can't reach (note bodies for a task's
 * comments / description), and wraps the resulting payload. Every tool returns
 * JSON in a text block; invalid input is an `isError` result with a message the
 * model can act on — never an MCP protocol-level error.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Comment } from "../core/types";
import type { NoteIO } from "../obsidian/note-io";
import type { VaultIndex } from "../obsidian/index-store";
import { queryContext } from "../core/query";
import { parseQuery } from "../core/query/parse";
import { parseComments, splitBody } from "../core/serialization/comments";
import {
	commentRows,
	dashboardDetail,
	dashboardRow,
	errorPayload,
	labelDetail,
	labelRows,
	pageList,
	personDetail,
	personRows,
	projectDetail,
	projectRows,
	taskDetail,
	taskRows,
	viewDetail,
	viewRow,
	workspaceDetail,
	workspaceRow,
} from "../core/mcp/responses";
import { getHelpTopic, searchHelp } from "../core/mcp/help";
import type { McpErrorPayload } from "../core/mcp/responses";

export interface McpDeps {
	index: VaultIndex;
	io: NoteIO;
	version: string;
	/** Resolve the device's "me" person for a workspace, for `self:` filters. */
	me: (root: string) => string | null;
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

function unknownWorkspace(root: string) {
	return errorPayload("unknown-workspace", `No workspace exists at "${root}".`);
}

type WorkspaceSnapshot = NonNullable<ReturnType<VaultIndex["get"]>>;

/** Snapshot a tool's `workspaceId` resolves against, or an error payload. */
function resolveWorkspace(
	deps: McpDeps,
	workspaceId: string | undefined,
): { snapshot: WorkspaceSnapshot } | { error: McpErrorPayload } {
	const root = workspaceId?.trim();
	if (!root) {
		return {
			error: errorPayload("missing-parameter", "workspaceId is required."),
		};
	}
	const snapshot = deps.index.get(root);
	if (!snapshot) return { error: unknownWorkspace(root) };
	return { snapshot };
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

export function createMcpServer(deps: McpDeps): McpServer {
	const server = new McpServer(
		{ name: "vertex-flow", version: deps.version },
		{ capabilities: { tools: {} } },
	);

	/* ------------------------------------------------------------ workspaces -- */

	server.registerTool(
		"list_workspaces",
		{
			description:
				"List every workspace in the vault. Discovery is always step one — " +
				"most other tools take a `workspaceId` (the workspace's root " +
				"folder path).",
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
		"get_workspace",
		{
			description:
				"The full shape of one workspace: its taxonomies (statuses, " +
				"priorities, task types, labels, people), plus summaries of its " +
				"projects, views and dashboards, with counts.",
			inputSchema: {
				workspaceId: z.string().describe("The workspace's root folder path."),
			},
		},
		async ({ workspaceId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
				status: z.string().optional().describe("A status id to filter by."),
				showArchived: z
					.boolean()
					.optional()
					.describe("Also include archived projects."),
			},
		},
		async ({ workspaceId, status, showArchived }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
				projectId: z
					.string()
					.describe("The project's note path, or its title."),
			},
		},
		async ({ workspaceId, projectId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				"`project:\"Core App\" due:\"this week\"`, `is:open sort:due`. Rows " +
				"are capped at 200; check `total`/`truncated` and narrow the query " +
				"if truncated. Archived tasks are hidden unless `showArchived` is set.",
			inputSchema: {
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
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
		async ({ workspaceId, query, showArchived }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
			if ("error" in resolved) return fail(resolved.error);
			const me = deps.me(resolved.snapshot.workspace.root);
			const source = (query ?? "").trim();
			if (source) {
				const parsed = parseQuery(source, queryContext(resolved.snapshot, me));
				if (!parsed.ok) {
					const issue = parsed.issues.find((i) => i.severity === "error");
					return fail(
						errorPayload(
							"invalid-query",
							issue
								? issue.message
								: `"${source}" didn't parse into a valid filter`,
						),
					);
				}
				return ok({
					...scopeOf(resolved.snapshot),
					...pageList(
						taskRows(
							resolved.snapshot,
							parsed.definition.filters,
							me,
							showArchived === true,
						),
					),
				});
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
				"deep-links into the plugin.",
			inputSchema: {
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
				taskId: z.string().describe("The task's id, or its note path."),
			},
		},
		async ({ workspaceId, taskId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
			},
		},
		async ({ workspaceId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
				viewId: z.string().describe("The Saved View's id."),
			},
		},
		async ({ workspaceId, viewId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
			},
		},
		async ({ workspaceId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
				dashboardId: z.string().describe("The dashboard's id."),
			},
		},
		async ({ workspaceId, dashboardId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
			},
		},
		async ({ workspaceId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
				labelId: z.string().describe("The label's id."),
			},
		},
		async ({ workspaceId, labelId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
			},
		},
		async ({ workspaceId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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
				workspaceId: z
					.string()
					.describe("The workspace's root folder path."),
				personId: z
					.string()
					.describe("The person's id — or their display name."),
			},
		},
		async ({ workspaceId, personId }) => {
			const resolved = resolveWorkspace(deps, workspaceId);
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

	/* ------------------------------------------------------------------ help -- */

	server.registerTool(
		"search_help_docs",
		{
			description:
				"Search the plugin's Help documentation. Returns ranked topic ids " +
				"and titles; follow up with get_help_topic to read one. Use this " +
				"before answering questions about the query language, commands, " +
				"views or config — the docs are authoritative.",
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
				"or this plugin's docs). Long topics are truncated to keep the " +
				"response sized.",
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