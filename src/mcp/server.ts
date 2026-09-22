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
 * `StreamableHTTPServerTransport` held — alongside its **own** `McpServer`
 * and the client identity snapshot tracked for the settings — in a map keyed
 * by its session id. Each session needs a fresh `McpServer` because the SDK
 * allows a `Server` instance exactly one connected transport; sharing one
 * would break at the second client. Since this is a service to AI clients
 * running on the same machine, session state is intentionally ephemeral —
 * restarting Obsidian drops every client, and any client can be ended on its
 * own from Settings (`disconnectSession`).
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

/**
 * What we know about one connected client, for the MCP settings table.
 *
 * `name`/`version` are the `clientInfo` the client sent in its `initialize`
 * request; `userAgent` is the HTTP `User-Agent` header seen on that request.
 * Any of the three may be absent (a client that skips its identity, or a
 * session captured before the initialize task was processed). `connectedAt`
 * marks when the session started.
 */
export interface McpClientInfo {
	sessionId: string;
	name: string | null;
	version: string | null;
	userAgent: string | null;
	connectedAt: number;
}

/** One live client session: its transport, its own MCP server, and identity. */
interface McpSession {
	transport: McpTransport;
	mcp: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
	info: McpClientInfo;
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
	private transportCtor?: typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
	/**
	 * Factory for the per-session MCP servers, cached from the dynamic import
	 * chain inside `start()` so `onRequest` can mint one per new session
	 * without re-importing. `createMcpServer` re-registers the tool surface
	 * synchronously on each call — cheap, and only a handful per session.
	 */
	private sessionFactory?: typeof import("./tools");
	private sessions = new Map<string, McpSession>();
	/**
	 * Raw sockets currently open on `http`, tracked so `stop()` can force-close
	 * them instead of waiting on `server.close()`'s callback — which only fires
	 * once every connection ends on its own, and MCP Streamable HTTP sessions
	 * are intentionally long-lived. Without this, a client holding its
	 * connection open (normal for this transport) can make `stop()` hang
	 * indefinitely, leaving the port bound to an orphaned server the app has
	 * no other handle on.
	 */
	private sockets = new Set<import("node:net").Socket>();

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
		this.sessionFactory = await import("./tools");
		// A literal dynamic `import()` of a bare specifier like "node:http" fails
		// in Obsidian's CJS plugin sandbox — it tries to resolve like a browser
		// module fetch. `require` works because esbuild's `cjs` output format
		// wraps this bundle with a real CJS `require`, and "node:http" is left
		// untouched by the `external` list in esbuild.config.mjs.
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- see comment above
		const { createServer } = require("node:http") as typeof import("node:http");

		this.transportCtor = transportModule.StreamableHTTPServerTransport;

		const server: HttpServer = createServer((req, res) => {
			void this.onRequest(req, res);
		});
		server.on("connection", (socket) => {
			this.sockets.add(socket);
			socket.on("close", () => this.sockets.delete(socket));
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
				[...this.sessions.values()].flatMap((s) => [s.transport.close()]),
			);
			this.sessions.clear();
		}
		this.http = server;
	}

	async stop(): Promise<void> {
		const server = this.http;
		this.http = undefined;
		await Promise.all(
			[...this.sessions.values()].flatMap((s) => [
				s.transport.close(),
				s.mcp.close(),
			]),
		);
		this.sessions.clear();
		this.transportCtor = undefined;
		this.sessionFactory = undefined;
		if (server) {
			// Register the close callback before destroying any sockets, so
			// there's no window where a socket's `close` event could fire before
			// anything is listening for the server to consider itself closed.
			const closed = new Promise<void>((resolve) => server.close(() => resolve()));
			// Force-end every open connection rather than waiting for a client to
			// voluntarily disconnect — a long-lived MCP session otherwise stalls
			// `server.close()` indefinitely (see the `sockets` field doc above).
			for (const socket of this.sockets) socket.destroy();
			this.sockets.clear();
			await closed;
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

		if (url.pathname !== "/mcp" || !this.http || !this.transportCtor || !this.sessionFactory) {
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
				transport = existing.transport;
			} else {
				// A fresh session owns a fresh McpServer: the SDK allows each
				// `Server` instance just one connected transport, so a shared
				// instance would reject every client after the first with
				// "Already connected" (surfaced as a 500). Registering the tool
				// surface per session costs nothing measurable and gives each
				// client its own negotiated protocol state.
				const mcp = this.sessionFactory.createMcpServer(this.deps.tools);
				const TransportCtor = this.transportCtor;
				const userAgent =
					typeof req.headers["user-agent"] === "string"
						? req.headers["user-agent"]
						: null;
				transport = new TransportCtor({
					sessionIdGenerator: randomUuid,
					enableJsonResponse: true,
					onsessioninitialized: (sid) => {
						this.sessions.set(sid, {
							transport,
							mcp,
							info: {
								sessionId: sid,
								name: null,
								version: null,
								userAgent,
								connectedAt: Date.now(),
							},
						});
					},
					onsessionclosed: (sid) => {
						this.sessions.delete(sid);
					},
				});
				transport.onclose = () => {
					if (transport.sessionId) this.sessions.delete(transport.sessionId);
				};
				await mcp.connect(transport);
			}
			await transport.handleRequest(req, res);
			this.refreshSessionInfo(transport.sessionId);
		} catch (err) {
			console.error("[vertex-flow:mcp] request failed", err);
			if (!res.writableEnded) {
				json(res, 500, { error: "internal-error" });
			}
		}
	}

	/**
	 * Snapshot of every live session, oldest first, for the settings table.
	 */
	connectedClients(): McpClientInfo[] {
		return [...this.sessions.values()]
			.map((s) => ({ ...s.info }))
			.sort((a, b) => a.connectedAt - b.connectedAt);
	}

	/**
	 * Force-end one client's session: closes its transport's SSE streams and
	 * in-flight requests, which fires `onclose` and drops it from the map —
	 * the client's next request stops with 404 session-not-found. Returns
	 * false when no session has that id (already ended).
	 */
	async disconnectSession(sessionId: string): Promise<boolean> {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		await session.transport.close();
		return true;
	}

	/**
	 * Pull the client's self-reported `clientInfo` (name/version) off its
	 * session's own `McpServer` into the session record. Only callable after
	 * the transport has processed a request: the SDK fills this in when it
	 * handles `initialize`, so `onsessioninitialized` fires too early for it.
	 */
	private refreshSessionInfo(sessionId: string | undefined): void {
		if (!sessionId) return;
		const session = this.sessions.get(sessionId);
		if (!session) return;
		const clientInfo = session.mcp.server.getClientVersion();
		if (clientInfo) {
			session.info.name = clientInfo.name;
			session.info.version = clientInfo.version;
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

	/** Live client sessions, or [] when the server isn't running. */
	listClients(): McpClientInfo[] {
		return this.server?.connectedClients() ?? [];
	}

	/** Force-end one client session. True only if it was live. */
	async disconnectClient(sessionId: string): Promise<boolean> {
		if (!this.server) return false;
		return this.server.disconnectSession(sessionId);
	}
}

/**
 * Scans upward from `startPort + 1` for a port nothing is currently bound
 * to on `127.0.0.1`, by briefly binding a throwaway server to each
 * candidate and closing it immediately. Returns `null` if nothing free
 * turns up within `maxAttempts` candidates, or on mobile (no port scanning
 * is meaningful there).
 */
export async function findAvailablePort(
	startPort: number,
	maxAttempts = 20,
): Promise<number | null> {
	if (!Platform.isDesktop) return null;
	// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- see start()'s identical node:http comment
	const net = require("node:net") as typeof import("node:net");

	const tryPort = (port: number): Promise<boolean> =>
		new Promise((resolve) => {
			const probe = net.createServer();
			probe.once("error", () => resolve(false));
			probe.listen(port, "127.0.0.1", () => {
				probe.close(() => resolve(true));
			});
		});

	for (let i = 1; i <= maxAttempts; i++) {
		const candidate = startPort + i;
		if (candidate > 65535) break;
		if (await tryPort(candidate)) return candidate;
	}
	return null;
}