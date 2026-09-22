import { describe, expect, it } from "vitest";
import {
	bubblesToWireMessages,
	buildLocalChatSystemPrompt,
	DEFAULT_LOCAL_SERVER_BASE_URL,
	describeLocalServerError,
	effectiveAiProvider,
	extractResultRows,
	LOCAL_SERVER_PRESETS,
	mcpToolsToOpenAiTools,
	normalizeBaseUrl,
	pickModelId,
	presetForUrl,
	toLocalServerErrorLike,
	truncateToolResult,
	workspaceFromSetActiveResult,
	type LocalChatWireMessage,
} from "../../src/core/ai/local-server";

describe("effectiveAiProvider", () => {
	it("honours local-server only on desktop", () => {
		expect(effectiveAiProvider("local-server", true)).toBe("local-server");
		expect(effectiveAiProvider("local-server", false)).toBe("builtin");
		expect(effectiveAiProvider("builtin", true)).toBe("builtin");
		expect(effectiveAiProvider(undefined, true)).toBe("builtin");
	});
});

describe("presets", () => {
	it("lists the five presets, LM Studio first as the default", () => {
		expect(LOCAL_SERVER_PRESETS.map((p) => p.id)).toEqual([
			"lm-studio",
			"ollama",
			"jan",
			"llama-cpp",
			"custom",
		]);
		expect(LOCAL_SERVER_PRESETS[0].baseUrl).toBe(DEFAULT_LOCAL_SERVER_BASE_URL);
		expect(LOCAL_SERVER_PRESETS.find((p) => p.id === "custom")?.baseUrl).toBeNull();
	});

	it("derives the preset from the stored URL, ignoring trailing slashes", () => {
		expect(presetForUrl("http://localhost:1234/v1")).toBe("lm-studio");
		expect(presetForUrl("http://localhost:11434/v1/")).toBe("ollama");
		expect(presetForUrl("http://localhost:1337/v1")).toBe("jan");
		expect(presetForUrl("http://localhost:8080/v1")).toBe("llama-cpp");
		expect(presetForUrl("http://192.168.1.5:1234/v1")).toBe("custom");
		expect(presetForUrl("http://localhost:1234")).toBe("custom");
	});
});

describe("normalizeBaseUrl", () => {
	it("trims and strips trailing slashes", () => {
		expect(normalizeBaseUrl("  http://localhost:1234/v1/ ")).toEqual({ url: "http://localhost:1234/v1" });
	});

	it("accepts https and a URL without /v1 as typed", () => {
		expect(normalizeBaseUrl("https://llm.example.com")).toEqual({ url: "https://llm.example.com" });
	});

	it("rejects empty, malformed and non-http URLs", () => {
		expect("error" in normalizeBaseUrl("")).toBe(true);
		expect("error" in normalizeBaseUrl("localhost:1234")).toBe(true);
		expect("error" in normalizeBaseUrl("not a url")).toBe(true);
		expect("error" in normalizeBaseUrl("ftp://localhost/v1")).toBe(true);
	});
});

describe("pickModelId", () => {
	it("keeps the saved model while it's listed", () => {
		expect(pickModelId("b", ["a", "b"])).toBe("b");
	});

	it("falls back to the first model, then to null", () => {
		expect(pickModelId("gone", ["a", "b"])).toBe("a");
		expect(pickModelId("", ["a"])).toBe("a");
		expect(pickModelId("a", [])).toBeNull();
	});
});

describe("describeLocalServerError", () => {
	const base = "http://localhost:1234/v1";

	it("explains a refused connection with the LM Studio / Bionic guidance", () => {
		const text = describeLocalServerError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }, base);
		expect(text).toContain(`Nothing is answering at ${base}`);
		expect(text).toContain("Local Model API → Local API server");
	});

	it("explains a 404 as a missing /v1", () => {
		expect(describeLocalServerError({ status: 404, message: "Not Found" }, base)).toBe(
			"The server answered but has no /chat/completions here. The base URL usually ends in /v1.",
		);
	});

	it("explains 401 and 403 as an API key problem", () => {
		for (const status of [401, 403]) {
			expect(describeLocalServerError({ status, message: "nope" }, base)).toBe(
				"The server rejected the request. Check the API key.",
			);
		}
	});

	it("passes anything else through", () => {
		expect(describeLocalServerError({ status: 500, message: "Model crashed" }, base)).toBe("Model crashed");
	});

	it("reads the code from an AggregateError's first inner error", () => {
		const aggregate = Object.assign(new Error("connect failed"), {
			errors: [{ code: "ECONNREFUSED" }],
		});
		expect(toLocalServerErrorLike(aggregate).code).toBe("ECONNREFUSED");
		expect(toLocalServerErrorLike(Object.assign(new Error("x"), { status: 404 })).status).toBe(404);
		expect(toLocalServerErrorLike("plain")).toEqual({ message: "plain" });
	});
});

describe("mcpToolsToOpenAiTools", () => {
	it("wraps each tool and passes its schema through", () => {
		const schema = { type: "object", properties: { query: { type: "string" } } };
		expect(
			mcpToolsToOpenAiTools([
				{ name: "list_tasks", description: "List tasks", inputSchema: schema },
				{ name: "list_workspaces" },
			]),
		).toEqual([
			{ type: "function", function: { name: "list_tasks", description: "List tasks", parameters: schema } },
			{ type: "function", function: { name: "list_workspaces", parameters: { type: "object", properties: {} } } },
		]);
	});
});

describe("truncateToolResult", () => {
	it("leaves short results alone", () => {
		expect(truncateToolResult("abc", 10)).toBe("abc");
	});

	it("cuts long results with a note saying how much was dropped", () => {
		expect(truncateToolResult("abcdefghij", 4)).toBe(
			"abcd…[truncated: 6 more characters. Narrow the filters to see the rest]",
		);
	});
});

describe("extractResultRows", () => {
	const workspace = { id: "Work", name: "Work" };

	it("reads task paths from list_tasks and run_view", () => {
		const text = JSON.stringify({
			workspace,
			results: [{ path: "Work/Tasks/W-1.md" }, { path: "Work/Tasks/W-2.md" }],
			total: 2,
		});
		const expected = { kind: "tasks", workspaceRoot: "Work", paths: ["Work/Tasks/W-1.md", "Work/Tasks/W-2.md"] };
		expect(extractResultRows("list_tasks", text)).toEqual(expected);
		expect(extractResultRows("run_view", text)).toEqual(expected);
	});

	it("reads project note paths from list_projects' id field", () => {
		const text = JSON.stringify({ workspace, results: [{ id: "Work/Projects/Launch.md", title: "Launch" }] });
		expect(extractResultRows("list_projects", text)).toEqual({
			kind: "projects",
			workspaceRoot: "Work",
			paths: ["Work/Projects/Launch.md"],
		});
	});

	it("ignores other tools and unparseable or unscoped results", () => {
		expect(extractResultRows("get_summary", JSON.stringify({ workspace, results: [] }))).toBeNull();
		expect(extractResultRows("list_tasks", "not json")).toBeNull();
		expect(extractResultRows("list_tasks", JSON.stringify({ results: [] }))).toBeNull();
	});
});

describe("workspaceFromSetActiveResult", () => {
	it("reads the switched-to root", () => {
		expect(workspaceFromSetActiveResult(JSON.stringify({ workspace: { id: "Home", name: "Home" } }))).toBe("Home");
		expect(workspaceFromSetActiveResult('{"error":"unknown-workspace"}')).toBeNull();
		expect(workspaceFromSetActiveResult("oops")).toBeNull();
	});
});

describe("buildLocalChatSystemPrompt", () => {
	it("names the workspace and today's date", () => {
		const prompt = buildLocalChatSystemPrompt({ workspaceName: "Product Team", today: "2026-09-22" });
		expect(prompt).toContain('"Product Team"');
		expect(prompt).toContain("2026-09-22");
		expect(prompt).toContain("set_active_workspace");
		expect(prompt).toContain("search_help_docs");
	});
});

describe("bubblesToWireMessages", () => {
	it("replays each turn's tool exchange before its final text, and skips error bubbles", () => {
		const wire: LocalChatWireMessage[] = [
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "c1", type: "function", function: { name: "list_tasks", arguments: "{}" } }],
			},
			{ role: "tool", tool_call_id: "c1", content: "{}" },
		];
		expect(
			bubblesToWireMessages(
				[
					{ role: "user", content: "what's overdue?" },
					{ role: "assistant", content: "Two tasks.", wire },
					{ role: "user", content: "and now?" },
					{ role: "assistant", content: "Nothing is answering.", error: true },
					{ role: "user", content: "again" },
				],
				"SYSTEM",
			),
		).toEqual([
			{ role: "system", content: "SYSTEM" },
			{ role: "user", content: "what's overdue?" },
			...wire,
			{ role: "assistant", content: "Two tasks." },
			{ role: "user", content: "and now?" },
			{ role: "user", content: "again" },
		]);
	});
});
