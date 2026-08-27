/**
 * Vertex Flow — plugin entry point.
 *
 * Responsibilities, in order: build the index, register the main view, and
 * register every action as a native Obsidian command. That last part matters —
 * §9.1 requires plugin actions to appear in the Command Palette so users can
 * rebind them through Obsidian's own hotkey settings rather than a
 * plugin-private scheme.
 */

import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { VaultIndex } from "./obsidian/index-store";
import { Mutations } from "./obsidian/mutations";
import { NoteIO } from "./obsidian/note-io";
import { VertexFlowSettingTab } from "./settings/SettingTab";
import { DEFAULT_SETTINGS, type VertexFlowSettings } from "./settings/types";
import { VERTEX_VIEW_TYPE, VertexFlowView } from "./ui/view";

export default class VertexFlowPlugin extends Plugin {
	override settings: VertexFlowSettings = { ...DEFAULT_SETTINGS };
	io!: NoteIO;
	index!: VaultIndex;
	mutations!: Mutations;

	/** One-shot: consumed by the next `file-open`, then cleared. See `suppressNextRedirect`. */
	private redirectSuppressed = false;

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.io = new NoteIO(this.app);
		this.index = new VaultIndex(this.app, this.io);
		this.mutations = new Mutations(this.app, this.io, this.index);

		this.registerView(
			VERTEX_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new VertexFlowView(leaf, this),
		);

		this.addSettingTab(new VertexFlowSettingTab(this.app, this));

		this.addRibbonIcon("kanban-square", "Open Vertex Flow", () => {
			void this.activateView();
		});

		this.registerCommands();

		// The metadata cache isn't populated until layout is ready; indexing
		// before then would read an empty vault.
		this.app.workspace.onLayoutReady(() => {
			this.index.watch((unsubscribe) => this.register(unsubscribe));
			void this.index.rebuild().then(() => this.registerTaskRedirect());
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
			callback: () => void this.quickCapture(),
		});

		this.addCommand({
			id: "toggle-archived",
			name: "Toggle showing archived tasks",
			callback: () => {
				this.settings.showArchived = !this.settings.showArchived;
				void this.saveSettings();
				this.index.touch();
			},
		});

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild index",
			callback: () => void this.index.rebuild(),
		});
	}

	/**
	 * Redirect a task note, opened anywhere in Obsidian, into Vertex Flow's
	 * own editor instead of the plain Markdown view — registered only after
	 * the first index build completes, so a task note restored from the
	 * previous session's workspace layout on a cold start isn't misjudged
	 * before the index has anything to check against.
	 */
	private registerTaskRedirect(): void {
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file || !this.settings.redirectTaskNotes) return;

				if (this.redirectSuppressed) {
					this.redirectSuppressed = false;
					return;
				}

				// Checked via the metadata cache rather than `this.index.taskAt`:
				// it's robust even for a file the index hasn't processed yet (a
				// brand-new note created outside the plugin), and doesn't require
				// the file to sit inside a workspace folder the index recognizes.
				// `requestEdit` still routes through the index to actually render
				// it, and self-heals via the editor's own subscription if there's
				// a momentary gap.
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.frontmatter?.type !== "task") return;

				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf || leaf.view.getViewType() !== "markdown") return;

				leaf.detach();
				void this.requestEdit(file.path.replace(/\.md$/, ""));
			}),
		);
	}

	/**
	 * Skip the very next redirect. Used by the editor's own "open the raw
	 * note" button — that action deliberately wants the plain Markdown view,
	 * and without this it would immediately bounce right back.
	 */
	suppressNextRedirect(): void {
		this.redirectSuppressed = true;
	}

	/**
	 * A task the view should open as an internal tab as soon as it mounts.
	 *
	 * The bridge for actions that start outside React — the Command Palette
	 * and the task-note redirect above can't reach into the React tree
	 * directly, so they leave the path here and the view picks it up.
	 */
	pendingEditPath: string | null = null;

	/** Ask the view to open a task's tab, opening the view first if needed. */
	async requestEdit(path: string): Promise<void> {
		// Switch to the task's own workspace *before* the view even mounts —
		// resolved and applied directly here rather than left to the tab
		// system's own cross-workspace check (`TabsProvider.openTask`, which
		// still runs afterwards as a harmless no-op in this case). That check
		// only fires once React processes `pendingEditPath` below, which is one
		// more hop of timing to depend on than this needs when the answer is
		// already known right here.
		const owner = this.index.workspaceFor(path);
		if (owner && owner.workspace.root !== this.settings.activeWorkspaceRoot) {
			this.settings.activeWorkspaceRoot = owner.workspace.root;
			await this.saveSettings();
		}

		this.pendingEditPath = path;
		await this.activateView();
		this.index.touch();
	}

	/**
	 * Create a task and open it for editing — the same flow as the in-view
	 * "New task" button, so capture behaves identically wherever it starts.
	 */
	private async quickCapture(): Promise<void> {
		const snapshot = this.activeWorkspace();
		if (!snapshot) {
			// No workspace yet: the view's onboarding is the right destination.
			await this.activateView();
			return;
		}

		try {
			const file = await this.mutations.createTask(snapshot, { title: "New task" });
			await this.requestEdit(file.path.replace(/\.md$/, ""));
		} catch (cause) {
			new Notice(
				`Could not create task: ${
					cause instanceof Error ? cause.message : String(cause)
				}`,
			);
		}
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
