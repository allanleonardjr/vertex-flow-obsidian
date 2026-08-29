/**
 * Native Obsidian settings tab.
 *
 * This is for plugin-global behaviour toggles — things that govern how
 * Obsidian navigates, not anything about a workspace's data (that lives in
 * the React `WorkspaceSettingsView`, backed by `_workspace.md`). Right now
 * that's exactly one setting; a good, idiomatic home for any future ones
 * like it.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type VertexFlowPlugin from "../main";
import type { UiTextSize } from "./types";
import { applyUiTextSize } from "./ui-text-size";

export class VertexFlowSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: VertexFlowPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Interface text size")
			.setDesc(
				"Vertex Flow ships at a compact, Linear-style density. Pick a " +
					"larger size to scale the whole plugin UI up.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						compact: "Compact",
						cozy: "Cozy",
						comfortable: "Comfortable",
					})
					.setValue(this.plugin.settings.uiTextSize)
					.onChange(async (value) => {
						this.plugin.settings.uiTextSize = value as UiTextSize;
						applyUiTextSize(this.plugin.settings.uiTextSize);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open task notes in Vertex Flow")
			.setDesc(
				"When a task note is opened anywhere in Obsidian — search, a " +
					"wikilink, the quick switcher — open it in Vertex Flow's editor " +
					"instead of the plain note view. The editor's own ↗ button always " +
					"opens the raw note regardless of this setting.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.redirectTaskNotes).onChange(async (value) => {
					this.plugin.settings.redirectTaskNotes = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
