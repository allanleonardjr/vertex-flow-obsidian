/**
 * Root component: onboarding when the vault has no workspaces, otherwise the
 * sidebar + one tab strip holding the Board/List plus every other open tab.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { Platform } from "obsidian";
import {
  viewById,
  useActiveWorkspace,
  usePlugin,
  type ActiveWorkspace,
} from "./context";
import { workspaceTaxonomies } from "../core/taxonomy";
import type { Project, SavedView, WorkspaceSnapshot } from "../core/types";
import { EmptyState } from "./EmptyState";
import { EmptyTabsPane } from "./EmptyTabsPane";
import { ProjectDetailView } from "./ProjectDetailView";
import { LabelDetailView } from "./LabelDetailView";
import { PersonDetailView } from "./PersonDetailView";
import { TemplateGallery } from "./TemplateGallery";
import { SelectionProvider } from "./selection";
import { ProjectsBrowseView } from "./browse/ProjectsBrowseView";
import { ViewsBrowseView } from "./browse/ViewsBrowseView";
import { LabelsBrowseView } from "./browse/LabelsBrowseView";
import { PeopleBrowseView } from "./browse/PeopleBrowseView";
import { DashboardsBrowseView } from "./browse/DashboardsBrowseView";
import { TrashBrowseView } from "./browse/TrashBrowseView";
import { DashboardView } from "./dashboards/DashboardView";
import { Sidebar } from "./Sidebar";
import { WorkspaceSettingsView } from "./settings/WorkspaceSettingsView";
import { TabsProvider, useTabs } from "./tabs-context";
import { HelpView } from "./help/HelpView";
import { TabStrip } from "./TabStrip";
import { TaskPane } from "./TaskPane";
import { TaskViewport } from "./views/TaskViewport";
import { PrefixEngine } from "./shortcuts/prefix-engine";
import { TabSwitcher } from "./TabSwitcher";
import {
  CompactNavProvider,
  useCompactNav,
} from "./compact-nav-context";
import { CompactModeToggle } from "./CompactModeToggle";

export function App() {
  useVisualViewportHeight();
  const active = useActiveWorkspace();

  if (!active) return <EmptyState />;

  return (
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
  );
}

function Workspace({ active }: { active: ActiveWorkspace }) {
  const plugin = usePlugin();
  const tabs = useTabs();
  // A state-backed ref, not `useRef`: attaching a plain ref doesn't re-render,
  // so the shortcut effect below would keep seeing `null` and bind nothing
  // until some unrelated update happened to re-run it.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const { snapshot } = active;
  const activeTab = tabs.activeTab;

  // The view the sidebar should highlight: whichever view tab is in front.
  const activeViewId = activeTab?.kind === "view" ? activeTab.viewId : "";

  // The view a TaskViewport renders. A view tab renders its own Saved View; a
  // label tab renders a synthesised, never-persisted view filtered to that
  // label.
  const activeLabelId = activeTab?.kind === "label" ? activeTab.labelId : null;
  const viewportView: SavedView | null =
    activeTab?.kind === "view"
      ? viewById(snapshot, activeTab.viewId)
      : activeLabelId
        ? labelView(snapshot, activeLabelId)
        : null;

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
  // active tab, Option+Shift+W closes them all (handled in `TabSwitcher`).
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
      // up — closing them, not clearing focus behind them.
      if (
        document.querySelector(".vf-shortcuts-dialog") ||
        document.querySelector(".vf-quick-picker") ||
        document.querySelector(".vf-tab-switcher") ||
        document.querySelector(".vf-tab-menu")
      ) {
        return;
      }

      // Blur whatever's focused inside the shell, then settle focus on the
      // shell itself so the view/keyboard listeners are the active context.
      const el = document.activeElement as HTMLElement | null;
      if (
        container &&
        el &&
        el !== document.body &&
        container.contains(el)
      ) {
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
    <div
      className={`vf-shell${navOpen ? " is-nav-open" : ""}${
        propertiesOpen ? " is-properties-open" : ""
      }`}
      ref={setContainer}
      tabIndex={-1}
    >
      <PrefixEngine snapshot={snapshot} />
      <TabSwitcher snapshot={snapshot} />
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
          />
        ) : activeTab.kind === "settings" ? (
          <WorkspaceSettingsView snapshot={snapshot} />
        ) : activeTab.kind === "help" ? (
          <HelpView />
        ) : activeTab.kind === "new-workspace" ? (
          <TemplateGallery onClose={() => tabs.close("new-workspace")} />
        ) : activeTab.kind === "dashboards" ? (
          <DashboardsBrowseView snapshot={snapshot} />
        ) : activeTab.kind === "views" ? (
          <ViewsBrowseView snapshot={snapshot} />
        ) : activeTab.kind === "labels" ? (
          <LabelsBrowseView snapshot={snapshot} />
        ) : activeTab.kind === "people" ? (
          <PeopleBrowseView snapshot={snapshot} />
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
        ) : viewportView ? (
          <TaskViewport
            snapshot={snapshot}
            view={viewportView}
            taxonomies={active.taxonomies}
            context={active.context}
            containerRef={container}
            active={activeTab.kind === "view" || activeTab.kind === "label"}
            onSelectView={selectView}
          />
        ) : (
          <EmptyTabsPane />
        )}
      </main>
    </div>
  );
}

/** A synthesised, never-persisted view showing only tasks carrying `labelId`. */
export function labelView(snapshot: WorkspaceSnapshot, labelId: string): SavedView {
  const label = workspaceTaxonomies(snapshot.workspace).label.values.find(
    (v) => v.id === labelId,
  );
  return {
    type: "view",
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
  };
}

/** A synthesised, never-persisted view showing only tasks assigned to `personId`. */
export function personView(
  snapshot: WorkspaceSnapshot,
  personId: string,
): SavedView {
  const person = snapshot.workspace.people.find((p) => p.id === personId);
  return {
    type: "view",
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
  };
}

/**
 * A synthesised, never-persisted view showing one project's tasks with
 * sub-tasks nested under their parent. Same shape as `labelView`;
 * `ProjectDetailView` renders it beneath the project header.
 */
export function projectView(project: Project): SavedView {
  return {
    type: "view",
    path: "",
    id: `project:${project.path}`,
    name: project.title,
    viewType: "list",
    filters: { project: [project.path] },
    groupBy: "status",
    sortBy: "rank",
    sortDirection: "asc",
    columns: { collapsed: [], hidden: [] },
    emptyColumnBehavior: "show-normal",
    hiddenFields: [],
    subtaskDisplay: "nested",
    calendarDateField: "dueDate",
  };
}

/**
 * Mobile on-screen keyboard handling.
 *
 * Per the CSS spec the keyboard is an overlay — it does NOT resize the layout
 * viewport, so a `height: 100%` root keeps extending behind it, hiding the
 * bottom and leaving a blank band above the keyboard (`.vertex-flow` is
 * `height: 100%` of Obsidian's `.view-content`). The one API that reflects the
 * shrink is `window.visualViewport.height`, which drops by the keyboard height
 * when it opens. We mirror that to `--vf-vh` on `<body>`; `.is-mobile
 * .vertex-flow` uses it to pin the plugin root to the true visible height.
 *
 * Both `resize` and `scroll` fire on `visualViewport` — iOS needs the latter
 * (it pans the visual viewport and never fires `window` resize); Android fires
 * resize too. When the keyboard closes, `visualViewport.height` returns to the
 * full figure, so the variable self-restores — no extra reset logic.
 *
 * Runs on mount regardless of onboarding/workspace mode because both render
 * under the same `.vertex-flow` root. Desktop is untouched.
 */
function useVisualViewportHeight(): void {
  useEffect(() => {
    if (!Platform.isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const set = () =>
      document.body.style.setProperty("--vf-vh", `${vv.height}px`);
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => {
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
      document.body.style.removeProperty("--vf-vh");
    };
  }, []);
}
