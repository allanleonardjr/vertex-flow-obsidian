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
	/** Saved View id last used, per workspace root. */
	activeViewByWorkspace: Record<string, string>;
	/** The "Show archived" toggle (§7.7) — a session preference, not a filter. */
	showArchived: boolean;
	/** Where new workspaces are offered by default. */
	defaultWorkspaceFolder: string;
}

export const DEFAULT_SETTINGS: VertexFlowSettings = {
	activeWorkspaceRoot: null,
	activeViewByWorkspace: {},
	showArchived: false,
	defaultWorkspaceFolder: "Vertex Flow",
};
