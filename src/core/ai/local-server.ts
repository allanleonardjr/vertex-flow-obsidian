/**
 * Pure building blocks for AI Chat's "local model server" provider — an
 * OpenAI-compatible server the user runs themselves (LM Studio, Ollama, Jan,
 * llama.cpp server, or any custom URL) that answers with native tool calls
 * against the same read-only tool surface as the MCP server.
 *
 * Everything here is plain data in, plain data out: no Obsidian API, no Node
 * builtins, no MCP SDK, no WebLLM (Golden Rule). The Node HTTP client
 * (`src/ai/local-server-client.ts`) and the in-process MCP bridge
 * (`src/ai/mcp-bridge.ts`) are the desktop-only halves that use these.
 */

export type AiProvider = "builtin" | "local-server";

/** LM Studio's (and LM Studio Bionic's) default — the most common local server, so the default for everyone. */
export const DEFAULT_LOCAL_SERVER_BASE_URL = "http://localhost:1234/v1";

/** How many model rounds one user message may take before the tool loop gives up. */
export const MAX_TOOL_ROUNDS = 8;

/**
 * The provider actually in effect. Local server needs Node's `http` module,
 * so it only exists on desktop; `data.json` syncs across devices, so a phone
 * can read `"local-server"` from settings saved on a laptop — that's treated
 * as builtin here without rewriting the stored value.
 */
export function effectiveAiProvider(stored: AiProvider | undefined, isDesktop: boolean): AiProvider {
	return isDesktop && stored === "local-server" ? "local-server" : "builtin";
}

/* --------------------------------------------------------------- presets -- */

export type LocalServerPresetId = "lm-studio" | "ollama" | "jan" | "llama-cpp" | "custom";

export interface LocalServerPreset {
	id: LocalServerPresetId;
	label: string;
	/** `null` for Custom — whatever the user types. */
	baseUrl: string | null;
}

/** Presets only ever fill in the base URL — the URL is the one thing stored. */
export const LOCAL_SERVER_PRESETS: LocalServerPreset[] = [
	{ id: "lm-studio", label: "LM Studio / Bionic", baseUrl: DEFAULT_LOCAL_SERVER_BASE_URL },
	{ id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1" },
	{ id: "jan", label: "Jan", baseUrl: "http://localhost:1337/v1" },
	{ id: "llama-cpp", label: "llama.cpp server", baseUrl: "http://localhost:8080/v1" },
	{ id: "custom", label: "Custom", baseUrl: null },
];

function stripTrailingSlashes(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

/** The preset a stored URL corresponds to — an exact (trailing-slash-insensitive) match, otherwise Custom. */
export function presetForUrl(url: string): LocalServerPresetId {
	const needle = stripTrailingSlashes(url);
	const match = LOCAL_SERVER_PRESETS.find(
		(preset) => preset.baseUrl != null && preset.baseUrl === needle,
	);
	return match?.id ?? "custom";
}

/**
 * Validates a typed base URL: trimmed, `http:`/`https:` only, trailing `/`
 * stripped. A URL without `/v1` is accepted as typed — some proxies mount the
 * API elsewhere — and never silently rewritten; if it's wrong, the 404 from
 * Test connection explains the usual fix (`describeLocalServerError`).
 */
export function normalizeBaseUrl(input: string): { url: string } | { error: string } {
	const trimmed = input.trim();
	if (!trimmed) return { error: "Enter the server's base URL, e.g. http://localhost:1234/v1." };
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { error: "That isn't a valid URL. It should look like http://localhost:1234/v1." };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { error: "The URL must start with http:// or https://." };
	}
	return { url: stripTrailingSlashes(trimmed) };
}

/** The saved model if the server still lists it, else the first listed model, else `null` (nothing listed). */
export function pickModelId(saved: string, available: string[]): string | null {
	if (saved && available.includes(saved)) return saved;
	return available[0] ?? null;
}

/* ------------------------------------------------------------- reasoning -- */

/**
 * How much a model reasons before answering, or `"default"` to send nothing
 * and leave it to the server/model. There's no `minimal`/`on`/`xhigh` — see
 * `reasoningRequestFields` for why `off` isn't just another effort level.
 */
export type ReasoningLevel = "default" | "off" | "low" | "medium" | "high";

/** In the order shown in the composer's Reasoning select. */
export const REASONING_LEVELS: { id: ReasoningLevel; label: string }[] = [
	{ id: "default", label: "Default" },
	{ id: "off", label: "Off" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
];

const REASONING_LEVEL_IDS = new Set(REASONING_LEVELS.map((level) => level.id));

/**
 * The stored per-model reasoning choice, tolerant of a malformed or
 * hand-edited `data.json`: a non-object `saved`, a missing entry, an unknown
 * string, or a `null` `modelId` all fall back to `"default"` rather than
 * throwing.
 */
export function reasoningLevelFor(
	saved: Record<string, unknown> | undefined,
	modelId: string | null,
): ReasoningLevel {
	if (!saved || typeof saved !== "object" || modelId == null) return "default";
	const value = saved[modelId];
	return typeof value === "string" && REASONING_LEVEL_IDS.has(value as ReasoningLevel)
		? (value as ReasoningLevel)
		: "default";
}

/**
 * The request fields a reasoning level maps to, server-preset-aware for
 * `off` — there's no single standard field every OpenAI-compatible server
 * honors for disabling reasoning outright:
 * - `default` sends nothing;
 * - `low`/`medium`/`high` send the standard `reasoning_effort`;
 * - `off` sends `reasoning_effort: "off"` for LM Studio / Bionic (their own
 *   vocabulary), or `reasoning_effort: "none"` plus the non-standard
 *   `chat_template_kwargs.enable_thinking: false` (vLLM/llama.cpp/NIM-style)
 *   for every other preset, including Custom.
 */
export function reasoningRequestFields(
	level: ReasoningLevel,
	preset: LocalServerPresetId,
): Record<string, unknown> {
	if (level === "default") return {};
	if (level !== "off") return { reasoning_effort: level };
	if (preset === "lm-studio") return { reasoning_effort: "off" };
	return { reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } };
}

/* ---------------------------------------------------------------- errors -- */

/** The error shape the Node client produces: a socket error `code`, an HTTP `status`, or just a message. */
export interface LocalServerErrorLike {
	code?: string;
	status?: number;
	message: string;
}

/**
 * Reads `code`/`status`/`message` off whatever was thrown. Node reports a
 * refused connection to a dual-stack host (`localhost` → `::1` and
 * `127.0.0.1`) as an `AggregateError` whose own `code` may be missing, so the
 * first inner error's code is used as a fallback.
 */
export function toLocalServerErrorLike(error: unknown): LocalServerErrorLike {
	if (error == null || typeof error !== "object") return { message: String(error) };
	const record = error as {
		code?: unknown;
		status?: unknown;
		message?: unknown;
		errors?: unknown;
	};
	let code = typeof record.code === "string" ? record.code : undefined;
	if (!code && Array.isArray(record.errors)) {
		const inner = record.errors[0] as { code?: unknown } | undefined;
		if (inner && typeof inner.code === "string") code = inner.code;
	}
	return {
		...(code ? { code } : {}),
		...(typeof record.status === "number" ? { status: record.status } : {}),
		message:
			typeof record.message === "string" && record.message
				? record.message
				: "The local model server request failed.",
	};
}

/** A user-facing explanation of a local server failure, pointing at the usual fix. */
export function describeLocalServerError(error: LocalServerErrorLike, baseUrl: string): string {
	if (error.code === "ECONNREFUSED") {
		return (
			`Nothing is answering at ${baseUrl}. Turn on the local API server in LM Studio or Bionic ` +
			"(Local Model API → Local API server), start Ollama/Jan/llama.cpp, or check the port."
		);
	}
	if (error.status === 404) {
		return "The server answered but has no /chat/completions here. The base URL usually ends in /v1.";
	}
	if (error.status === 401 || error.status === 403) {
		return "The server rejected the request. Check the API key.";
	}
	return error.message;
}

/* ----------------------------------------------------------------- tools -- */

/** One tool as the MCP client lists it. */
export interface McpToolSummary {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

/** One tool in OpenAI `tools` request format. */
export interface OpenAiTool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters: Record<string, unknown>;
	};
}

/** MCP tool listings → the OpenAI `tools` array. The JSON Schema passes straight through. */
export function mcpToolsToOpenAiTools(tools: McpToolSummary[]): OpenAiTool[] {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			...(tool.description ? { description: tool.description } : {}),
			parameters: tool.inputSchema ?? { type: "object", properties: {} },
		},
	}));
}

/**
 * Caps a tool result before it goes to the model — a 200-row `list_tasks`
 * can be larger than a small model's whole context window. Only the model's
 * copy is cut; the UI keeps the full text for `extractResultRows`.
 */
export function truncateToolResult(text: string, maxChars = 24_000): string {
	if (text.length <= maxChars) return text;
	const dropped = text.length - maxChars;
	return `${text.slice(0, maxChars)}…[truncated: ${dropped} more characters. Narrow the filters to see the rest]`;
}

export interface ToolResultRows {
	kind: "tasks" | "projects";
	workspaceRoot: string;
	paths: string[];
}

const TASK_ROW_TOOLS = new Set(["list_tasks", "run_view"]);
const PROJECT_ROW_TOOLS = new Set(["list_projects"]);

function parseObject(text: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(text);
		return value != null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function workspaceIdOf(payload: Record<string, unknown>): string | null {
	const workspace = payload.workspace as { id?: unknown } | undefined;
	return workspace && typeof workspace.id === "string" ? workspace.id : null;
}

/**
 * The clickable rows a tool result should render under the answer:
 * `list_tasks`/`run_view` rows carry `path`, `list_projects` rows carry the
 * project's note path as `id` (`McpProjectRow`). Any other tool, or a result
 * that isn't the expected JSON, yields `null`.
 */
export function extractResultRows(toolName: string, resultText: string): ToolResultRows | null {
	const isTasks = TASK_ROW_TOOLS.has(toolName);
	if (!isTasks && !PROJECT_ROW_TOOLS.has(toolName)) return null;
	const payload = parseObject(resultText);
	if (!payload) return null;
	const workspaceRoot = workspaceIdOf(payload);
	if (workspaceRoot == null || !Array.isArray(payload.results)) return null;
	const field = isTasks ? "path" : "id";
	const paths = payload.results
		.map((row) => (row != null && typeof row === "object" ? (row as Record<string, unknown>)[field] : null))
		.filter((path): path is string => typeof path === "string");
	return { kind: isTasks ? "tasks" : "projects", workspaceRoot, paths };
}

/**
 * A tool call's raw `arguments` text → the object to call it with. Empty text
 * means "no arguments" (some servers send `""` for a parameterless call).
 * Invalid or non-object JSON yields an error message written for the model,
 * so it can correct itself on the next round rather than the call running
 * with made-up arguments.
 */
export function parseToolArguments(
	name: string,
	text: string,
): { args: Record<string, unknown> } | { error: string } {
	if (!text.trim()) return { args: {} };
	try {
		const value: unknown = JSON.parse(text);
		if (value != null && typeof value === "object" && !Array.isArray(value)) {
			return { args: value as Record<string, unknown> };
		}
	} catch {
		// Fall through to the shared error below.
	}
	return {
		error: `Error: the arguments for ${name || "this tool"} weren't a valid JSON object, so it wasn't run. Call it again with a JSON object matching its parameters.`,
	};
}

/** The workspace root a successful `set_active_workspace` result switched to. */
export function workspaceFromSetActiveResult(resultText: string): string | null {
	const payload = parseObject(resultText);
	return payload ? workspaceIdOf(payload) : null;
}

/* ------------------------------------------------------------ the prompt -- */

export function buildLocalChatSystemPrompt({
	workspaceName,
	today,
}: {
	workspaceName: string;
	today: string;
}): string {
	return [
		"You are an assistant embedded in Vertex Flow, a task manager inside Obsidian.",
		`The current workspace is "${workspaceName}". Tools default to it when you omit their workspace parameter.`,
		"Use the tools for any question about tasks, projects, views, dashboards, labels, people or counts. Never guess or invent workspace data.",
		'For "how do I…" questions about the app itself, use search_help_docs and get_help_topic.',
		"When the user asks to switch workspaces, call set_active_workspace. For a one-off question about another workspace, pass its name as the workspace parameter instead of switching.",
		`Today is ${today}.`,
		"Answer concisely in Markdown. Task and project lists you fetched are shown to the user as clickable rows under your answer, so summarize them rather than repeating every row.",
	].join("\n");
}

/* ------------------------------------------------------- wire messages -- */

export interface WireToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

/** One message in an OpenAI `/chat/completions` request. */
export type LocalChatWireMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

/** The subset of a chat bubble the request history is built from. */
export interface WireBubble {
	role: "user" | "assistant";
	content: string;
	/** The assistant-with-`tool_calls` and `tool` messages this turn produced, before its final text. */
	wire?: LocalChatWireMessage[];
	/** An error bubble is shown to the user but never replayed to the model. */
	error?: boolean;
}

/** Rebuilds the full request history: system prompt, then every turn with its tool exchange replayed in order. */
export function bubblesToWireMessages(
	bubbles: WireBubble[],
	systemPrompt: string,
): LocalChatWireMessage[] {
	const messages: LocalChatWireMessage[] = [{ role: "system", content: systemPrompt }];
	for (const bubble of bubbles) {
		if (bubble.role === "user") {
			messages.push({ role: "user", content: bubble.content });
			continue;
		}
		if (bubble.error) continue;
		messages.push(...(bubble.wire ?? []));
		messages.push({ role: "assistant", content: bubble.content });
	}
	return messages;
}
