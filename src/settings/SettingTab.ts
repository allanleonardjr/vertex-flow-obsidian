/**
 * Native Obsidian settings tab.
 *
 * This is for plugin-global behaviour toggles — things that govern how
 * Obsidian navigates, not anything about a workspace's data (that lives in
 * the React `WorkspaceSettingsView`, backed by `_workspace.md`). Declarative
 * `getSettingDefinitions()` (Obsidian ≥1.13) hands rendering and search over
 * to the settings framework; this class only resolves control values to and
 * from `plugin.settings`.
 */

import {
	App,
	PluginSettingTab,
	type SettingDefinitionItem,
} from "obsidian";
import type VertexFlowPlugin from "../main";
import type { UiTextSize } from "./types";
import { applyUiTextSize } from "./ui-text-size";

/** The control keys must line up with `getControlValue`/`setControlValue`. */
const UI_TEXT_SIZE_KEY = "uiTextSize";
const REDIRECT_TASK_NOTES_KEY = "redirectTaskNotes";

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
		];
	}

	override getControlValue(key: string): unknown {
		if (key === UI_TEXT_SIZE_KEY) return this.plugin.settings.uiTextSize;
		if (key === REDIRECT_TASK_NOTES_KEY)
			return this.plugin.settings.redirectTaskNotes;
		return undefined;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
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