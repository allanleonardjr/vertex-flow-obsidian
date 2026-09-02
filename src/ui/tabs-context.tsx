/**
 * One tab strip for everything: the List/Board views, Projects, Settings, and
 * every open task all live as tabs in this single strip, none of them able to
 * block access to the others.
 *
 * There is no longer a pinned, unclosable tab. Every tab — All Tasks and Untriaged
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
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type VertexFlowPlugin from "../main";
import { SYSTEM_VIEW_ALL_TASKS_ID, isSystemViewId } from "../core/views";
import type { DashboardConfig, SavedView } from "../core/types";
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
	| "views"
	| "trash"
	| "labels"
	| "people";

export type Tab =
	| { id: BrowseKind; kind: BrowseKind }
	| { id: string; kind: "task"; path: string }
	/**
	 * A Saved View, opened from the sidebar. Closable.
	 *
	 * `root` is set only for the two System Views (All Tasks / Untriaged), whose
	 * ids every workspace shares — it binds the tab to one workspace so several
	 * can be open at once (`All Tasks - Product` beside `All Tasks - Marketing`).
	 * User Saved Views have a vault-unique id, so they leave `root` undefined and
	 * resolve their owner through the index like Dashboard/Label/Project tabs.
	 */
	| { id: string; kind: "view"; viewId: string; root?: string }
	/** A dashboard, opened from the sidebar. Closable. */
	| { id: string; kind: "dashboard"; dashboardId: string }
	/** A label's tasks — a synthesised, never-persisted view. Closable. */
	| { id: string; kind: "label"; labelId: string }
	/** One person: a detail header above their assigned tasks. Closable. */
	| { id: string; kind: "person"; personId: string }
	/** One project: a detail header above its tasks (synthesised view). Closable. */
	| { id: string; kind: "project"; path: string };

function taskTabId(path: string): string {
	// Paths always contain a slash (they're vault-relative), so this can never
	// collide with the fixed "projects"/"settings"/… ids above.
	return path;
}

/**
 * Prefixed so a view id like "tasks" can't collide with a fixed tab id. System
 * Views additionally fold in the owning workspace `root`, so each workspace's
 * All Tasks / Untriaged is its own tab; user views (vault-unique id) don't.
 */
function viewTabId(viewId: string, root?: string): string {
	return isSystemViewId(viewId) ? `view:${root ?? ""}:${viewId}` : `view:${viewId}`;
}

function labelTabId(labelId: string): string {
	return `label:${labelId}`;
}

function personTabId(personId: string): string {
	return `person:${personId}`;
}

function dashboardTabId(dashboardId: string): string {
	return `dashboard:${dashboardId}`;
}

function projectTabId(path: string): string {
	return `project:${path}`;
}

/**
 * The workspace a tab is bound to, or `null` when it renders fine against any
 * workspace (the browse screens only — the two System Views All Tasks /
 * Untriaged are now bound too, via the tab's `root`).
 *
 * View/Dashboard/Label/Project tabs survive a workspace switch (their drafts are
 * safe in the store), but their content pane resolves against the *active*
 * snapshot — so whenever such a tab is the active one, the active workspace has
 * to match it, or the pane shows "this dashboard no longer exists" / the wrong
 * view. `activate` enforces that on click; a layout effect re-homes the active
 * tab after a sidebar workspace switch.
 */
export function tabWorkspaceRoot(
	plugin: VertexFlowPlugin,
	tab: Tab,
): string | null {
	switch (tab.kind) {
		case "task":
		case "project":
			return plugin.index.workspaceFor(tab.path)?.workspace.root ?? null;
		case "view":
			if (isSystemViewId(tab.viewId)) return tab.root ?? null;
			return (
				plugin.index.snapshotWithView(tab.viewId)?.workspace.root ?? null
			);
		case "dashboard":
			return (
				plugin.index.snapshotWithDashboard(tab.dashboardId)?.workspace
					.root ?? null
			);
		case "label":
			return (
				plugin.index.snapshotWithLabel(tab.labelId)?.workspace.root ??
				null
			);
		case "person":
			return (
				plugin.index.snapshotWithPerson(tab.personId)?.workspace.root ??
				null
			);
		default:
			return null;
	}
}

/**
 * The workspace a tab's *content* is currently associated with, for accent
 * coloring — broader than `tabWorkspaceRoot`. Task/Project/View/Dashboard/
 * Label tabs keep their fixed owner. Projects/Dashboards/Views/Labels/Trash/
 * Settings hub tabs have no fixed owner but do render whichever workspace is
 * currently active (same relationship the Settings tab's own label already
 * reflects), so they resolve to `activeRoot` instead of `null`. Help and
 * New-workspace are the only tabs with no workspace relationship at all —
 * their content never changes based on which workspace is active.
 */
export function tabAccentRoot(
	plugin: VertexFlowPlugin,
	tab: Tab,
	activeRoot: string,
): string | null {
	switch (tab.kind) {
		case "task":
		case "project":
		case "view":
		case "dashboard":
		case "label":
		case "person":
			return tabWorkspaceRoot(plugin, tab);
		case "projects":
		case "dashboards":
		case "views":
		case "labels":
		case "people":
		case "trash":
		case "settings":
			return activeRoot;
		case "help":
		case "new-workspace":
			return null;
	}
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
	/**
	 * Open (or reveal) the Help screen and land on a specific topic — and
	 * optionally a heading within it. `anchor` is a `slugifyHeading` slug of a
	 * heading inside that topic's content. Transient, per-pane, never persisted:
	 * `HelpView` consumes the target once, the same way it would a freshly
	 * opened tab, then clears it so a later manual navigation isn't clobbered.
	 */
	openHelp: (topicId: string, anchor?: string) => void;
	/**
	 * The pending Help deep-link target, if any. Set by `openHelp`; read once
	 * by `HelpView` (which then clears it via `clearPendingHelpTarget`).
	 */
	pendingHelpTarget: { topicId: string; anchor?: string } | null;
	/** Clear the pending Help target after `HelpView` has consumed it. */
	clearPendingHelpTarget: () => void;
	/**
	 * Open (or reveal) a Saved View as its own tab. For a System View (All
	 * Tasks / Untriaged) pass `root` to bind the tab to a specific workspace;
	 * omitted, it binds to the active one. User views ignore `root`.
	 */
	openView: (viewId: string, root?: string) => void;
	/** Open (or reveal) a label's tasks as its own transient tab. */
	openLabel: (labelId: string) => void;
	/** Open (or reveal) a person's detail screen as its own transient tab. */
	openPerson: (personId: string) => void;
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
	/**
	 * Call right after switching this pane's active workspace from the sidebar,
	 * in the same event handler. If the front tab belongs to the workspace just
	 * left, switch to an already-open tab that renders against the new one (a
	 * tab bound to it, else a browse tab); only open the new workspace's All
	 * Tasks when nothing showable is open. The foreign tab stays in the strip
	 * (accent-coloured); clicking it switches back to its workspace.
	 */
	syncToWorkspace: (root: string) => void;
	/** Bulk-close every open task tab, keeping the browse/view tabs. */
	closeAllTasks: () => void;
	/**
	 * Close every tab except `keepId`, leaving it as the sole (and active) tab.
	 * The unsaved-changes guard runs exactly once — for the active tab when it's
	 * among the ones being closed (i.e. `keepId` itself isn't active).
	 */
	closeAllOtherTabs: (keepId: string) => void;
	/**
	 * Close every tab to the right of `id` in the strip (browser-style), leaving
	 * `id` and everything to its left. Guarded the same way as `closeAllOtherTabs`.
	 */
	closeTabsToRight: (id: string) => void;
	/** Close every open tab. Guarded for the active tab, then empties the strip. */
	closeAllTabs: () => void;
	/** Drop task tabs whose task no longer exists. Browse/settings tabs are never pruned. */
	pruneTasks: (existing: (path: string) => boolean) => void;
	/** Drop view tabs whose Saved View no longer exists (deleted, or a workspace switch). */
	pruneViews: (existing: (viewId: string) => boolean) => void;
	/** Drop label tabs whose label no longer exists. */
	pruneLabels: (existing: (labelId: string) => boolean) => void;
	/** Drop person tabs whose person no longer exists. */
	prunePeople: (existing: (personId: string) => boolean) => void;
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

	/**
	 * The transient draft store for View / Dashboard tab edits — the only
	 * genuinely unsaved state in the app (everything else writes straight
	 * through). It lives here in `TabsProvider`, *above* the per-workspace
	 * remount boundary (see the comment on `<Workspace key=… />` in App.tsx), so
	 * a draft survives both tab switches and workspace switches. Memory-only:
	 * still lost on plugin reload / Obsidian restart, by design.
	 *
	 * Keyed by `viewId` / `dashboardId`. Setting `null` clears the entry.
	 */
	getViewDraft: (viewId: string) => SavedView | null;
	setViewDraft: (viewId: string, value: SavedView | null) => void;
	getDashboardDraft: (dashboardId: string) => DashboardConfig | null;
	setDashboardDraft: (
		dashboardId: string,
		value: DashboardConfig | null,
	) => void;

	/**
	 * The selection (focused task + multi-selection + scroll position) a view tab
	 * last had when it was in front, so switching back restores your place.
	 * Keyed by tab id.
	 */
	getSelectionSnapshot: (
		tabId: string,
	) => { focusedPath: string | null; selectedPaths: string[]; scrollTop: number } | null;
	setSelectionSnapshot: (
		tabId: string,
		snapshot: { focusedPath: string | null; selectedPaths: string[]; scrollTop: number } | null,
	) => void;
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
	// Transient deep-link intent for the Help screen — see `openHelp` below.
	// Lives here (above the per-workspace remount boundary) with the View/
	// Dashboard drafts, so the intent survives the tab switch that HelpView
	// then consumes and clears.
	const [pendingHelpTarget, setPendingHelpTarget] = useState<{
		topicId: string;
		anchor?: string;
	} | null>(null);

	// Ref mirrors so the async navigation callbacks and the re-home layout
	// effect can read the current tab list / active workspace without taking
	// them as dependencies.
	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;
	const activeWorkspaceRootRef = useRef(activeWorkspaceRoot);
	activeWorkspaceRootRef.current = activeWorkspaceRoot;

	// Transient View / Dashboard drafts, lifted out of the per-view/dashboard
	// component (where they died on every tab background) into the provider.
	// Only non-null drafts are stored; clearing deletes the key. Reads go
	// through refs so `getViewDraft` / the prune closures see the current value
	// without taking the maps as a dependency; the maps are still in the `api`
	// memo deps so consumers re-render when a draft changes.
	const [viewDrafts, setViewDrafts] = useState<Record<string, SavedView>>({});
	const [dashboardDrafts, setDashboardDrafts] = useState<
		Record<string, DashboardConfig>
	>({});
	const viewDraftsRef = useRef(viewDrafts);
	viewDraftsRef.current = viewDrafts;
	const dashboardDraftsRef = useRef(dashboardDrafts);
	dashboardDraftsRef.current = dashboardDrafts;

	// Per-tab selection snapshots. TaskViewport saves its focused path (and
	// multi-selection) and scroll position whenever it loses the active tab,
	// and restores them when it regains the tab — so switching away and back
	// keeps your place instead of resetting to an empty selection. Keyed by
	// tab id (`view.id`), the same way view drafts are keyed by `viewId`.
	// Memory-only; discarded with the workspace on switch (the whole
	// SelectionProvider remounts then).
	const [selectionSnapshots, setSelectionSnapshots] = useState<
		Record<string, { focusedPath: string | null; selectedPaths: string[]; scrollTop: number }>
	>({});
	const selectionSnapshotsRef = useRef(selectionSnapshots);
	selectionSnapshotsRef.current = selectionSnapshots;

	const getSelectionSnapshot = useCallback(
		(tabId: string): { focusedPath: string | null; selectedPaths: string[]; scrollTop: number } | null =>
			selectionSnapshotsRef.current[tabId] ?? null,
		[],
	);
	const setSelectionSnapshot = useCallback(
		(
			tabId: string,
			snapshot: { focusedPath: string | null; selectedPaths: string[]; scrollTop: number } | null,
		) => {
			setSelectionSnapshots((current) => {
				if (snapshot == null) {
					if (!(tabId in current)) return current;
					const next = { ...current };
					delete next[tabId];
					return next;
				}
				return { ...current, [tabId]: snapshot };
			});
		},
		[],
	);

	const getViewDraft = useCallback(
		(viewId: string): SavedView | null =>
			viewDraftsRef.current[viewId] ?? null,
		[],
	);
	const setViewDraft = useCallback(
		(viewId: string, value: SavedView | null) => {
			setViewDrafts((current) => {
				if (value == null) {
					if (!(viewId in current)) return current;
					const next = { ...current };
					delete next[viewId];
					return next;
				}
				if (current[viewId] === value) return current;
				return { ...current, [viewId]: value };
			});
		},
		[],
	);
	const getDashboardDraft = useCallback(
		(dashboardId: string): DashboardConfig | null =>
			dashboardDraftsRef.current[dashboardId] ?? null,
		[],
	);
	const setDashboardDraft = useCallback(
		(dashboardId: string, value: DashboardConfig | null) => {
			setDashboardDrafts((current) => {
				if (value == null) {
					if (!(dashboardId in current)) return current;
					const next = { ...current };
					delete next[dashboardId];
					return next;
				}
				if (current[dashboardId] === value) return current;
				return { ...current, [dashboardId]: value };
			});
		},
		[],
	);

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
		(path: string) => {
			void (async () => {
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
			})();
		},
		[plugin, activeWorkspaceRoot, setActiveWorkspace, mayLeaveActive],
	);

	const openScreen = useCallback(
		(kind: BrowseKind) => {
			void (async () => {
				if (!(await mayLeaveActive("navigate", kind))) return;
				setTabs((current) =>
					current.some((tab) => tab.id === kind)
						? current
						: [...current, { id: kind, kind }],
				);
				setActiveId(kind);
			})();
		},
		[mayLeaveActive],
	);

	const openHelp = useCallback(
		(topicId: string, anchor?: string) => {
			void (async () => {
				if (!(await mayLeaveActive("navigate", "help"))) return;
				// Stash the intent before opening, so `setActiveId("help")` below
				// triggers HelpView (which reads this once and clears it).
				setPendingHelpTarget({ topicId, ...(anchor ? { anchor } : {}) });
				setTabs((current) =>
					current.some((tab) => tab.id === "help")
						? current
						: [...current, { id: "help", kind: "help" }],
				);
				setActiveId("help");
			})();
		},
		[mayLeaveActive],
	);

	const clearPendingHelpTarget = useCallback(() => {
		setPendingHelpTarget(null);
	}, []);

	const openView = useCallback(
		(viewId: string, explicitRoot?: string) => {
			void (async () => {
				const system = isSystemViewId(viewId);
				// A System View tab is pinned to one workspace: the caller's, or the
				// active one. A user view carries no root.
				const root = system
					? (explicitRoot ?? activeWorkspaceRootRef.current ?? undefined)
					: undefined;
				if (system && !root) return; // no workspace to bind to yet

				const id = viewTabId(viewId, root);
				if (!(await mayLeaveActive("navigate", id))) return;

				// Opening another workspace's System View switches the active
				// workspace to match — same move `activate` / `openTask` make so the
				// content pane resolves against the right snapshot.
				if (root && root !== activeWorkspaceRootRef.current) {
					setActiveWorkspace(root);
				}

				setTabs((current) =>
					current.some((tab) => tab.id === id)
						? current
						: [
								...current,
								root
									? { id, kind: "view", viewId, root }
									: { id, kind: "view", viewId },
							],
				);
				setActiveId(id);
			})();
		},
		[mayLeaveActive, setActiveWorkspace],
	);

	const openLabel = useCallback(
		(labelId: string) => {
			void (async () => {
				const id = labelTabId(labelId);
				if (!(await mayLeaveActive("navigate", id))) return;
				setTabs((current) =>
					current.some((tab) => tab.id === id)
						? current
						: [...current, { id, kind: "label", labelId }],
				);
				setActiveId(id);
			})();
		},
		[mayLeaveActive],
	);

	const openPerson = useCallback(
		(personId: string) => {
			void (async () => {
				const id = personTabId(personId);
				if (!(await mayLeaveActive("navigate", id))) return;
				setTabs((current) =>
					current.some((tab) => tab.id === id)
						? current
						: [...current, { id, kind: "person", personId }],
				);
				setActiveId(id);
			})();
		},
		[mayLeaveActive],
	);

	const openProject = useCallback(
		(path: string) => {
			void (async () => {
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
			})();
		},
		[mayLeaveActive],
	);

	const openDashboard = useCallback(
		(dashboardId: string) => {
			void (async () => {
				const id = dashboardTabId(dashboardId);
				if (!(await mayLeaveActive("navigate", id))) return;
				setTabs((current) =>
					current.some((tab) => tab.id === id)
						? current
						: [...current, { id, kind: "dashboard", dashboardId }],
				);
				setActiveId(id);
			})();
		},
		[mayLeaveActive],
	);

	const activate = useCallback(
		(id: string) => {
			void (async () => {
				if (!(await mayLeaveActive("navigate", id))) return;
				// A View/Dashboard/Label/Project tab can belong to a workspace other
				// than the one on screen (it survived a workspace switch). Its
				// content pane resolves against the active snapshot, so switch the
				// workspace to match before showing it — same move `openTask` makes
				// for a cross-workspace link.
				const tab = tabsRef.current.find((t) => t.id === id);
				if (tab) {
					const owner = tabWorkspaceRoot(plugin, tab);
					if (owner && owner !== activeWorkspaceRootRef.current) {
						setActiveWorkspace(owner);
					}
				}
				setActiveId(id);
			})();
		},
		[mayLeaveActive, plugin, setActiveWorkspace],
	);

	// Reordering is not navigation — it never touches `activeId`, so it doesn't
	// run the unsaved-changes guard.
	const reorder = useCallback((tabId: string, toIndex: number) => {
		setTabs((current) => reorderTabs(current, tabId, toIndex));
	}, []);

	const close = useCallback(
		(id: string) => {
			void (async () => {
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
			})();
		},
		[mayLeaveActive],
	);

	const closeActive = useCallback(() => {
		const active = activeIdRef.current;
		if (active) void close(active);
	}, [close]);

	// After the active workspace changes, the front tab may belong to the one
	// just left — its content pane would resolve against the wrong snapshot.
	// Switch to something already open that renders against `root` (a tab bound
	// to it, else a browse tab, which is workspace-agnostic), and only open
	// `root`'s All Tasks when the strip has nothing showable. Never stacks up a
	// System View per workspace merely visited.
	const syncToWorkspace = useCallback(
		(root: string) => {
			const active = tabsRef.current.find(
				(tab) => tab.id === activeIdRef.current,
			);
			if (!active) return; // empty strip — the count-0 effect lands it
			const owner = tabWorkspaceRoot(plugin, active);
			if (owner == null || owner === root) return; // front tab is fine

			const fallback =
				tabsRef.current.find(
					(tab) => tabWorkspaceRoot(plugin, tab) === root,
				) ??
				tabsRef.current.find(
					(tab) => tabWorkspaceRoot(plugin, tab) == null,
				);
			if (fallback) {
				setActiveId(fallback.id);
				return;
			}
			void openView(SYSTEM_VIEW_ALL_TASKS_ID, root);
		},
		[plugin, openView],
	);

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

	// Shared body for the "close a whole batch of tabs" family. `keep` decides
	// which tabs survive; the survivor (or `null` when the strip empties) becomes
	// active. The one guard check that matters is for the *active* tab: if it's
	// among the closing set and holds an unsaved draft, run the prompt —
	// background tabs never hold a live draft.
	const closeSubset = useCallback(
		async (keep: (tab: Tab) => boolean) => {
			const survivors = tabsRef.current.filter(keep);
			const closing = tabsRef.current.filter(
				(tab) => survivors.findIndex((s) => s.id === tab.id) === -1,
			);
			// Nothing being closed → no-op.
			if (closing.length === 0) return;

			const activeId = activeIdRef.current;
			const activeClosing =
				activeId != null && closing.some((tab) => tab.id === activeId);
			if (activeClosing && !(await mayLeaveActive("close", activeId)))
				return;

			// Only the guard could abort; if we got here the close always lands.
			setTabs(survivors);
			setActiveId(survivors.length > 0 ? survivors[0].id : null);
		},
		[mayLeaveActive],
	);

	const closeAllOtherTabs = useCallback(
		(keepId: string) => {
			void closeSubset((tab) => tab.id === keepId);
		},
		[closeSubset],
	);

	const closeTabsToRight = useCallback(
		(id: string) => {
			const index = tabsRef.current.findIndex((tab) => tab.id === id);
			if (index === -1) return;
			void closeSubset((tab) => {
				const i = tabsRef.current.indexOf(tab);
				return i <= index;
			});
		},
		[closeSubset],
	);

	const closeAllTabs = useCallback(() => {
		void closeSubset(() => false);
	}, [closeSubset]);

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
			// Never drop a tab that holds a real pending draft — even if its
			// underlying Saved View was genuinely deleted, keep the tab so the
			// edits aren't silently lost. A clean tab whose target is gone still
			// closes. A System View tab is kept only while its bound workspace is
			// still live (`list()` excludes soft-deleted ones).
			makePrune("view", (tab) =>
				tab.root != null && isSystemViewId(tab.viewId)
					? plugin.index
							.list()
							.some((s) => s.workspace.root === tab.root)
					: existing(tab.viewId) ||
						viewDraftsRef.current[tab.viewId] != null,
			),
		[makePrune, plugin],
	);
	const pruneLabels = useCallback(
		(existing: (labelId: string) => boolean) =>
			makePrune("label", (tab) => existing(tab.labelId)),
		[makePrune],
	);
	const prunePeople = useCallback(
		(existing: (personId: string) => boolean) =>
			makePrune("person", (tab) => existing(tab.personId)),
		[makePrune],
	);
	const pruneDashboards = useCallback(
		(existing: (dashboardId: string) => boolean) =>
			// Same dirty-tab protection as `pruneViews`.
			makePrune(
				"dashboard",
				(tab) =>
					existing(tab.dashboardId) ||
					dashboardDraftsRef.current[tab.dashboardId] != null,
			),
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

	// Opening or switching to a workspace with nothing showing lands on All
	// Tasks — the pane should never open onto the empty-tabs state. Runs on
	// mount and on every workspace change; the current tab count is read from a
	// ref so this *doesn't* re-fire when the user closes their last tab
	// (that's the one case the empty-tabs pane is for).
	//
	// A freshly created workspace routes an explicit `plugin.pendingOpenView`
	// through here too (mirrors `plugin.pendingEditPath`) — same destination,
	// but set before the tab list is observable.
	const tabCountRef = useRef(tabs.length);
	tabCountRef.current = tabs.length;
	useEffect(() => {
		if (!activeWorkspaceRoot) return;
		const pending = plugin.pendingOpenView;
		if (pending) {
			plugin.pendingOpenView = null;
			void openView(pending, activeWorkspaceRoot);
			return;
		}
		if (tabCountRef.current === 0) {
			void openView(SYSTEM_VIEW_ALL_TASKS_ID, activeWorkspaceRoot);
		}
	}, [plugin, activeWorkspaceRoot, openView]);

	// A sidebar workspace switch leaves `activeId` untouched — but the front tab
	// may belong to the workspace just left, so its content pane would resolve
	// against the new snapshot ("this dashboard no longer exists" / the wrong
	// view). The sidebar calls `syncToWorkspace` synchronously for this; this
	// LayoutEffect is the net for any other `setActiveWorkspace` path, applying
	// the same rule (switch to an already-open showable tab; only open All Tasks
	// when nothing is). The foreign tab stays in the strip, its draft safe.
	useLayoutEffect(() => {
		if (!activeWorkspaceRoot || plugin.pendingOpenView) return;
		syncToWorkspace(activeWorkspaceRoot);
	}, [plugin, activeWorkspaceRoot, syncToWorkspace]);

	const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;

	const api = useMemo<TabsApi>(
		() => ({
			tabs,
			activeId,
			activeTab,
			openTask,
			openScreen,
			openHelp,
			pendingHelpTarget,
			clearPendingHelpTarget,
			openView,
			openLabel,
			openPerson,
			openDashboard,
			openProject,
			activate,
			reorder,
			close,
			closeActive,
			closeAllTasks,
			closeAllOtherTabs,
			closeTabsToRight,
			closeAllTabs,
			syncToWorkspace,
			pruneTasks,
			pruneViews,
			pruneLabels,
			prunePeople,
			pruneDashboards,
			pruneProjects,
			setUnsavedGuard,
			getViewDraft,
			setViewDraft,
			getDashboardDraft,
			setDashboardDraft,
			getSelectionSnapshot,
			setSelectionSnapshot,
		}),
		[
			// The draft maps and selection snapshots are in here (not just the
			// stable getters) so every `useTabs()` consumer re-renders when
			// a draft or snapshot changes — that's what keeps `useViewDraft`
			// / the tab dirty-dot live, and what lets TaskViewport restore
			// its place when the tab comes back to the front.
			viewDrafts,
			dashboardDrafts,
			selectionSnapshots,
			tabs,
			activeId,
			activeTab,
			openTask,
			openScreen,
			openHelp,
			pendingHelpTarget,
			clearPendingHelpTarget,
			openView,
			openLabel,
			openPerson,
			openDashboard,
			openProject,
			activate,
			reorder,
			close,
			closeActive,
			closeAllTasks,
			closeAllOtherTabs,
			closeTabsToRight,
			closeAllTabs,
			syncToWorkspace,
			pruneTasks,
			pruneViews,
			pruneLabels,
			prunePeople,
			pruneDashboards,
			pruneProjects,
			setUnsavedGuard,
			getViewDraft,
			setViewDraft,
			getDashboardDraft,
			setDashboardDraft,
		],
	);

	return <TabsCtx.Provider value={api}>{children}</TabsCtx.Provider>;
}

export function useTabs(): TabsApi {
	const value = useContext(TabsCtx);
	if (!value) throw new Error("useTabs must be used inside <TabsProvider>");
	return value;
}
