/**
 * Plugin-level settings (`data.json`).
 *
 * Deliberately tiny. Anything that describes *the work* — taxonomies, views,
 * hierarchy — lives in the vault as Markdown, not here (§3). This file only
 * holds per-install UI state that would be meaningless to sync or diff.
 */

export interface VertexFlowSettings {
	/** Root of the workspace currently open in the main view. */
	activeWorkspaceRoot: string | null;
	/** The "Show archived" toggle (§7.7) — a session preference, not a filter. */
	showArchived: boolean;
	/** Where new workspaces are offered by default. */
	defaultWorkspaceFolder: string;
	/** Width, in pixels, of the property rail in the task editor. */
	editorRailWidth: number;
	/** Collapsed state of each sidebar section, keyed by section id. */
	sidebarCollapsed: Record<string, boolean>;
	/** Sidebar width in pixels (drag-resizable). */
	sidebarWidth: number;
	/** Sidebar collapsed to a sliver. */
	sidebarMinimized: boolean;
	/**
	 * Whether the text query row under the view bar is expanded. Plugin-global
	 * rather than per-view: someone who works this way wants it everywhere.
	 */
	queryBarOpen: boolean;
	/** Whether the raw-source section at the bottom of the task editor is open. */
	editorSourceOpen: boolean;
	/** Size of the Parent / relation task-picker popover, drag-resizable. */
	taskPickerWidth: number;
	taskPickerHeight: number;
	/** Width, in pixels, of the topic tree in the Help pane (drag-resizable). */
	helpSidebarWidth: number;
	/**
	 * Whether opening a task note anywhere in Obsidian (search, a wikilink,
	 * the quick switcher) redirects into Vertex Flow's editor instead of the
	 * plain Markdown view. Plugin-global rather than per-workspace — this
	 * governs Obsidian navigation behaviour, not anything about a workspace's
	 * data, so it lives here rather than in `_workspace.md`.
	 */
	redirectTaskNotes: boolean;
}

export const DEFAULT_SETTINGS: VertexFlowSettings = {
	activeWorkspaceRoot: null,
	showArchived: false,
	defaultWorkspaceFolder: "Vertex Flow",
	editorRailWidth: 264,
	sidebarCollapsed: {},
	sidebarWidth: 220,
	sidebarMinimized: false,
	queryBarOpen: false,
	editorSourceOpen: false,
	taskPickerWidth: 380,
	taskPickerHeight: 360,
	helpSidebarWidth: 240,
	redirectTaskNotes: true,
};
