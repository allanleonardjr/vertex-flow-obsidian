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
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import type VertexFlowPlugin from "../main";
import {
	DEFAULT_SIDEBAR_CHROME,
	type SidebarChromeState,
} from "../settings/types";
import { snapshotContext, type ViewContext, SYSTEM_VIEW_ALL_TASKS_ID } from "../core/views";
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

/**
 * Re-renders whenever the vault index changes. Pass
 * `{ includeDeleted: true }` to also surface soft-deleted workspaces (for the
 * Trash view and the empty-state recovery screen); the default excludes them,
 * so every existing call site is unaffected.
 */
export function useWorkspaces(options?: {
	includeDeleted?: boolean;
}): WorkspaceSnapshot[] {
	const plugin = usePlugin();

	const subscribe = useCallback(
		(onChange: () => void) => plugin.index.subscribe(onChange),
		[plugin],
	);
	// `list()` builds a fresh array each call, so the snapshot has to be the
	// index's identity rather than the array itself.
	const getSnapshot = useCallback(() => plugin.index.revision, [plugin]);

	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return plugin.index.list(options);
}

export interface ActiveWorkspace {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
}

interface ActiveWorkspaceCtxValue {
	root: string | null;
	setRoot: (root: string) => void;
}

const ActiveWorkspaceRootCtx = createContext<ActiveWorkspaceCtxValue | null>(
	null,
);

/**
 * Owns the active workspace pointer for one pane, in memory only. Mounted
 * once per VertexFlowView instance (see view.tsx), so splitting a pane gives
 * each side its own independent value — nothing here is written to plugin
 * settings or disk, so it can't leak across panes or across synced devices.
 */
export function ActiveWorkspaceProvider({
	plugin,
	children,
}: {
	plugin: VertexFlowPlugin;
	children: ReactNode;
}) {
	const [root, setRootState] = useState<string | null>(
		plugin.lastActiveWorkspaceRoot,
	);
	const setRoot = useCallback(
		(next: string) => {
			setRootState(next);
			// Runtime-only "last touched" pointer — read by main.ts quickCapture()
			// and used to seed newly opened panes. Never persisted.
			plugin.lastActiveWorkspaceRoot = next;
		},
		[plugin],
	);
	const value = useMemo(() => ({ root, setRoot }), [root, setRoot]);
	return (
		<ActiveWorkspaceRootCtx.Provider value={value}>
			{children}
		</ActiveWorkspaceRootCtx.Provider>
	);
}

/** The setter for this pane's active workspace root. */
export function useSetActiveWorkspace(): (root: string) => void {
	const ctx = useContext(ActiveWorkspaceRootCtx);
	if (!ctx) {
		throw new Error(
			"useSetActiveWorkspace must be used inside <ActiveWorkspaceProvider>",
		);
	}
	return ctx.setRoot;
}

/** The workspace currently selected in the switcher, fully resolved. */
export function useActiveWorkspace(): ActiveWorkspace | null {
	const workspaces = useWorkspaces();
	const ctx = useContext(ActiveWorkspaceRootCtx);
	if (!ctx) {
		throw new Error(
			"useActiveWorkspace must be used inside <ActiveWorkspaceProvider>",
		);
	}

	return useMemo(() => {
		const snapshot =
			workspaces.find((w) => w.workspace.root === ctx.root) ??
			workspaces[0] ??
			null;
		if (!snapshot) return null;

		return {
			snapshot,
			taxonomies: workspaceTaxonomies(snapshot.workspace),
			context: snapshotContext(snapshot),
		};
	}, [workspaces, ctx.root]);
}

interface SidebarChromeCtxValue extends SidebarChromeState {
	setMinimized: (minimized: boolean) => void;
	setWidth: (width: number) => void;
	toggleSection: (id: string) => void;
}

const SidebarChromeCtx = createContext<SidebarChromeCtxValue | null>(null);

/**
 * Owns sidebar chrome (minimize, width, per-section collapse) for one pane,
 * in memory only. Mounted once per VertexFlowView instance (see view.tsx),
 * so splitting a pane gives each side its own independent value — nothing
 * here is written to plugin settings or disk, so it can't leak across panes
 * or across synced devices. A newly mounted pane seeds from
 * `plugin.lastSidebarChrome` (whichever pane was touched most recently this
 * session) so a fresh split doesn't visually reset.
 */
export function SidebarChromeProvider({
	plugin,
	children,
}: {
	plugin: VertexFlowPlugin;
	children: ReactNode;
}) {
	const [state, setState] = useState<SidebarChromeState>(
		plugin.lastSidebarChrome ?? DEFAULT_SIDEBAR_CHROME,
	);

	const setMinimized = useCallback(
		(minimized: boolean) => {
			setState((prev) => {
				const next = { ...prev, minimized };
				plugin.lastSidebarChrome = next;
				return next;
			});
		},
		[plugin],
	);

	const setWidth = useCallback(
		(width: number) => {
			setState((prev) => {
				const next = { ...prev, width };
				plugin.lastSidebarChrome = next;
				return next;
			});
		},
		[plugin],
	);

	const toggleSection = useCallback(
		(id: string) => {
			setState((prev) => {
				const next = {
					...prev,
					collapsed: {
						...prev.collapsed,
						[id]: !(prev.collapsed[id] === true),
					},
				};
				plugin.lastSidebarChrome = next;
				return next;
			});
		},
		[plugin],
	);

	const value = useMemo(
		() => ({ ...state, setMinimized, setWidth, toggleSection }),
		[state, setMinimized, setWidth, toggleSection],
	);

	return (
		<SidebarChromeCtx.Provider value={value}>
			{children}
		</SidebarChromeCtx.Provider>
	);
}

export function useSidebarChrome(): SidebarChromeCtxValue {
	const ctx = useContext(SidebarChromeCtx);
	if (!ctx) {
		throw new Error(
			"useSidebarChrome must be used inside <SidebarChromeProvider>",
		);
	}
	return ctx;
}

/**
 * The "All Tasks" System View. User Saved Views open in their own tabs (see
 * `tabs-context`), so this no longer depends on any "active view" setting.
 */
export function useBuiltInView(snapshot: WorkspaceSnapshot): SavedView {
	return (
		snapshot.views.find((view) => view.id === SYSTEM_VIEW_ALL_TASKS_ID) ??
		snapshot.views[0]
	);
}

/** Resolve a view id to its definition, falling back to the built-in. */
export function viewById(snapshot: WorkspaceSnapshot, id: string): SavedView {
	return (
		snapshot.views.find((view) => view.id === id) ??
		snapshot.views.find((view) => view.id === SYSTEM_VIEW_ALL_TASKS_ID) ??
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
