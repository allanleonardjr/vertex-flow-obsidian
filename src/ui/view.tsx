/**
 * The Obsidian `ItemView` that hosts the React tree.
 *
 * This is the only file that bridges the two worlds: Obsidian owns the leaf and
 * its lifecycle, React owns everything inside it.
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type VertexFlowPlugin from "../main";
import { App } from "./App";
import { PluginProvider } from "./context";

export const VERTEX_VIEW_TYPE = "vertex-flow-view";

export class VertexFlowView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: VertexFlowPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VERTEX_VIEW_TYPE;
	}

	override getDisplayText(): string {
		return this.plugin.activeWorkspace()?.workspace.name ?? "Vertex Flow";
	}

	override getIcon(): string {
		return "kanban-square";
	}

	override async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("vertex-flow");

		this.root = createRoot(container);
		this.root.render(
			<StrictMode>
				<PluginProvider plugin={this.plugin}>
					<App />
				</PluginProvider>
			</StrictMode>,
		);
	}

	override async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
