/**
 * React ↔ plugin wiring.
 *
 * The index is an external mutable store, so it's consumed through
 * `useSyncExternalStore` rather than mirrored into component state. That means
 * a file edited *outside* the plugin — in the editor, by Obsidian Sync, by a
 * git pull — repaints the board without any explicit refresh.
 */

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import type VertexFlowPlugin from "../main";
import { snapshotContext, type ViewContext, BUILT_IN_VIEW_ID } from "../core/views";
import { workspaceTaxonomies, type WorkspaceTaxonomies } from "../core/taxonomy";
import type { SavedView, WorkspaceSnapshot } from "../core/types";

interface PluginContextValue {
	plugin: VertexFlowPlugin;
}

const PluginCtx = createContext<PluginContextValue | null>(null);

export function PluginProvider({
	plugin,
	children,
}: {
	plugin: VertexFlowPlugin;
	children: ReactNode;
}) {
	const value = useMemo(() => ({ plugin }), [plugin]);
	return <PluginCtx.Provider value={value}>{children}</PluginCtx.Provider>;
}

export function usePlugin(): VertexFlowPlugin {
	const value = useContext(PluginCtx);
	if (!value) throw new Error("usePlugin must be used inside <PluginProvider>");
	return value.plugin;
}

/** Re-renders whenever the vault index changes. */
export function useWorkspaces(): WorkspaceSnapshot[] {
	const plugin = usePlugin();

	const subscribe = useCallback(
		(onChange: () => void) => plugin.index.subscribe(onChange),
		[plugin],
	);
	// `list()` builds a fresh array each call, so the snapshot has to be the
	// index's identity rather than the array itself.
	const getSnapshot = useCallback(() => plugin.index.revision, [plugin]);

	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return plugin.index.list();
}

export interface ActiveWorkspace {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
}

/** The workspace currently selected in the switcher, fully resolved. */
export function useActiveWorkspace(): ActiveWorkspace | null {
	const plugin = usePlugin();
	const workspaces = useWorkspaces();

	return useMemo(() => {
		const root = plugin.settings.activeWorkspaceRoot;
		const snapshot =
			workspaces.find((w) => w.workspace.root === root) ?? workspaces[0] ?? null;
		if (!snapshot) return null;

		return {
			snapshot,
			taxonomies: workspaceTaxonomies(snapshot.workspace),
			context: snapshotContext(snapshot),
		};
	}, [plugin, workspaces]);
}

/**
 * The built-in "Tasks" view — what the pinned workspace tab always renders.
 * User Saved Views open in their own tabs (see `tabs-context`), so this no
 * longer depends on any "active view" setting.
 */
export function useBuiltInView(snapshot: WorkspaceSnapshot): SavedView {
	return (
		snapshot.views.find((view) => view.id === BUILT_IN_VIEW_ID) ??
		snapshot.views[0]
	);
}

/** Resolve a view id to its definition, falling back to the built-in. */
export function viewById(snapshot: WorkspaceSnapshot, id: string): SavedView {
	return (
		snapshot.views.find((view) => view.id === id) ??
		snapshot.views.find((view) => view.id === BUILT_IN_VIEW_ID) ??
		snapshot.views[0]
	);
}

/** Persist a setting and repaint. */
export function useSettingsWriter(): (
	patch: Partial<VertexFlowPlugin["settings"]>,
) => void {
	const plugin = usePlugin();
	return useCallback(
		(patch) => {
			Object.assign(plugin.settings, patch);
			void plugin.saveSettings();
			plugin.index.touch();
		},
		[plugin],
	);
}
