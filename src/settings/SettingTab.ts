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
	PluginSettingTab,
	type SettingDefinitionItem,
} from "obsidian";
import type VertexFlowPlugin from "../main";
import type { UiTextSize } from "./types";
import { applyUiTextSize } from "./ui-text-size";
import { getMePrefill, setMePrefill } from "../obsidian/me-storage";

/** The control keys must line up with `getControlValue`/`setControlValue`. */
const UI_TEXT_SIZE_KEY = "uiTextSize";
const REDIRECT_TASK_NOTES_KEY = "redirectTaskNotes";
const ME_PREFILL_NAME_KEY = "mePrefillName";
const ME_PREFILL_ALIASES_KEY = "mePrefillAliases";

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
		];
	}

	override getControlValue(key: string): unknown {
		if (key === UI_TEXT_SIZE_KEY) return this.plugin.settings.uiTextSize;
		if (key === REDIRECT_TASK_NOTES_KEY)
			return this.plugin.settings.redirectTaskNotes;
		if (key === ME_PREFILL_NAME_KEY) return getMePrefill()?.name ?? "";
		if (key === ME_PREFILL_ALIASES_KEY)
			return (getMePrefill()?.aliases ?? []).join(", ");
		return undefined;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === ME_PREFILL_NAME_KEY || key === ME_PREFILL_ALIASES_KEY) {
			const current = getMePrefill() ?? {};
			const next =
				key === ME_PREFILL_NAME_KEY
					? { ...current, name: String(value ?? "").trim() || undefined }
					: {
							...current,
							aliases: String(value ?? "")
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
		}
		await this.plugin.saveSettings();
	}
}
