/**
 * Plugin-level settings (`data.json`).
 *
 * Deliberately tiny. Anything that describes *the work* — taxonomies, views,
 * hierarchy — lives in the vault as Markdown, not here (§3). This file only
 * holds per-install UI state that would be meaningless to sync or diff.
 */

/**
 * Interface text density. `compact` is the built-in Linear-style baseline;
 * the larger tiers scale the plugin's `--font-ui-*` tokens up by a fixed
 * factor (see `--vf-text-scale` in `styles.css`).
 */
export type UiTextSize = "compact" | "cozy" | "comfortable";

export interface VertexFlowSettings {
	/** Interface text size — scales the whole plugin UI, not per-workspace. */
	uiTextSize: UiTextSize;
	/** The "Show archived" toggle (§7.7) — a session preference, not a filter. */
	showArchived: boolean;
	/** Where new workspaces are offered by default. */
	defaultWorkspaceFolder: string;
	/** Width, in pixels, of the property rail in the task/project editor. */
	editorRailWidth: number;
	/** Whether that property rail is collapsed to a sliver (shared task/project). */
	editorRailCollapsed: boolean;
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
	/** Whether the collapsible description section (View / Project / Task) is closed. */
	descriptionCollapsed: boolean;
	/** Whether the Description field shows raw Source text instead of Live Preview. */
	descriptionSourceMode: boolean;
	/** Collapsed state of the other task-editor sections, keyed by section id. */
	editorSectionsCollapsed: Record<string, boolean>;
	/** Height, in pixels, of the Project editor's info pane above its task list. */
	projectInfoHeight: number;
	/** Height, in pixels, of the Task editor's description pane above Sub-tasks. */
	taskDescriptionHeight: number;
	/** Timeline view: width of the sticky task-label column left of the chart. */
	timelineLeftWidth: number;
	/** Timeline view: that label column collapsed to a sliver. */
	timelineLeftCollapsed: boolean;
	/** Timeline view: height of the Unscheduled pane below the chart. */
	timelineLowerHeight: number;
	/** Timeline view: that Unscheduled pane collapsed to its header. */
	timelineLowerCollapsed: boolean;
	/** Calendar view: the Unscheduled drawer collapsed to its header. */
	calendarUnscheduledCollapsed: boolean;
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
	uiTextSize: "compact",
	showArchived: false,
	defaultWorkspaceFolder: "Vertex Flow",
	editorRailWidth: 264,
	editorRailCollapsed: false,
	sidebarCollapsed: {},
	sidebarWidth: 220,
	sidebarMinimized: false,
	queryBarOpen: false,
	editorSourceOpen: false,
	descriptionCollapsed: false,
	descriptionSourceMode: false,
	editorSectionsCollapsed: {},
	projectInfoHeight: 220,
	taskDescriptionHeight: 220,
	timelineLeftWidth: 300,
	timelineLeftCollapsed: false,
	timelineLowerHeight: 200,
	timelineLowerCollapsed: false,
	calendarUnscheduledCollapsed: false,
	taskPickerWidth: 380,
	taskPickerHeight: 360,
	helpSidebarWidth: 240,
	redirectTaskNotes: true,
};
