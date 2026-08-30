/**
 * One tab strip for everything: the List/Board views, Projects, Settings, and
 * every open task all live as tabs in this single strip, none of them able to
 * block access to the others.
 *
 * There is no longer a pinned, unclosable tab. Every tab — All Tasks and Inbox
 * included — is freely closable and freely reorderable; closing the last one
 * leaves `activeId === null` and the shell renders its empty-tabs pane. A
 * brand-new workspace explicitly opens All Tasks (see `plugin.pendingOpenView`),
 * since nothing keeps a tab open on its behalf anymore.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useActiveWorkspace, usePlugin, useSetActiveWorkspace } from "./context";
import {
	reorderTabs,
	shouldPromptUnsavedGuard,
	type GuardedAction,
} from "./tabs-guard";

/** The non-task screens, each a single reusable tab (never duplicated). */
export type BrowseKind =
	| "projects"
	| "settings"
	| "help"
	| "new-workspace"
	| "dashboards"
	| "views";

export type Tab =
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

function taskTabId(path: string): string {
	// Paths always contain a slash (they're vault-relative), so this can never
	// collide with the fixed "projects"/"settings"/… ids above.
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
	tabs: Tab[];
	/** Null when no tab is open — the shell shows its empty-tabs pane. */
	activeId: string | null;
	/** Null when no tab is open. */
	activeTab: Tab | null;
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
	activate: (id: string) => void;
	/**
	 * Move a tab to a new position in the strip. `toIndex` is an insertion gap
	 * in the current list. Every tab is freely reorderable. Never changes which
	 * tab is active.
	 */
	reorder: (tabId: string, toIndex: number) => void;
	/** Close a tab. Closing the last one leaves `activeId === null`. */
	close: (id: string) => void;
	closeActive: () => void;
	/** Bulk-close every open task tab, keeping the browse/view tabs. */
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
	/**
	 * Register (or clear, with null) a check for unsaved changes on the
	 * *currently active* tab. Called before any navigation away from — or
	 * closure of — that tab. Resolving `true` lets the navigation proceed;
	 * `false` cancels it.
	 *
	 * Only the active tab is ever mounted, so only it can hold a live draft;
	 * the component that owns the draft registers the guard and clears it both
	 * when the draft goes clean and on unmount.
	 */
	setUnsavedGuard: (guard: (() => Promise<boolean>) | null) => void;
}

const TabsCtx = createContext<TabsApi | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
	const plugin = usePlugin();
	const setActiveWorkspace = useSetActiveWorkspace();
	// This pane's currently-displayed workspace root — what `openTask` compares
	// against to decide whether following a link needs a cross-workspace switch.
	const activeWorkspaceRoot =
		useActiveWorkspace()?.snapshot.workspace.root ?? null;
	const [tabs, setTabs] = useState<Tab[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);

	// A ref mirror so the (now async) navigation callbacks can read the current
	// active tab without taking it as a dependency — keeps their identity stable.
	const activeIdRef = useRef(activeId);
	activeIdRef.current = activeId;

	// The active tab's unsaved-changes check, if it registered one.
	const guardRef = useRef<(() => Promise<boolean>) | null>(null);
	const setUnsavedGuard = useCallback(
		(guard: (() => Promise<boolean>) | null) => {
			guardRef.current = guard;
		},
		[],
	);

	/**
	 * Whether navigation away from — or closure of — the active tab may proceed.
	 * The skip rules live in `shouldPromptUnsavedGuard` (pure, unit-tested).
	 */
	const mayLeaveActive = useCallback(
		async (action: GuardedAction, targetId: string): Promise<boolean> => {
			const guard = guardRef.current;
			if (
				!shouldPromptUnsavedGuard({
					hasGuard: guard != null,
					action,
					targetId,
					activeId: activeIdRef.current ?? "",
				})
			) {
				return true;
			}
			return guard!();
		},
		[],
	);

	const openTask = useCallback(
		async (path: string) => {
			const id = taskTabId(path);
			if (!(await mayLeaveActive("navigate", id))) return;

			// A task can belong to a workspace other than whichever one this pane
			// is currently showing — e.g. following a `[[wikilink]]` from another
			// workspace's task, or a cross-workspace relation. Without switching
			// first, the panel would look the task up in the wrong snapshot and
			// find nothing. The switch is per-pane (in-memory), so the other
			// split panes are unaffected.
			const owner = plugin.index.workspaceFor(path);
			if (owner && owner.workspace.root !== activeWorkspaceRoot) {
				setActiveWorkspace(owner.workspace.root);
			}

			setTabs((current) =>
				current.some((tab) => tab.id === id)
					? current
					: [...current, { id, kind: "task", path }],
			);
			setActiveId(id);
		},
		[plugin, activeWorkspaceRoot, setActiveWorkspace, mayLeaveActive],
	);

	const openScreen = useCallback(
		async (kind: BrowseKind) => {
			if (!(await mayLeaveActive("navigate", kind))) return;
			setTabs((current) =>
				current.some((tab) => tab.id === kind)
					? current
					: [...current, { id: kind, kind }],
			);
			setActiveId(kind);
		},
		[mayLeaveActive],
	);

	const openView = useCallback(
		async (viewId: string) => {
			const id = viewTabId(viewId);
			if (!(await mayLeaveActive("navigate", id))) return;
			setTabs((current) =>
				current.some((tab) => tab.id === id)
					? current
					: [...current, { id, kind: "view", viewId }],
			);
			setActiveId(id);
		},
		[mayLeaveActive],
	);

	const openLabel = useCallback(
		async (labelId: string) => {
			const id = labelTabId(labelId);
			if (!(await mayLeaveActive("navigate", id))) return;
			setTabs((current) =>
				current.some((tab) => tab.id === id)
					? current
					: [...current, { id, kind: "label", labelId }],
			);
			setActiveId(id);
		},
		[mayLeaveActive],
	);

	const openProject = useCallback(
		async (path: string) => {
			// No cross-workspace switch (unlike `openTask`): a project is only ever
			// opened from its own workspace's sidebar or browse screen.
			const id = projectTabId(path);
			if (!(await mayLeaveActive("navigate", id))) return;
			setTabs((current) =>
				current.some((tab) => tab.id === id)
					? current
					: [...current, { id, kind: "project", path }],
			);
			setActiveId(id);
		},
		[mayLeaveActive],
	);

	const openDashboard = useCallback(
		async (dashboardId: string) => {
			const id = dashboardTabId(dashboardId);
			if (!(await mayLeaveActive("navigate", id))) return;
			setTabs((current) =>
				current.some((tab) => tab.id === id)
					? current
					: [...current, { id, kind: "dashboard", dashboardId }],
			);
			setActiveId(id);
		},
		[mayLeaveActive],
	);

	const activate = useCallback(
		async (id: string) => {
			if (!(await mayLeaveActive("navigate", id))) return;
			setActiveId(id);
		},
		[mayLeaveActive],
	);

	// Reordering is not navigation — it never touches `activeId`, so it doesn't
	// run the unsaved-changes guard.
	const reorder = useCallback((tabId: string, toIndex: number) => {
		setTabs((current) => reorderTabs(current, tabId, toIndex));
	}, []);

	const close = useCallback(
		async (id: string) => {
			// The guard only fires for a close of the *active* tab (see
			// `shouldPromptUnsavedGuard`) — a background tab holds no live draft.
			if (!(await mayLeaveActive("close", id))) return;

			setTabs((current) => {
				const index = current.findIndex((tab) => tab.id === id);
				if (index === -1) return current;
				const next = current.filter((tab) => tab.id !== id);

				setActiveId((active) => {
					if (active !== id) return active;
					// Prefer the neighbour to the right, like a browser. Closing the
					// last tab leaves nothing active — the empty-tabs pane renders.
					if (next.length === 0) return null;
					return next[Math.min(index, next.length - 1)].id;
				});

				return next;
			});
		},
		[mayLeaveActive],
	);

	const closeActive = useCallback(() => {
		const active = activeIdRef.current;
		if (active) void close(active);
	}, [close]);

	const closeAllTasks = useCallback(() => {
		setTabs((current) => current.filter((tab) => tab.kind !== "task"));
		setActiveId((active) => {
			// Only the active tab's *kind* matters here, read from this render's
			// `tabs` — legitimately a dependency, not a stale closure: this just
			// decides whether the active tab is one of the ones about to be
			// removed.
			const activeTab = tabs.find((tab) => tab.id === active);
			if (activeTab && activeTab.kind !== "task") return active;
			const survivor = tabs.find((tab) => tab.kind !== "task");
			return survivor ? survivor.id : null;
		});
	}, [tabs]);

	/** Shared prune body: drop non-matching tabs of `kind`, keep `activeId` sane. */
	const makePrune = useCallback(
		<T extends Tab["kind"]>(
			kind: T,
			keep: (tab: Extract<Tab, { kind: T }>) => boolean,
		) => {
			setTabs((current) => {
				const next = current.filter(
					(tab) =>
						tab.kind !== kind ||
						keep(tab as Extract<Tab, { kind: T }>),
				);
				if (next.length === current.length) return current;
				setActiveId((active) =>
					next.some((tab) => tab.id === active)
						? active
						: (next[0]?.id ?? null),
				);
				return next;
			});
		},
		[],
	);

	const pruneTasks = useCallback(
		(existing: (path: string) => boolean) =>
			makePrune("task", (tab) => existing(tab.path)),
		[makePrune],
	);
	const pruneViews = useCallback(
		(existing: (viewId: string) => boolean) =>
			makePrune("view", (tab) => existing(tab.viewId)),
		[makePrune],
	);
	const pruneLabels = useCallback(
		(existing: (labelId: string) => boolean) =>
			makePrune("label", (tab) => existing(tab.labelId)),
		[makePrune],
	);
	const pruneDashboards = useCallback(
		(existing: (dashboardId: string) => boolean) =>
			makePrune("dashboard", (tab) => existing(tab.dashboardId)),
		[makePrune],
	);
	const pruneProjects = useCallback(
		(existing: (path: string) => boolean) =>
			makePrune("project", (tab) => existing(tab.path)),
		[makePrune],
	);

	// Drop task tabs whose task is gone from the vault entirely — not
	// conditioned on any particular screen being mounted, since a task can be
	// deleted (from the Board, from another device via sync, by hand) while
	// its tab is sitting in the background.
	useEffect(
		() =>
			plugin.index.subscribe(() =>
				pruneTasks((path) => plugin.index.taskAt(path) != null),
			),
		[plugin, pruneTasks],
	);

	// A brand-new workspace has nothing keeping a tab open, so the shell would
	// land on the empty-tabs pane. Workspace creation leaves the view to open
	// here (mirrors `plugin.pendingEditPath`); consume it once, on the mount
	// that follows creation and on the workspace switch that follows a create
	// from the sidebar.
	useEffect(() => {
		const pending = plugin.pendingOpenView;
		if (!pending) return;
		plugin.pendingOpenView = null;
		void openView(pending);
	}, [plugin, activeWorkspaceRoot, openView]);

	const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;

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
			activate,
			reorder,
			close,
			closeActive,
			closeAllTasks,
			pruneTasks,
			pruneViews,
			pruneLabels,
			pruneDashboards,
			pruneProjects,
			setUnsavedGuard,
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
			activate,
			reorder,
			close,
			closeActive,
			closeAllTasks,
			pruneTasks,
			pruneViews,
			pruneLabels,
			pruneDashboards,
			pruneProjects,
			setUnsavedGuard,
		],
	);

	return <TabsCtx.Provider value={api}>{children}</TabsCtx.Provider>;
}

export function useTabs(): TabsApi {
	const value = useContext(TabsCtx);
	if (!value) throw new Error("useTabs must be used inside <TabsProvider>");
	return value;
}
