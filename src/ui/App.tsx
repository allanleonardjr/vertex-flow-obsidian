/**
 * Root component: onboarding when the vault has no workspaces, otherwise the
 * sidebar + one tab strip holding the Board/List plus every other open tab.
 */

import { useEffect, useState } from "react";
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
import { TemplateGallery } from "./TemplateGallery";
import { SelectionProvider } from "./selection";
import { ProjectsBrowseView } from "./browse/ProjectsBrowseView";
import { ViewsBrowseView } from "./browse/ViewsBrowseView";
import { LabelsBrowseView } from "./browse/LabelsBrowseView";
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

export function App() {
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
            instead. */}
        <Workspace key={active.snapshot.workspace.root} active={active} />
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

  // Drop tabs whose target isn't in this workspace — after a delete, or after
  // a workspace switch (this component is keyed on the root, so it re-runs
  // with the new workspace's data and everything left over from the old one
  // fails the membership check).
  //
  // Task tabs need their own pass here: the provider's index subscription only
  // knows whether a task still exists *somewhere in the vault*, which every
  // task of the workspace you just left does. Ownership is resolved from the
  // path rather than from `snapshot.tasks`, so a task file that's been created
  // but not yet re-indexed (quick capture, "New task") keeps its tab instead
  // of being closed the instant it opens.
  useEffect(() => {
    const root = snapshot.workspace.root;
    tabs.pruneTasks(
      (path) => plugin.index.workspaceFor(path)?.workspace.root === root,
    );
  }, [tabs, plugin, snapshot.workspace.root, snapshot.tasks]);
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
    tabs.pruneProjects((path) => plugin.index.hasProject(path));
  }, [tabs, plugin, snapshot.projects]);
  useEffect(() => {
    tabs.pruneDashboards((id) => plugin.index.hasDashboard(id));
  }, [tabs, plugin, snapshot.dashboards]);

  // Escape closes whatever tab you're on; Shift+Escape closes every task tab.
  // Closing the last tab empties the strip and the empty-tabs pane renders —
  // there's no fallback tab to reason about anymore (A1).
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
      // dismiss the popup, not the tab. It's portaled to `document.body`
      // as `.vf-autocomplete`, so its presence is a reliable, cheap check;
      // its own bubble-phase handler closes it once this steps aside.
      if (document.querySelector(".vf-autocomplete")) return;

      // The `?` shortcuts overlay and the taxonomy quick-picker own Escape
      // while they're up — closing them, not the tab behind them.
      if (
        document.querySelector(".vf-shortcuts-dialog") ||
        document.querySelector(".vf-quick-picker")
      ) {
        return;
      }

      // Nothing open — let Escape fall through to Obsidian.
      if (!tabs.activeTab) return;

      event.stopPropagation();
      if (event.shiftKey) tabs.closeAllTasks();
      else tabs.closeActive();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tabs]);

  return (
    <div className="vf-shell" ref={setContainer} tabIndex={-1}>
      <PrefixEngine snapshot={snapshot} />
      <Sidebar
        snapshot={snapshot}
        activeViewId={activeViewId}
        onSelectView={selectView}
      />

      <main className="vf-main">
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
function labelView(snapshot: WorkspaceSnapshot, labelId: string): SavedView {
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
