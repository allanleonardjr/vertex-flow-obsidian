/**
 * Root component: onboarding when the vault has no workspaces, otherwise the
 * sidebar + one tab strip holding the Board/List plus every other open tab.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { Platform } from "obsidian";
import {
  viewById,
  useActiveWorkspace,
  usePlugin,
  type ActiveWorkspace,
} from "./context";
import { workspaceTaxonomies } from "../core/taxonomy";
import type {
	DashboardConfig,
	SavedView,
	ViewDefinition,
	WorkspaceSnapshot,
} from "../core/types";
import { EmptyState } from "./EmptyState";
import { EmptyTabsPane } from "./EmptyTabsPane";
import { ProjectDetailView } from "./ProjectDetailView";
import { LabelDetailView } from "./LabelDetailView";
import { PersonDetailView } from "./PersonDetailView";
import { TemplateGallery } from "./TemplateGallery";
import { SelectionProvider, useSelection } from "./selection";
import { ProjectsBrowseView } from "./browse/ProjectsBrowseView";
import { WorkspacesBrowseView } from "./browse/WorkspacesBrowseView";
import { ViewsBrowseView } from "./browse/ViewsBrowseView";
import { LabelsBrowseView } from "./browse/LabelsBrowseView";
import { PeopleBrowseView } from "./browse/PeopleBrowseView";
import { DashboardsBrowseView } from "./browse/DashboardsBrowseView";
import { TrashBrowseView } from "./browse/TrashBrowseView";
import { HistoryBrowseView } from "./browse/HistoryBrowseView";
import { DashboardView } from "./dashboards/DashboardView";
import { Sidebar } from "./Sidebar";
import { WorkspaceSettingsView } from "./settings/WorkspaceSettingsView";
import { TabsProvider, useTabs } from "./tabs-context";
import { HelpView } from "./help/HelpView";
import { AiChatView } from "./ai-chat/AiChatView";
import { AiChatSessionProvider } from "./ai-chat/ai-chat-session";
import { TabStrip } from "./TabStrip";
import { TaskPane } from "./TaskPane";
import { TaskViewport } from "./views/TaskViewport";
import { PrefixEngine } from "./shortcuts/prefix-engine";
import { TabSwitcher } from "./TabSwitcher";
import { WorkspaceSearch } from "./WorkspaceSearch";
import { RecurringOverviewScreen } from "./RecurringOverviewScreen";
import { CompactNavProvider, useCompactNav } from "./compact-nav-context";
import { CompactModeToggle } from "./CompactModeToggle";

export function App() {
  useMobileFieldScrollIntoView();
  const active = useActiveWorkspace();

  if (!active) return <EmptyState />;

  return (
    <MotionConfig reducedMotion="user">
      <SelectionProvider>
        <TabsProvider>
          {/* Remounting on workspace switch resets focus and selection. Tabs
              live *above* this boundary on purpose — `openTask` on a
              cross-workspace link switches the active workspace and then opens
              the tab, so wiping the strip on every switch would throw that tab
              away. The prune effects below do the workspace-scoped cleanup
              instead. `CompactNavProvider` sits above `Workspace` so the drawer
              state is shared by the sidebar, the toggle strip, and the property
              rail regardless of which pane is in front — and is remounted (fresh,
              closed) whenever the whole workspace remounts. */}
          <CompactNavProvider>
            <Workspace key={active.snapshot.workspace.root} active={active} />
          </CompactNavProvider>
        </TabsProvider>
      </SelectionProvider>
    </MotionConfig>
  );
}

function Workspace({ active }: { active: ActiveWorkspace }) {
  const plugin = usePlugin();
  const tabs = useTabs();
  const selection = useSelection();
  // A state-backed ref, not `useRef`: attaching a plain ref doesn't re-render,
  // so the shortcut effect below would keep seeing `null` and bind nothing
  // until some unrelated update happened to re-run it.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // Mirrored so the Escape handler below can check for an active selection
  // without taking `selection` (a new object identity on every focus/select
  // change) as an effect dependency — that would tear down and rebind the
  // window listener on every arrow-key press.
  const selectedPathsRef = useRef(selection.selectedPaths);
  selectedPathsRef.current = selection.selectedPaths;

  const { snapshot } = active;
  const activeTab = tabs.activeTab;

  // The view the sidebar should highlight: whichever view tab is in front.
  const activeViewId = activeTab?.kind === "view" ? activeTab.viewId : "";

  // The view a TaskViewport renders. A view tab renders its own Saved View; a
  // label tab renders a synthesised, never-persisted view filtered to that
  // label, and a deep-linked query tab renders its parsed definition the same
  // way.
  const activeLabelId = activeTab?.kind === "label" ? activeTab.labelId : null;
  const viewportView: SavedView | null =
    activeTab?.kind === "view"
      ? viewById(snapshot, activeTab.viewId)
      : activeTab?.kind === "query"
        ? queryView(activeTab.definition, activeTab.name)
        : activeLabelId
          ? labelView(snapshot, activeLabelId)
          : null;

  // A view tab can't find a Saved View but its id names a dashboard — a
  // `open-view` deep link aimed at a dashboard `vaultUri`. Render the dashboard
  // so the link lands instead of an empty pane.
  const viewportDashboard = (viewId: string): DashboardConfig | null =>
    snapshot.dashboards.find((d) => d.id === viewId) ?? null;

  // Opening a Saved View: every view — All Tasks and Untriaged included — gets
  // its own tab, and System Views bind to this workspace (so A's All Tasks and
  // B's All Tasks coexist). Shared by the sidebar and the viewport's "Save as…".
  const selectView = (id: string) => {
    tabs.openView(id, snapshot.workspace.root);
  };

  // Task tabs: closed only when the task is gone from *every* workspace
  // (mirrors the vault-wide checks below for views/labels/people/projects).
  // Ownership is resolved from the path rather than `snapshot.tasks`, so a
  // task file that's been created but not yet re-indexed (quick capture,
  // "New task") keeps its tab instead of being closed the instant it opens.
  // Genuine deletions are handled by the separate index-subscribed prune
  // effect in TabsProvider (tabs-context.tsx) — this effect only guards the
  // reindex-lag edge case.
  useEffect(() => {
    tabs.pruneTasks((path) => plugin.index.workspaceFor(path) != null);
  }, [tabs, plugin, snapshot.tasks]);
  // View/Dashboard/Label/Project tabs can belong to a workspace other than the
  // one on screen — Tabs live above this component's per-workspace remount
  // boundary. So a tab is only pruned when its target is gone from *every*
  // workspace (`plugin.index.hasX`), never merely absent from the active
  // snapshot. Deps still name the active snapshot's arrays: every array is
  // rebuilt with a fresh identity on each index pass, so these re-run after any
  // vault change (a delete in another workspace included).
  useEffect(() => {
    tabs.pruneViews((id) => plugin.index.hasView(id));
  }, [tabs, plugin, snapshot.views]);
  useEffect(() => {
    tabs.pruneLabels((id) => plugin.index.hasLabel(id));
  }, [tabs, plugin, snapshot.workspace.labels]);
  useEffect(() => {
    tabs.prunePeople((id) => plugin.index.hasPerson(id));
  }, [tabs, plugin, snapshot.workspace.people]);
  useEffect(() => {
    tabs.pruneProjects((path) => plugin.index.hasProject(path));
  }, [tabs, plugin, snapshot.projects]);
  useEffect(() => {
    tabs.pruneDashboards((id) => plugin.index.hasDashboard(id));
  }, [tabs, plugin, snapshot.dashboards]);

  // Landing on a tab puts DOM focus on the shell, so the container-scoped
  // nav keys (`j`/`k`, arrows, `?`) respond immediately without a click. Runs
  // in a layout effect (before paint) keyed on the tab id, so the new tab's
  // pane is mounted by the time focus settles. A fresh auto-focus target in
  // the pane (e.g. an `autoFocus` title field) steals focus from the shell in
  // its own layout effect, which is the right behaviour — the shell focus is
  // the fallback that makes nav keys live when nothing else wants focus. The
  // workspace is remounted per-root (App.tsx line ~52), so this also lands on
  // a workspace switch without needing `active.snapshot` in the deps.
  useLayoutEffect(() => {
    if (!activeTab) return;
    container?.focus();
  }, [activeTab?.id, container]);

  // Escape clears focus — it never closes a tab. Hitting Escape mid-edit drops
  // you out of the field so the `g`/`c` chords, `j`/`k`, and `?` become live
  // again (their listener guard refuses to fire while you're still in an
  // input). Closing a tab is a deliberate modifier action: Option+W closes the
  // active tab, Option+Shift+W closes every other tab (handled in
  // `TabSwitcher`).
  //
  // Bound with `capture: true` on `window` — Obsidian registers its own
  // global Escape handling (closing suggest popups, blurring the active
  // editor) on `document`, and capture-phase listeners fire top-down
  // starting at `window`, so this has to sit above `document` in that chain
  // to see the key first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // The `[[`-link autocomplete popup wants Escape for itself first —
      // dismiss the popup, not the focus. It's portaled to `document.body`
      // as `.vf-autocomplete`, so its presence is a reliable, cheap check;
      // its own bubble-phase handler closes it once this steps aside.
      if (document.querySelector(".vf-autocomplete")) return;

      // The `?` shortcuts overlay, the taxonomy quick-picker, the Option+Tab
      // switcher, and the tab right-click menu each own Escape while they're
      // up — closing them, not clearing focus behind them. An in-progress
      // task drag (`[data-task-drag]`) likewise owns Escape to cancel itself
      // (see `useTaskDrag`) rather than have the selection clear out from
      // under it.
      if (
        document.querySelector(".vf-shortcuts-dialog") ||
        document.querySelector(".vf-quick-picker") ||
        document.querySelector(".vf-tab-switcher") ||
        document.querySelector(".vf-tab-menu") ||
        document.querySelector("[data-task-drag]")
      ) {
        return;
      }

      // Drop any multi-selection. Independent of the blur/refocus below —
      // selection is shared across List/Board/Timeline/Calendar, so this
      // clears it regardless of which view is on screen or where DOM focus
      // currently sits.
      if (selectedPathsRef.current.length > 0) {
        selection.clearSelection();
      }

      // Blur whatever's focused inside the shell, then settle focus on the
      // shell itself so the view/keyboard listeners are the active context.
      const el = document.activeElement as HTMLElement | null;
      if (container && el && el !== document.body && container.contains(el)) {
        event.stopPropagation();
        el.blur();
        container.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [container]);

  // Compact-pane drawer state. The provider lives above `Workspace` (in `App`),
  // so this reads whether the nav / properties drawers are open to show the
  // shared backdrop behind whichever one is up.
  const { navOpen, propertiesOpen, closeDrawers } = useCompactNav();

  return (
    <AiChatSessionProvider>
    <div
      className={`vf-shell${navOpen ? " is-nav-open" : ""}${
        propertiesOpen ? " is-properties-open" : ""
      }`}
      ref={setContainer}
      tabIndex={-1}
    >
      <PrefixEngine snapshot={snapshot} container={container} />
      <TabSwitcher snapshot={snapshot} />
      <WorkspaceSearch snapshot={snapshot} />
      <Sidebar
        snapshot={snapshot}
        activeViewId={activeViewId}
        onSelectView={selectView}
      />
      {(navOpen || propertiesOpen) && (
        <div
          className="vf-compact-backdrop"
          aria-hidden
          onClick={closeDrawers}
        />
      )}

      <main className="vf-main">
        <CompactModeToggle />
        {activeTab && <TabStrip snapshot={snapshot} />}

        {!activeTab ? (
          <EmptyTabsPane />
        ) : activeTab.kind === "task" ? (
          <TaskPane path={activeTab.path} />
        ) : activeTab.kind === "projects" ? (
          <ProjectsBrowseView
            snapshot={snapshot}
            taxonomies={active.taxonomies}
            containerRef={container}
          />
        ) : activeTab.kind === "settings" ? (
          <WorkspaceSettingsView snapshot={snapshot} />
        ) : activeTab.kind === "help" ? (
          <HelpView />
        ) : activeTab.kind === "ai-chat" ? (
          <AiChatView
            snapshot={snapshot}
            taxonomies={active.taxonomies}
            context={active.context}
          />
        ) : activeTab.kind === "new-workspace" ? (
          <TemplateGallery onClose={() => tabs.close("new-workspace")} />
        ) : activeTab.kind === "dashboards" ? (
          <DashboardsBrowseView snapshot={snapshot} containerRef={container} />
        ) : activeTab.kind === "views" ? (
          <ViewsBrowseView snapshot={snapshot} containerRef={container} />
        ) : activeTab.kind === "labels" ? (
          <LabelsBrowseView snapshot={snapshot} containerRef={container} />
        ) : activeTab.kind === "people" ? (
          <PeopleBrowseView snapshot={snapshot} containerRef={container} />
        ) : activeTab.kind === "workspaces" ? (
          <WorkspacesBrowseView containerRef={container} />
        ) : activeTab.kind === "person" ? (
          <PersonDetailView
            personId={activeTab.personId}
            snapshot={snapshot}
            taxonomies={active.taxonomies}
            context={active.context}
            containerRef={container}
            active
            onSelectView={selectView}
          />
        ) : activeTab.kind === "trash" ? (
          <TrashBrowseView snapshot={snapshot} taxonomies={active.taxonomies} />
        ) : activeTab.kind === "history" ? (
          <HistoryBrowseView snapshot={snapshot} />
        ) : activeTab.kind === "dashboard" ? (
          <DashboardView
            key={activeTab.dashboardId}
            dashboardId={activeTab.dashboardId}
            snapshot={snapshot}
            context={active.context}
          />
        ) : activeTab.kind === "project" ? (
          <ProjectDetailView
            path={activeTab.path}
            snapshot={snapshot}
            taxonomies={active.taxonomies}
            context={active.context}
            containerRef={container}
            active
            onSelectView={selectView}
          />
        ) : activeTab.kind === "label" ? (
          <LabelDetailView
            labelId={activeTab.labelId}
            snapshot={snapshot}
            taxonomies={active.taxonomies}
            context={active.context}
            containerRef={container}
            active
            onSelectView={selectView}
          />
        ) : activeTab.kind === "recurring" ? (
          <RecurringOverviewScreen
            snapshot={snapshot}
            taxonomies={active.taxonomies}
            tabs={tabs}
          />
        ) : activeTab.kind === "view" && !viewportView ? (
          viewportDashboard(activeTab.viewId) ? (
            <DashboardView
              key={activeTab.viewId}
              dashboardId={activeTab.viewId}
              snapshot={snapshot}
              context={active.context}
            />
          ) : (
            <EmptyTabsPane />
          )
        ) : viewportView ? (
          <TaskViewport
            snapshot={snapshot}
            view={viewportView}
            taxonomies={active.taxonomies}
            context={active.context}
            containerRef={container}
            active={
              activeTab.kind === "view" || activeTab.kind === "query"
            }
            onSelectView={selectView}
          />
        ) : (
          <EmptyTabsPane />
        )}
      </main>
    </div>
    </AiChatSessionProvider>
  );
}

/** A synthesised, never-persisted view from a deep-linked query definition. */
export function queryView(
  definition: ViewDefinition,
  name: string,
): SavedView {
  return {
    type: "vertex-flow-view",
    path: "",
    id: `query:${name}`,
    name,
    columns: { collapsed: [], hidden: [] },
    ...definition,
  };
}

/** A synthesised, never-persisted view showing only tasks carrying `labelId`. */
export function labelView(
  snapshot: WorkspaceSnapshot,
  labelId: string,
): SavedView {
  const label = workspaceTaxonomies(snapshot.workspace).label.values.find(
    (v) => v.id === labelId,
  );
  return {
    type: "vertex-flow-view",
    path: "",
    id: `label:${labelId}`,
    name: label?.name ?? labelId,
    viewType: "list",
    filters: { labels: [labelId] },
    groupBy: "status",
    sortBy: "rank",
    sortDirection: "asc",
    columns: { collapsed: [], hidden: [] },
    emptyColumnBehavior: "show-normal",
    hiddenFields: [],
    subtaskDisplay: "flat",
    calendarDateField: "dueDate",
    recurringPreview: false,
    tableSort: [],
  };
}

/** A synthesised, never-persisted view showing only tasks assigned to `personId`. */
export function personView(
  snapshot: WorkspaceSnapshot,
  personId: string,
): SavedView {
  const person = snapshot.workspace.people.find((p) => p.id === personId);
  return {
    type: "vertex-flow-view",
    path: "",
    id: `person:${personId}`,
    name: person?.name ?? personId,
    viewType: "list",
    filters: { assignee: [personId] },
    groupBy: "status",
    sortBy: "rank",
    sortDirection: "asc",
    columns: { collapsed: [], hidden: [] },
    emptyColumnBehavior: "show-normal",
    hiddenFields: [],
    subtaskDisplay: "flat",
    calendarDateField: "dueDate",
    recurringPreview: false,
    tableSort: [],
  };
}

/**
 * A synthesised, never-persisted view showing one project's tasks with
 * sub-tasks nested under their parent. Same shape as `labelView`;
 * `ProjectDetailView` renders it beneath the project header.
 */
export { projectView } from "./project-view";

/**
 * Mobile: keep the focused input field visible when the on-screen keyboard
 * opens. The plugin layout is a fixed-height flex column with nested
 * `overflow-y: auto` scrollers (the feature-section panes under the editor
 * description, the task lists, the comment threads), and iOS will not reveal an
 * input inside those when the keyboard lifts — its auto-scroll only reaches
 * plain document flow. Scroll the focused element into view within its own
 * scrollable ancestors (deferred a frame so the keyboard height has settled),
 * with `nearest` so an already-visible field is left alone.
 */
function useMobileFieldScrollIntoView(): void {
  useEffect(() => {
    if (!Platform.isMobile) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !target.closest(".vertex-flow")) return;
      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, []);
}
