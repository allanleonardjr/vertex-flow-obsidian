/**
 * AI Chat's private, in-process copy of the MCP tool surface — the same 27
 * read-only tools the HTTP MCP server exposes (`createMcpServer`), connected
 * to an MCP client through the SDK's `InMemoryTransport` pair. Nothing goes
 * over HTTP, and it works whether or not the MCP server setting is on. One
 * bridge backs one chat conversation, so `set_active_workspace` here only
 * moves the chat's own default workspace, never the pane's or another
 * client's.
 *
 * Mobile safety: the same pattern as `src/mcp/server.ts`. `createMcpBridge`
 * checks `Platform.isDesktop` as its first statement, and the SDK and
 * `../mcp/tools` are loaded through dynamic `import()` after it, so nothing
 * SDK-related is evaluated on mobile. The type-only imports below are erased
 * at build time.
 */

import { Platform } from "obsidian";
import type { McpToolSummary } from "../core/ai/local-server";
import type { McpDeps } from "../mcp/tools";

export interface McpBridge {
	/** Every tool's name, description and JSON Schema — fetched once, then cached. */
	listTools(): Promise<McpToolSummary[]>;
	/** Runs one tool. Never rejects: a thrown error comes back as `{ text: message, isError: true }`. */
	callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
	close(): Promise<void>;
}

/** `deps` is built like the HTTP server's (`VertexFlowPlugin.mcpToolDeps`), except `activeWorkspace` is the chat's own workspace. */
export async function createMcpBridge(deps: McpDeps): Promise<McpBridge> {
	if (!Platform.isDesktop) {
		throw new Error("AI Chat's local model server mode is only available in Obsidian on desktop.");
	}

	const [{ createMcpServer }, { InMemoryTransport }, { Client }] = await Promise.all([
		import("../mcp/tools"),
		import("@modelcontextprotocol/sdk/inMemory.js"),
		import("@modelcontextprotocol/sdk/client/index.js"),
	]);

	const server = createMcpServer(deps);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "vertex-flow-ai-chat", version: deps.version });
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	let tools: Promise<McpToolSummary[]> | null = null;

	const fetchTools = async (): Promise<McpToolSummary[]> => {
		const all: McpToolSummary[] = [];
		let cursor: string | undefined;
		do {
			const page = await client.listTools(cursor ? { cursor } : undefined);
			for (const tool of page.tools) {
				all.push({
					name: tool.name,
					...(tool.description ? { description: tool.description } : {}),
					inputSchema: tool.inputSchema,
				});
			}
			cursor = page.nextCursor;
		} while (cursor);
		return all;
	};

	return {
		listTools() {
			tools ??= fetchTools().catch((error: unknown) => {
				// Don't cache a failure — the next turn gets a fresh attempt.
				tools = null;
				throw error;
			});
			return tools;
		},
		async callTool(name, args) {
			try {
				const result = await client.callTool({ name, arguments: args });
				const blocks = Array.isArray(result.content) ? (result.content as unknown[]) : [];
				const text = blocks
					.filter(
						(block): block is { type: "text"; text: string } =>
							block != null &&
							typeof block === "object" &&
							(block as { type?: unknown }).type === "text" &&
							typeof (block as { text?: unknown }).text === "string",
					)
					.map((block) => block.text)
					.join("\n");
				return { text, isError: result.isError === true };
			} catch (error) {
				return {
					text: error instanceof Error ? error.message : String(error),
					isError: true,
				};
			}
		},
		async close() {
			await client.close().catch(() => undefined);
			await server.close().catch(() => undefined);
		},
	};
}
