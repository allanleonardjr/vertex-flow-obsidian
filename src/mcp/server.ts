/**
 * Local MCP server — a single-host, token-gated Streamable HTTP endpoint.
 *
 * Binds `127.0.0.1` only, so nothing outside this computer can reach it. Every
 * request must carry `Authorization: Bearer <token>` (token lives in
 * `localStorage`, regenerated via Settings; the plugin pre-generates one on
 * first start). `.tool()` results are JSON, and all tools are read-only.
 *
 * The route surface is the MCP Streamable HTTP convention:
 *   POST /mcp            initialize a session, then call tools
 *   GET  /mcp            SSE transport (used by some clients / MCP Inspector)
 *   DELETE /mcp          end a session
 *   GET  /health         liveness probe (no auth)
 *
 * Mobile safety: this module must not run any Node-only code (or even *load*
 * the MCP SDK) on mobile, so every runtime dependency — the SDK classes, the
 * tool registrations, and `node:http` — is pulled in through dynamic `import()`
 * chained behind a `Platform.isDesktop` guard in `start()`. The static type
 * annotations below (`import("…")`) are erased at build time and exist only so
 * the module graph that *always* loads stays browser-clean.
 *
 * Sessions are stateful (the SDK default); each is a
 * `StreamableHTTPServerTransport` held in a map keyed by its session id. Since
 * this is a service to an AI client running on the same machine, session
 * state is intentionally ephemeral — restarting Obsidian drops every client.
 */

import { Platform } from "obsidian";

export interface McpServiceDeps {
	/** Generate and persist a fresh token (server auto-creates one at start). */
	ensureToken: () => string;
	/** The bearer token, or null when unset. */
	getToken: () => string | null;
	/** Current TCP port; read at start time. */
	getPort: () => number;
	/** Cross-cutting tool dependencies: index, note I/O, version, `me` lookup. */
	tools: import("./tools").McpDeps;
}

function randomUuid(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	const bytes = new Uint8Array(16);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Math.floor(Math.random() * 256);
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

type HttpServer = import("node:http").Server & {
	listen(port: number, hostname: string, cb: () => void): unknown;
};
type McpTransport = import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;

export class LocalMcpServer {
	private http?: HttpServer;
	private mcp?: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
	private transportCtor?: typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
	private sessions = new Map<string, McpTransport>();

	constructor(private readonly deps: McpServiceDeps) {}

	get running(): boolean {
		return this.http !== undefined;
	}

	async start(): Promise<void> {
		// Refuse on mobile up front (also satisfies the lint gate that forbids
		// reaching for Node builtins without this guard — it must be the very
		// first statement of this function).
		if (!Platform.isDesktop) return;
		if (this.http) return;

		// Everything from here lives behind the desktop guard: the SDK pulls
		// `@hono/node-server`, whose static `require("node:http")` would crash
		// plugin load on mobile if bundled eagerly.
		const transportModule = await import(
			"@modelcontextprotocol/sdk/server/streamableHttp.js"
		);
		const { createMcpServer } = await import("./tools");
		const { createServer } = await import("node:http");

		this.mcp = createMcpServer(this.deps.tools);
		this.transportCtor = transportModule.StreamableHTTPServerTransport;

		const server = createServer((req, res) => {
			void this.onRequest(req, res);
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.deps.getPort(), "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		if (this.sessions.size > 0) {
			await Promise.all(
				[...this.sessions.values()].flatMap((t) => [t.close()]),
			);
			this.sessions.clear();
		}
		this.http = server;
	}

	async stop(): Promise<void> {
		const server = this.http;
		this.http = undefined;
		await Promise.all([...this.sessions.values()].map((t) => t.close()));
		this.sessions.clear();
		this.mcp = undefined;
		this.transportCtor = undefined;
		if (server) {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}

	private async onRequest(
		req: import("node:http").IncomingMessage,
		res: import("node:http").ServerResponse,
	): Promise<void> {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader(
			"Access-Control-Allow-Headers",
			"Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
		);
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
		res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/health") {
			json(res, 200, {
				status: "ok",
				service: "vertex-flow-mcp",
				version: this.deps.tools.version,
			});
			return;
		}

		const token = this.deps.getToken();
		if (!token || req.headers.authorization !== `Bearer ${token}`) {
			json(res, 401, { error: "unauthorized" });
			return;
		}

		if (url.pathname !== "/mcp" || !this.mcp || !this.transportCtor) {
			json(res, 404, { error: "not-found" });
			return;
		}

		try {
			const sessionId = req.headers["mcp-session-id"];
			const resume = typeof sessionId === "string" && sessionId.length > 0;

			let transport: McpTransport;
			if (resume) {
				const existing = this.sessions.get(sessionId);
				if (!existing) {
					json(res, 404, { error: "session-not-found" });
					return;
				}
				transport = existing;
			} else {
				const TransportCtor = this.transportCtor;
				transport = new TransportCtor({
					sessionIdGenerator: randomUuid,
					enableJsonResponse: true,
					onsessioninitialized: (sid) => {
						this.sessions.set(sid, transport);
					},
					onsessionclosed: (sid) => {
						this.sessions.delete(sid);
					},
				});
				transport.onclose = () => {
					if (transport.sessionId) this.sessions.delete(transport.sessionId);
				};
				await this.mcp.connect(transport);
			}
			await transport.handleRequest(req, res);
		} catch (err) {
			console.error("[vertex-flow:mcp] request failed", err);
			if (!res.writableEnded) {
				json(res, 500, { error: "internal-error" });
			}
		}
	}
}

/**
 * Convenience wrapper the plugin drives: guarantees a token exists before the
 * first bind, and exposes `running` for settings diagnostics.
 */
export class McpServerService {
	private server: LocalMcpServer | null = null;

	constructor(private readonly deps: McpServiceDeps) {}

	get running(): boolean {
		return this.server?.running ?? false;
	}

	async start(): Promise<void> {
		if (this.server) return;
		this.deps.ensureToken();
		const server = new LocalMcpServer(this.deps);
		await server.start();
		if (server.running) this.server = server;
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = null;
		if (server) await server.stop();
	}
}