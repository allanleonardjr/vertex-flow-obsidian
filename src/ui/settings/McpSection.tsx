/**
 * MCP server — a local, token-gated endpoint that gives AI clients on this
 * computer (LM Studio, etc.) read-only access to this workspace. Mirrors the
 * native `VertexFlowSettingTab`'s "MCP server" setting item so both surfaces
 * behave identically; see that file for the canonical port/token logic this
 * one ports.
 */

import { useEffect, useState } from "react";
import { Notice, Platform, requestUrl } from "obsidian";
import {
	generateMcpToken,
	getMcpToken,
	setMcpToken,
} from "../../obsidian/mcp-token";
import type { McpClientInfo } from "../../mcp/server";
import { usePlugin, useSettingsWriter } from "../context";

/**
 * `"foreign"`: `/health` answered but `plugin.mcpServerRunning` says this
 * instance's own server isn't the one running — a leftover process (e.g. an
 * orphaned server from a previous plugin reload that outlived its `stop()`)
 * still bound to the configured port. Distinct from `"up"` (this instance's
 * own server) and `"down"` (nothing answers at all).
 */
type HealthState = "checking" | "up" | "down" | "foreign" | null;

export function McpSection({ id }: { id?: string }) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const enabled = plugin.settings.mcpServerEnabled;
	const port = plugin.settings.mcpServerPort;

	const [health, setHealth] = useState<HealthState>(null);
	const [scanning, setScanning] = useState(false);
	const [clients, setClients] = useState<McpClientInfo[]>([]);
	const [disconnecting, setDisconnecting] = useState<string | null>(null);

	// Polls the server's own unauthenticated `/health` route — the setting
	// (`enabled`) only reflects intent, not whether the bind actually
	// succeeded (e.g. EADDRINUSE), so this is the one source of truth for
	// what's rendered as "Running" vs "Not responding".
	//
	// A failed check within `GRACE_MS` of enabling doesn't flip straight to
	// "down" — the server's own async startup routinely loses the race
	// against the very first poll, which otherwise flashes a real (if
	// momentary) "Not responding" on completely normal startup. During the
	// grace window, polling runs fast (`FAST_INTERVAL_MS`) so a genuine
	// success is picked up almost immediately; once the window elapses with
	// no success, or the server later goes down after having been up, a
	// failure is reported promptly and polling settles to the slower
	// steady-state cadence.
	useEffect(() => {
		if (!enabled) {
			setHealth(null);
			return;
		}
		let cancelled = false;
		let timer: number | undefined;
		const startedAt = Date.now();
		const GRACE_MS = 5000;
		const FAST_INTERVAL_MS = 500;
		const SLOW_INTERVAL_MS = 4000;
		setHealth("checking");

		const scheduleNext = (delay: number) => {
			if (cancelled) return;
			timer = window.setTimeout(check, delay);
		};

		const handleFailure = () => {
			if (Date.now() - startedAt < GRACE_MS) {
				setHealth("checking");
				scheduleNext(FAST_INTERVAL_MS);
			} else {
				setHealth("down");
				scheduleNext(SLOW_INTERVAL_MS);
			}
		};

		const check = () => {
			void requestUrl({ url: `http://127.0.0.1:${port}/health`, throw: false })
				.then((res) => {
					if (cancelled) return;
					if (res.status === 200) {
						// Something answered — but only this instance's own belief
						// about its state (`plugin.mcpServerRunning`) can say whether
						// that something is *this* server or a leftover process still
						// bound to the same port.
						setHealth(plugin.mcpServerRunning ? "up" : "foreign");
						scheduleNext(SLOW_INTERVAL_MS);
					} else {
						handleFailure();
					}
				})
				.catch(() => {
					if (cancelled) return;
					handleFailure();
				});
		};

		check();
		return () => {
			cancelled = true;
			if (timer != null) window.clearTimeout(timer);
		};
	}, [enabled, port]);

	// Connected clients — read straight off the service while the server is
	// actually up (the health poll is the same gate the status line uses). A
	// shallow change check keeps re-renders from firing when nothing changed.
	useEffect(() => {
		if (!enabled || health !== "up") {
			setClients([]);
			return;
		}
		let cancelled = false;
		const refresh = () => {
			if (cancelled) return;
			const next = plugin.mcpClients();
			setClients((prev) => {
				if (
					prev.length === next.length &&
					prev.every((client, i) => client.sessionId === next[i].sessionId)
				) {
					return prev;
				}
				return next;
			});
		};
		refresh();
		const timer = window.setInterval(refresh, 2000);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [enabled, health, plugin]);

	const disconnectClient = async (sessionId: string) => {
		setDisconnecting(sessionId);
		try {
			await plugin.disconnectMcpClient(sessionId);
		} finally {
			setDisconnecting(null);
			setClients(plugin.mcpClients());
		}
	};

	const handlePortChange = (value: string) => {
		const nextPort = Number(value);
		if (Number.isInteger(nextPort) && nextPort >= 1 && nextPort <= 65535) {
			writeSettings({ mcpServerPort: nextPort });
			void plugin.refreshMcpServer();
		}
	};

	const findAvailablePort = () => {
		setScanning(true);
		void plugin
			.findAvailableMcpPort()
			.then((found) => {
				if (found == null) {
					new Notice("Couldn't find a free port nearby — try picking one manually.");
					return;
				}
				writeSettings({ mcpServerPort: found });
				void plugin.refreshMcpServer();
				new Notice(`Switched to port ${found}.`);
			})
			.finally(() => setScanning(false));
	};

	const copyAddress = () => {
		void navigator.clipboard.writeText(`http://127.0.0.1:${port}/mcp`);
		new Notice("Server address copied to clipboard.");
	};

	const copyToken = () => {
		const current = getMcpToken();
		if (!current) {
			new Notice("Generate a token before copying.");
			return;
		}
		void navigator.clipboard.writeText(current);
		new Notice("Mcp token copied to clipboard.");
	};

	const regenerateToken = () => {
		setMcpToken(generateMcpToken());
		new Notice("New mcp token generated. Reconnect your AI client.");
		plugin.index.touch();
	};

	const statusColor =
		health === "up"
			? "var(--text-success, #22c55e)"
			: health === "down"
				? "var(--text-error, #ef4444)"
				: health === "foreign"
					? "var(--text-warning, orange)"
					: "var(--vf-muted)";
	const statusLabel =
		health === "up"
			? "Running"
			: health === "down"
				? "Not responding"
				: health === "foreign"
					? "Port in use by another process"
					: "Checking…";

	return (
		<section className="vf-settings-section" id={id}>
			<h3>MCP server</h3>
			<p className="vf-settings-description">
				Read-only local endpoint for AI clients (LM Studio, etc.). Desktop
				only — hidden on mobile.
			</p>
			{!Platform.isMobile && (
				<div>
					<label className="vf-toggle">
						<input
							type="checkbox"
							checked={enabled}
							onChange={(event) => {
								writeSettings({ mcpServerEnabled: event.target.checked });
								void plugin.refreshMcpServer();
							}}
						/>
						<span>Enable MCP server</span>
					</label>

					{enabled && (
						<div className="vf-mcp-status">
							<span className="vf-status-dot" style={{ backgroundColor: statusColor }} />
							{health === "checking" && <span className="vf-spinner" aria-hidden="true" />}
							<span>{statusLabel}</span>
						</div>
					)}

					{enabled && health === "foreign" && (
						<p className="vf-settings-description">
							Something else is already answering on this port — likely an
							old server left over from a previous reload, or a different
							app entirely. Try a different port above, or reload Obsidian
							to clear a leftover Vertex Flow process.
						</p>
					)}

					{enabled && (
						<>
							<div className="vf-mcp-port-row">
								<label className="vf-field vf-mcp-port-field">
									<span>Port</span>
									<input
										type="number"
										className="vf-input"
										min={1}
										max={65535}
										step={1}
										value={port}
										onChange={(event) => handlePortChange(event.target.value)}
									/>
								</label>
								<button type="button" disabled={scanning} onClick={findAvailablePort}>
									{scanning ? "Scanning…" : "Find available port"}
								</button>
							</div>
							<p className="vf-settings-description">
								Prefer a high, uncommon port — the 49152–65535 range (IANA's
								dynamic/private range) is generally the least likely to already
								be taken. Avoid common dev ports like 3000, 5173, 8080, and
								27124 (the default for the popular "Local REST API" community
								plugin), which collide often. This reduces collisions, it
								doesn't prevent them — any port can already be in use by
								something else.
							</p>

							<div className="vf-settings-mcp-row">
								<span>Server address</span>
								<code className="vf-mcp-address">{`http://127.0.0.1:${port}/mcp`}</code>
								<div className="vf-settings-mcp-actions">
									<button type="button" className="mod-cta" onClick={copyAddress}>
										Copy address
									</button>
								</div>
							</div>

							<div className="vf-settings-mcp-row">
								<span>Access token</span>
								<code>{getMcpToken() ?? "(no token yet — generated on demand)"}</code>
								<div className="vf-settings-mcp-actions">
									<button type="button" className="mod-cta" onClick={copyToken}>
										Copy token
									</button>
									<button type="button" onClick={regenerateToken}>
										Regenerate
									</button>
								</div>
							</div>

							<div className="vf-settings-mcp-row vf-mcp-clients-row">
								<span>Connected clients</span>
								{clients.length === 0 ? (
									<p className="vf-settings-description">
										No clients connected.
									</p>
								) : (
									<table className="vf-mcp-clients">
										<thead>
											<tr>
												<th>Client</th>
												<th>Connected</th>
												<th>Session</th>
												<th />
											</tr>
										</thead>
										<tbody>
											{clients.map((client) => (
												<tr key={client.sessionId}>
													<td>
														<span className="vf-mcp-client-name">
															{client.name ?? "Unknown"}
														</span>
														{client.version && (
															<span className="vf-mcp-client-version">
																{client.version}
															</span>
														)}
													</td>
													<td>
														{new Date(client.connectedAt).toLocaleTimeString()}
													</td>
													<td>
														<code>{client.sessionId.slice(0, 8)}</code>
													</td>
													<td>
														<button
															type="button"
															disabled={disconnecting === client.sessionId}
															onClick={() => void disconnectClient(client.sessionId)}
														>
															{disconnecting === client.sessionId
																? "Disconnecting…"
																: "Disconnect"}
														</button>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
							</div>
						</>
					)}
				</div>
			)}
		</section>
	);
}
