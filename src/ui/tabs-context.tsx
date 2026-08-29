/**
 * One tab strip for everything: the Board/List, Projects, Settings, and every
 * open task all live as tabs in this single strip, none of them able to block
 * access to the others.
 *
 * This replaces an earlier design where opening a task took over the whole
 * content area — closing every task tab was the only way back to the board.
 * The fix is structural, not cosmetic: there is always a pinned "workspace"
 * tab (the Board/List, following whatever Saved View is selected) that can
 * never be closed, so the board is never more than one click away regardless
 * of how many other tabs are open.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { usePlugin, useSettingsWriter } from "./context";

/** The non-task screens, each a single reusable tab (never duplicated). */
export type BrowseKind = "projects" | "settings" | "help" | "new-workspace";

export type Tab =
	/** The built-in "Tasks" view — pinned, always present, always first, never closed. */
	| { id: "workspace"; kind: "workspace" }
	| { id: BrowseKind; kind: BrowseKind }
	| { id: string; kind: "task"; path: string }
	/** A user Saved View, opened from the sidebar. Closable. */
	| { id: string; kind: "view"; viewId: string }
	/** A dashboard, opened from the sidebar. Closable. */
	| { id: string; kind: "dashboard"; dashboardId: string }
	/** A label's tasks — a synthesised, never-persisted view. Closable. */
	| { id: string; kind: "label"; labelId: string }
	/** One project: a detail header above its tasks (synthesised view). Closable. */
	| { id: string; kind: "project"; path: string };

const WORKSPACE_TAB: Tab = { id: "workspace", kind: "workspace" };

function taskTabId(path: string): string {
	// Paths always contain a slash (they're vault-relative), so this can never
	// collide with the fixed "workspace"/"projects"/… ids above.
	return path;
}

/** Prefixed so a view id like "tasks" can't collide with a fixed tab id. */
function viewTabId(viewId: string): string {
	return `view:${viewId}`;
}

function labelTabId(labelId: string): string {
	return `label:${labelId}`;
}

function dashboardTabId(dashboardId: string): string {
	return `dashboard:${dashboardId}`;
}

function projectTabId(path: string): string {
	return `project:${path}`;
}

export interface TabsApi {
	/** Always starts with the pinned workspace tab. */
	tabs: Tab[];
	activeId: string;
	activeTab: Tab;
	/** Open a task, adding a tab if it isn't already open, and focus it. */
	openTask: (path: string) => void;
	/** Open (or reveal) one of the singleton browse/settings tabs. */
	openScreen: (kind: BrowseKind) => void;
	/** Open (or reveal) a Saved View as its own tab. */
	openView: (viewId: string) => void;
	/** Open (or reveal) a label's tasks as its own transient tab. */
	openLabel: (labelId: string) => void;
	/** Open (or reveal) a dashboard as its own tab. */
	openDashboard: (dashboardId: string) => void;
	/** Open (or reveal) a project's detail screen as its own transient tab. */
	openProject: (path: string) => void;
	/** Switch to the pinned Board/List tab without opening anything new. */
	activateWorkspace: () => void;
	activate: (id: string) => void;
	/** Close a tab. A no-op on the pinned workspace tab — there's nothing to fall back to if it closed. */
	close: (id: string) => void;
	closeActive: () => void;
	/** Bulk-close every open task tab, keeping the workspace and any browse tabs. */
	closeAllTasks: () => void;
	/** Drop task tabs whose task no longer exists. Browse/settings tabs are never pruned. */
	pruneTasks: (existing: (path: string) => boolean) => void;
	/** Drop view tabs whose Saved View no longer exists (deleted, or a workspace switch). */
	pruneViews: (existing: (viewId: string) => boolean) => void;
	/** Drop label tabs whose label no longer exists. */
	pruneLabels: (existing: (labelId: string) => boolean) => void;
	/** Drop dashboard tabs whose dashboard no longer exists. */
	pruneDashboards: (existing: (dashboardId: string) => boolean) => void;
	/** Drop project tabs whose project no longer exists (deleted, or a workspace switch). */
	pruneProjects: (existing: (path: string) => boolean) => void;
}

const TabsCtx = createContext<TabsApi | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const [tabs, setTabs] = useState<Tab[]>([WORKSPACE_TAB]);
	const [activeId, setActiveId] = useState<string>("workspace");

	const openTask = useCallback(
		(path: string) => {
			// A task can belong to a workspace other than whichever one is
			// currently active — e.g. following a `[[wikilink]]` from another
			// workspace's task, or a cross-workspace relation. Without switching
			// first, the panel would look the task up in the wrong snapshot and
			// find nothing.
			const owner = plugin.index.workspaceFor(path);
			if (owner && owner.workspace.root !== plugin.settings.activeWorkspaceRoot) {
				writeSettings({ activeWorkspaceRoot: owner.workspace.root });
			}

			const id = taskTabId(path);
			setTabs((current) =>
				current.some((tab) => tab.id === id)
					? current
					: [...current, { id, kind: "task", path }],
			);
			setActiveId(id);
		},
		[plugin, writeSettings],
	);

	const openScreen = useCallback((kind: BrowseKind) => {
		setTabs((current) =>
			current.some((tab) => tab.id === kind) ? current : [...current, { id: kind, kind }],
		);
		setActiveId(kind);
	}, []);

	const openView = useCallback((viewId: string) => {
		const id = viewTabId(viewId);
		setTabs((current) =>
			current.some((tab) => tab.id === id)
				? current
				: [...current, { id, kind: "view", viewId }],
		);
		setActiveId(id);
	}, []);

	const openLabel = useCallback((labelId: string) => {
		const id = labelTabId(labelId);
		setTabs((current) =>
			current.some((tab) => tab.id === id)
				? current
				: [...current, { id, kind: "label", labelId }],
		);
		setActiveId(id);
	}, []);

	const openProject = useCallback((path: string) => {
		// No cross-workspace switch (unlike `openTask`): a project is only ever
		// opened from its own workspace's sidebar or browse screen.
		const id = projectTabId(path);
		setTabs((current) =>
			current.some((tab) => tab.id === id)
				? current
				: [...current, { id, kind: "project", path }],
		);
		setActiveId(id);
	}, []);

	const openDashboard = useCallback((dashboardId: string) => {
		const id = dashboardTabId(dashboardId);
		setTabs((current) =>
			current.some((tab) => tab.id === id)
				? current
				: [...current, { id, kind: "dashboard", dashboardId }],
		);
		setActiveId(id);
	}, []);

	const activateWorkspace = useCallback(() => setActiveId("workspace"), []);
	const activate = useCallback((id: string) => setActiveId(id), []);

	const close = useCallback((id: string) => {
		if (id === "workspace") return;

		setTabs((current) => {
			const index = current.findIndex((tab) => tab.id === id);
			if (index === -1) return current;
			const next = current.filter((tab) => tab.id !== id);

			setActiveId((active) => {
				if (active !== id) return active;
				// Prefer the neighbour to the right, like a browser; the pinned
				// workspace tab at index 0 is always there as the final fallback.
				return next[Math.min(index, next.length - 1)].id;
			});

			return next;
		});
	}, []);

	const closeActive = useCallback(() => close(activeId), [close, activeId]);

	const closeAllTasks = useCallback(() => {
		setTabs((current) => current.filter((tab) => tab.kind !== "task"));
		setActiveId((active) => {
			// Only the active tab's *kind* matters here, read from this render's
			// `tabs` — legitimately a dependency, not a stale closure: this just
			// decides whether the active tab is one of the ones about to be
			// removed.
			const activeTab = tabs.find((tab) => tab.id === active);
			return activeTab && activeTab.kind !== "task" ? active : "workspace";
		});
	}, [tabs]);

	const pruneTasks = useCallback((existing: (path: string) => boolean) => {
		setTabs((current) => {
			const next = current.filter((tab) => tab.kind !== "task" || existing(tab.path));
			if (next.length === current.length) return current;
			setActiveId((active) =>
				next.some((tab) => tab.id === active) ? active : "workspace",
			);
			return next;
		});
	}, []);

	const pruneViews = useCallback((existing: (viewId: string) => boolean) => {
		setTabs((current) => {
			const next = current.filter(
				(tab) => tab.kind !== "view" || existing(tab.viewId),
			);
			if (next.length === current.length) return current;
			setActiveId((active) =>
				next.some((tab) => tab.id === active) ? active : "workspace",
			);
			return next;
		});
	}, []);

	const pruneLabels = useCallback((existing: (labelId: string) => boolean) => {
		setTabs((current) => {
			const next = current.filter(
				(tab) => tab.kind !== "label" || existing(tab.labelId),
			);
			if (next.length === current.length) return current;
			setActiveId((active) =>
				next.some((tab) => tab.id === active) ? active : "workspace",
			);
			return next;
		});
	}, []);

	const pruneDashboards = useCallback(
		(existing: (dashboardId: string) => boolean) => {
			setTabs((current) => {
				const next = current.filter(
					(tab) => tab.kind !== "dashboard" || existing(tab.dashboardId),
				);
				if (next.length === current.length) return current;
				setActiveId((active) =>
					next.some((tab) => tab.id === active) ? active : "workspace",
				);
				return next;
			});
		},
		[],
	);

	const pruneProjects = useCallback((existing: (path: string) => boolean) => {
		setTabs((current) => {
			const next = current.filter(
				(tab) => tab.kind !== "project" || existing(tab.path),
			);
			if (next.length === current.length) return current;
			setActiveId((active) =>
				next.some((tab) => tab.id === active) ? active : "workspace",
			);
			return next;
		});
	}, []);

	// Drop task tabs whose task is gone from the vault entirely — not
	// conditioned on any particular screen being mounted, since a task can be
	// deleted (from the Board, from another device via sync, by hand) while
	// its tab is sitting in the background.
	useEffect(
		() => plugin.index.subscribe(() => pruneTasks((path) => plugin.index.taskAt(path) != null)),
		[plugin, pruneTasks],
	);

	const activeTab = tabs.find((tab) => tab.id === activeId) ?? WORKSPACE_TAB;

	const api = useMemo<TabsApi>(
		() => ({
			tabs,
			activeId,
			activeTab,
			openTask,
			openScreen,
			openView,
			openLabel,
			openDashboard,
			openProject,
			activateWorkspace,
			activate,
			close,
			closeActive,
			closeAllTasks,
			pruneTasks,
			pruneViews,
			pruneLabels,
			pruneDashboards,
			pruneProjects,
		}),
		[
			tabs,
			activeId,
			activeTab,
			openTask,
			openScreen,
			openView,
			openLabel,
			openDashboard,
			openProject,
			activateWorkspace,
			activate,
			close,
			closeActive,
			closeAllTasks,
			pruneTasks,
			pruneViews,
			pruneLabels,
			pruneDashboards,
			pruneProjects,
		],
	);

	return <TabsCtx.Provider value={api}>{children}</TabsCtx.Provider>;
}

export function useTabs(): TabsApi {
	const value = useContext(TabsCtx);
	if (!value) throw new Error("useTabs must be used inside <TabsProvider>");
	return value;
}
