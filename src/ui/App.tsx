/**
 * Root component: onboarding when the vault has no workspaces, otherwise the
 * sidebar + one tab strip holding the Board/List plus every other open tab.
 */

import { useEffect, useState } from "react";
import {
  useBuiltInView,
  viewById,
  useActiveWorkspace,
  usePlugin,
  type ActiveWorkspace,
} from "./context";
import { workspaceTaxonomies } from "../core/taxonomy";
import type { Project, SavedView, WorkspaceSnapshot } from "../core/types";
import { EmptyState } from "./EmptyState";
import { ProjectDetailView } from "./ProjectDetailView";
import { TemplateGallery } from "./TemplateGallery";
import { SelectionProvider, useSelection } from "./selection";
import { ProjectsBrowseView } from "./browse/ProjectsBrowseView";
import { DashboardView } from "./dashboards/DashboardView";
import { Sidebar } from "./Sidebar";
import { WorkspaceSettingsView } from "./settings/WorkspaceSettingsView";
import { TabsProvider, useTabs } from "./tabs-context";
import { HelpView } from "./help/HelpView";
import { TabStrip } from "./TabStrip";
import { TaskPane } from "./TaskPane";
import { TaskViewport } from "./views/TaskViewport";

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
  const selection = useSelection();
  const tabs = useTabs();
  // A state-backed ref, not `useRef`: attaching a plain ref doesn't re-render,
  // so the shortcut effect below would keep seeing `null` and bind nothing
  // until some unrelated update happened to re-run it.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const { snapshot } = active;
  const builtInView = useBuiltInView(snapshot);
  const activeTab = tabs.activeTab;
  const onWorkspaceTab = activeTab.kind === "workspace";

  // The view the sidebar should highlight: the built-in on the pinned tab, or
  // whichever view tab is in front.
  const activeViewId =
    activeTab.kind === "view"
      ? activeTab.viewId
      : activeTab.kind === "workspace"
        ? builtInView.id
        : "";

  // The view a TaskViewport renders. A view tab renders its own Saved View; a
  // label tab renders a synthesised, never-persisted view filtered to that
  // label; everything else falls back to the built-in "Tasks" view.
  const activeLabelId = activeTab.kind === "label" ? activeTab.labelId : null;
  const viewportView: SavedView =
    activeTab.kind === "view"
      ? viewById(snapshot, activeTab.viewId)
      : activeLabelId
        ? labelView(snapshot, activeLabelId)
        : builtInView;

  // Opening a Saved View: the built-in lives on the pinned tab, everything
  // else gets its own. Shared by the sidebar and the viewport's "Save as…".
  const selectView = (id: string) => {
    if (id === builtInView.id) tabs.activateWorkspace();
    else tabs.openView(id);
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
  useEffect(() => {
    tabs.pruneViews((id) => snapshot.views.some((v) => v.id === id));
  }, [tabs, snapshot.views]);
  useEffect(() => {
    tabs.pruneLabels((id) =>
      snapshot.workspace.labels.some((l) => l.id === id),
    );
  }, [tabs, snapshot.workspace.labels]);
  useEffect(() => {
    tabs.pruneProjects((path) =>
      snapshot.projects.some((p) => p.path === path),
    );
  }, [tabs, snapshot.projects]);
  useEffect(() => {
    tabs.pruneDashboards((id) => snapshot.dashboards.some((d) => d.id === id));
  }, [tabs, snapshot.dashboards]);

  // Escape closes whatever tab you're on (falling back to the pinned
  // Board/List tab, which can never itself be closed); on that pinned tab,
  // Escape does its ordinary job of clearing the selection instead.
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

      if (tabs.activeTab.kind === "workspace") {
        selection.clearSelection();
        return;
      }

      event.stopPropagation();
      if (event.shiftKey) tabs.closeAllTasks();
      else tabs.closeActive();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tabs, selection]);

  return (
    <div className="vf-shell" ref={setContainer} tabIndex={-1}>
      <Sidebar
        snapshot={snapshot}
        activeViewId={activeViewId}
        onSelectView={selectView}
      />

      <main className="vf-main">
        <TabStrip snapshot={snapshot} builtInView={builtInView} />

        {tabs.activeTab.kind === "task" ? (
          <TaskPane path={tabs.activeTab.path} />
        ) : tabs.activeTab.kind === "projects" ? (
          <ProjectsBrowseView
            snapshot={snapshot}
            taxonomies={active.taxonomies}
          />
        ) : tabs.activeTab.kind === "settings" ? (
          <WorkspaceSettingsView snapshot={snapshot} />
        ) : tabs.activeTab.kind === "help" ? (
          <HelpView />
        ) : tabs.activeTab.kind === "new-workspace" ? (
          <TemplateGallery onClose={() => tabs.close("new-workspace")} />
        ) : tabs.activeTab.kind === "dashboard" ? (
          <DashboardView
            key={tabs.activeTab.dashboardId}
            dashboardId={tabs.activeTab.dashboardId}
            snapshot={snapshot}
            context={active.context}
          />
        ) : tabs.activeTab.kind === "project" ? (
          <ProjectDetailView
            path={tabs.activeTab.path}
            snapshot={snapshot}
            taxonomies={active.taxonomies}
            context={active.context}
            containerRef={container}
            active
            onSelectView={selectView}
          />
        ) : (
          <TaskViewport
            snapshot={snapshot}
            view={viewportView}
            taxonomies={active.taxonomies}
            context={active.context}
            containerRef={container}
            active={
              onWorkspaceTab ||
              activeTab.kind === "view" ||
              activeTab.kind === "label"
            }
            onSelectView={selectView}
          />
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
