/**
 * Vertex Flow — plugin entry point.
 *
 * Responsibilities, in order: build the index, register the main view, and
 * register every action as a native Obsidian command. That last part matters —
 * §9.1 requires plugin actions to appear in the Command Palette so users can
 * rebind them through Obsidian's own hotkey settings rather than a
 * plugin-private scheme.
 */

import { Plugin, WorkspaceLeaf } from "obsidian";
import { VaultIndex } from "./obsidian/index-store";
import { Mutations } from "./obsidian/mutations";
import { NoteIO } from "./obsidian/note-io";
import { DEFAULT_SETTINGS, type VertexFlowSettings } from "./settings/types";
import { QuickCaptureModal } from "./ui/modals/QuickCaptureModal";
import { VERTEX_VIEW_TYPE, VertexFlowView } from "./ui/view";

export default class VertexFlowPlugin extends Plugin {
	override settings: VertexFlowSettings = { ...DEFAULT_SETTINGS };
	io!: NoteIO;
	index!: VaultIndex;
	mutations!: Mutations;

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.io = new NoteIO(this.app);
		this.index = new VaultIndex(this.app, this.io);
		this.mutations = new Mutations(this.app, this.io, this.index);

		this.registerView(
			VERTEX_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new VertexFlowView(leaf, this),
		);

		this.addRibbonIcon("kanban-square", "Open Vertex Flow", () => {
			void this.activateView();
		});

		this.registerCommands();

		// The metadata cache isn't populated until layout is ready; indexing
		// before then would read an empty vault.
		this.app.workspace.onLayoutReady(() => {
			this.index.watch((unsubscribe) => this.register(unsubscribe));
			void this.index.rebuild();
		});
	}

	override onunload(): void {
		// Obsidian detaches registered views automatically; nothing else to undo.
	}

	private registerCommands(): void {
		this.addCommand({
			id: "open-view",
			name: "Open Vertex Flow",
			callback: () => void this.activateView(),
		});

		// §9.4: quick capture must work from anywhere in Obsidian, not just from
		// inside the plugin's own views.
		this.addCommand({
			id: "quick-capture",
			name: "Quick capture: new task",
			callback: () => {
				const snapshot = this.activeWorkspace();
				if (!snapshot) {
					void this.activateView();
					return;
				}
				new QuickCaptureModal(this.app, this, snapshot).open();
			},
		});

		this.addCommand({
			id: "toggle-archived",
			name: "Toggle showing archived tasks",
			callback: () => {
				this.settings.showArchived = !this.settings.showArchived;
				void this.saveSettings();
			},
		});

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild index",
			callback: () => void this.index.rebuild(),
		});
	}

	/** The workspace the main view is currently showing, if any. */
	activeWorkspace() {
		const root = this.settings.activeWorkspaceRoot;
		return (root ? this.index.get(root) : null) ?? this.index.list()[0] ?? null;
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VERTEX_VIEW_TYPE);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VERTEX_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
