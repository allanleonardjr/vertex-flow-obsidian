/**
 * Native Obsidian settings tab.
 *
 * This is for plugin-global behaviour toggles — things that govern how
 * Obsidian navigates, not anything about a workspace's data (that lives in
 * the React `WorkspaceSettingsView`, backed by `_workspace.md`). Declarative
 * `getSettingDefinitions()` (Obsidian ≥1.13) hands rendering and search over
 * to the settings framework; this class only resolves control values to and
 * from `plugin.settings`.
 *
 * The "Your name / aliases" fields are the one exception to "reads/writes
 * `plugin.settings`": they read and write the `me-storage` *prefill* only — a
 * per-device convenience default for new workspaces and nothing else. They
 * never touch `data.json` and never point at any workspace's roster.
 */

import {
	App,
	Notice,
	Platform,
	PluginSettingTab,
	type SettingDefinitionItem,
} from "obsidian";
import type VertexFlowPlugin from "../main";
import type { UiTextSize } from "./types";
import { applyUiTextSize } from "./ui-text-size";
import { getMePrefill, setMePrefill } from "../obsidian/me-storage";
import {
	generateMcpToken,
	getMcpToken,
	setMcpToken,
} from "../obsidian/mcp-token";

/** The control keys must line up with `getControlValue`/`setControlValue`. */
const UI_TEXT_SIZE_KEY = "uiTextSize";
const REDIRECT_TASK_NOTES_KEY = "redirectTaskNotes";
const ME_PREFILL_NAME_KEY = "mePrefillName";
const ME_PREFILL_ALIASES_KEY = "mePrefillAliases";
const MCP_ENABLED_KEY = "mcpServerEnabled";
const MCP_PORT_KEY = "mcpServerPort";

export class VertexFlowSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: VertexFlowPlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Interface text size",
				desc: "Vertex Flow ships at a compact density. Pick a " +
					"larger size to scale the whole plugin UI up.",
				control: {
					type: "dropdown",
					key: UI_TEXT_SIZE_KEY,
					options: {
						compact: "Compact",
						cozy: "Cozy",
						comfortable: "Comfortable",
					},
				},
			},
			{
				name: "Open task notes in Vertex Flow",
				desc: "When a task note is opened anywhere in Obsidian — search, a " +
					"wikilink, the quick switcher — open it in Vertex Flow's editor " +
					"instead of the plain note view. The editor's own ↗ button always " +
					"opens the raw note regardless of this setting.",
				control: { type: "toggle", key: REDIRECT_TASK_NOTES_KEY },
			},
			{
				name: "Your name",
				desc: "A default only — used to prefill the \"who are you?\" field " +
					"when you create a new workspace. Who you actually are in each " +
					"workspace is set per-workspace in its People settings and stored " +
					"on this device only.",
				control: {
					type: "text",
					key: ME_PREFILL_NAME_KEY,
					placeholder: "e.g. Alex Rivera",
				},
			},
			{
				name: "Your aliases",
				desc: "Comma-separated. Also a prefill-only default; each workspace's " +
					"roster keeps its own copy once you're added to it.",
				control: {
					type: "text",
					key: ME_PREFILL_ALIASES_KEY,
					placeholder: "e.g. alex, ar",
				},
			},
			{
				name: "MCP server",
				desc: "Serve read-only access to your workspaces and help docs over " +
					"a local Model Context Protocol endpoint for AI clients on this " +
					"computer (LM Studio, or LM Studio's phone app via its \"Locally\" " +
					"link). Everything stays on this device — nothing is sent to any " +
					"server. Desktop only.",
				control: { type: "toggle", key: MCP_ENABLED_KEY },
				visible: () => !Platform.isMobile,
			},
			{
				name: "Port",
				desc: "The MCP endpoint is always bound to 127.0.0.1 — only apps on " +
					"this computer can reach it. Change this to move the endpoint away " +
					"from the default.",
				control: {
					type: "number",
					key: MCP_PORT_KEY,
					min: 1,
					max: 65535,
					step: 1,
				},
				visible: () =>
					!Platform.isMobile && this.plugin.settings.mcpServerEnabled,
			},
			{
				name: "Find available port",
				desc: "Scan upward from the current port for one that's free and " +
					"switch to it automatically.",
				visible: () =>
					!Platform.isMobile && this.plugin.settings.mcpServerEnabled,
				render: (setting) => {
					const button = setting.settingEl.createEl("button", {
						text: "Find available port",
					});
					button.addEventListener("click", () => {
						button.disabled = true;
						button.setText("Scanning…");
						void this.plugin
							.findAvailableMcpPort()
							.then((found) => {
								if (found == null) {
									new Notice(
										"Couldn't find a free port nearby — try picking one manually.",
									);
									return;
								}
								this.plugin.settings.mcpServerPort = found;
								void this.plugin.saveSettings();
								void this.plugin.refreshMcpServer();
								this.update();
								new Notice(`Switched to port ${found}.`);
							})
							.finally(() => {
								button.disabled = false;
								button.setText("Find available port");
							});
					});
					return () => button.remove();
				},
			},
			{
				name: "Access token",
				desc: "Clients must send this as a Bearer token on every request. " +
					"It is stored on this device only — never in your synced vault or " +
					"settings. Regenerate it to revoke every connected client.",
				visible: () =>
					!Platform.isMobile && this.plugin.settings.mcpServerEnabled,
				render: (setting) => {
					const token = getMcpToken();
					const row = setting.settingEl.createDiv({
						cls: "vf-settings-mcp-row",
					});
					row.createEl("code", { text: token ?? "(no token yet — generated on demand)" });
					const controls = row.createDiv({ cls: "vf-settings-mcp-actions" });
					const copy = controls.createEl("button", {
						text: "Copy token",
						cls: "mod-cta",
					});
					copy.addEventListener("click", () => {
						const current = getMcpToken();
						if (!current) {
							new Notice("Generate a token before copying.");
							return;
						}
						void navigator.clipboard.writeText(current);
						new Notice("Mcp token copied to clipboard.");
					});
					const regenerate = controls.createEl("button", {
						text: "Regenerate",
					});
					regenerate.addEventListener("click", () => {
						setMcpToken(generateMcpToken());
						new Notice("New mcp token generated. Reconnect your AI client.");
						this.update();
					});
					return () => row.remove();
				},
			},
		];
	}

	override getControlValue(key: string): unknown {
		if (key === UI_TEXT_SIZE_KEY) return this.plugin.settings.uiTextSize;
		if (key === REDIRECT_TASK_NOTES_KEY)
			return this.plugin.settings.redirectTaskNotes;
		if (key === MCP_ENABLED_KEY) return this.plugin.settings.mcpServerEnabled;
		if (key === MCP_PORT_KEY) return this.plugin.settings.mcpServerPort;
		if (key === ME_PREFILL_NAME_KEY) return getMePrefill()?.name ?? "";
		if (key === ME_PREFILL_ALIASES_KEY)
			return (getMePrefill()?.aliases ?? []).join(", ");
		return undefined;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === ME_PREFILL_NAME_KEY || key === ME_PREFILL_ALIASES_KEY) {
			const current = getMePrefill() ?? {};
			const text = (value: unknown) =>
				typeof value === "string"
					? value
					: value == null
						? ""
						: JSON.stringify(value);
			const next =
				key === ME_PREFILL_NAME_KEY
					? { ...current, name: text(value).trim() || undefined }
					: {
							...current,
							aliases: text(value)
								.split(",")
								.map((alias) => alias.trim())
								.filter(Boolean),
						};
			const cleaned =
				next.name || (next.aliases && next.aliases.length > 0) ? next : null;
			setMePrefill(cleaned);
			return; // prefill lives in localStorage, not data.json
		}

		if (key === UI_TEXT_SIZE_KEY) {
			const size = value as UiTextSize;
			if (size === "compact" || size === "cozy" || size === "comfortable") {
				this.plugin.settings.uiTextSize = size;
				applyUiTextSize(size);
			}
		} else if (key === REDIRECT_TASK_NOTES_KEY) {
			this.plugin.settings.redirectTaskNotes = Boolean(value);
		} else if (key === MCP_ENABLED_KEY) {
			this.plugin.settings.mcpServerEnabled = Boolean(value);
			void this.plugin.refreshMcpServer();
		} else if (key === MCP_PORT_KEY) {
			const port = Number(value);
			if (Number.isInteger(port) && port >= 1 && port <= 65535) {
				this.plugin.settings.mcpServerPort = port;
				void this.plugin.refreshMcpServer();
			}
		}
		await this.plugin.saveSettings();
	}
}
