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
import { ActiveWorkspaceProvider, PluginProvider } from "./context";

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

	/**
	 * Deliberately a constant, not the workspace name.
	 *
	 * Obsidian's tab title and window title-bar text cache this and only
	 * recompute on an active-leaf change — there's no supported way for a
	 * fileless view to force a refresh when the underlying name changes, so a
	 * dynamic value here goes stale after a rename or workspace switch. The live
	 * workspace identity ("{Name} ({Code})") is rendered in the plugin's own
	 * header instead (`ViewControls`), where React keeps it current.
	 */
	override getDisplayText(): string {
		return "Vertex Flow";
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
					<ActiveWorkspaceProvider plugin={this.plugin}>
						<App />
					</ActiveWorkspaceProvider>
				</PluginProvider>
			</StrictMode>,
		);
	}

	override async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
