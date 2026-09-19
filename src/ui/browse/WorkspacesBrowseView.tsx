/**
 * Workspaces hub — every live workspace in the vault, as a card with its icon,
 * name, ID prefix, and task/project counts. Unlike the other hubs it isn't
 * scoped to the active workspace (there's no `snapshot` prop): it lists the
 * whole vault, and clicking a card switches to that workspace and opens its
 * All Tasks view.
 *
 * Each card's menu mirrors `WorkspacesSection` in the sidebar: Edit, Settings,
 * Export Tasks…, Export as Template…, Move to Trash — no Duplicate (workspaces
 * have never had one).
 *
 * The header carries a fixed, non-configurable 2-up hero chart row (tasks and
 * projects per workspace) behind a show/hide toggle. These two are built
 * directly from `useWorkspaces()` — one `CategoricalDatum` per live
 * workspace — not through `computeWidgetData`, which only knows how to slice
 * one workspace's task list by taxonomy fields. The `DashboardWidget` objects
 * are plain `DashboardWidget` presets, never persisted to a `DashboardConfig`.
 */

import { useEffect, useMemo, useState } from "react";
import type { DashboardWidget, WorkspaceSnapshot } from "../../core/types";
import type { WidgetData } from "../../core/dashboards";
import { workspaceAccentColor } from "../../core/workspace-color";
import { SYSTEM_VIEW_ALL_TASKS_ID } from "../../core/views";
import {
  useActiveWorkspace,
  usePlugin,
  useSetActiveWorkspace,
  useWorkspaces,
} from "../context";
import { DeleteWorkspaceDialog } from "../DeleteWorkspaceDialog";
import { ExportDialog } from "../modals/ExportDialog";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useTabs } from "../tabs-context";
import { WidgetChart } from "../dashboards/charts/WidgetChart";
import { WorkspaceCardContent } from "./WorkspaceCardContent";
import {
  BrowseCard,
  BrowseCardMenu,
  BrowseEmpty,
  BrowseHeader,
  BrowseList,
  useBrowseKeyboardNav,
} from "./shared";

/**
 * Fixed hero-chart presets for the Workspaces hub header — tasks and projects
 * per workspace across the whole vault. Not user-configurable and never
 * persisted to a `DashboardConfig`; `layout` is unused since these never go
 * through `DashboardGrid`. `fieldMapping` is inert here too: no real per-task
 * grouping happens for these two charts (the data is built directly from
 * `useWorkspaces()`, one datum per live workspace), so `WidgetChart` only ever
 * reads `chartType`.
 */
const HERO_TASKS_WIDGET: DashboardWidget = {
  id: "hero-tasks",
  chartType: "bar",
  title: "Tasks per Workspace",
  titleIsCustom: true,
  fieldMapping: { chartType: "bar", groupBy: "status" },
  layout: { x: 0, y: 0, w: 0, h: 0 },
};

const HERO_PROJECTS_WIDGET: DashboardWidget = {
  id: "hero-projects",
  chartType: "bar",
  title: "Projects per Workspace",
  titleIsCustom: true,
  fieldMapping: { chartType: "bar", groupBy: "status" },
  layout: { x: 0, y: 0, w: 0, h: 0 },
};

export function WorkspacesBrowseView({
  containerRef,
}: {
  containerRef: HTMLElement | null;
}) {
  useBrowseKeyboardNav(containerRef);
  const plugin = usePlugin();
  const tabs = useTabs();
  const setActiveWorkspace = useSetActiveWorkspace();
  const workspaces = useWorkspaces();
  const activeRoot =
    useActiveWorkspace()?.snapshot.workspace.root ?? null;

  const [showHeroCharts, setShowHeroCharts] = useState(true);
  const [menuRoot, setMenuRoot] = useState<string | null>(null);
  const [editRoot, setEditRoot] = useState<string | null>(null);
  const [deleteRoot, setDeleteRoot] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<{
    workspace: WorkspaceSnapshot;
    forceMode?: "tasks" | "template";
  } | null>(null);

  // Bridge for a cross-workspace "Export Tasks…" / "Export as Template…" click —
  // kept as a plugin-instance flag (not local state) because switching
  // workspaces remounts this whole component (see `App.tsx`), which would
  // otherwise discard `exportTarget` before it could render. No dependency
  // array: re-checks every render so it catches the flag as soon as the fresh
  // instance mounts. Mirrors the bridge in `WorkspacesSection`.
  useEffect(() => {
    if (!plugin.pendingWorkspaceExport) return;
    const { root, forceMode } = plugin.pendingWorkspaceExport;
    plugin.pendingWorkspaceExport = null;
    const target = workspaces.find((w) => w.workspace.root === root);
    if (target) setExportTarget({ workspace: target, forceMode });
  });

  const editing = workspaces.find((w) => w.workspace.root === editRoot);
  const deleting = workspaces.find((w) => w.workspace.root === deleteRoot);

  // One `CategoricalDatum` per live workspace. Colored with the same
  // deterministic per-workspace accent the sidebar dots and tab accents use
  // (`workspaceAccentColor`, hashed from the root path) — that spreads the
  // bars across the whole palette instead of clustering them on the early
  // neutrals, and keeps each bar the same color as its workspace elsewhere in
  // the app. (Index-cycling from palette[0], the way `colorFor` treats a
  // non-taxonomy field, just lands the first workspaces on white/gray.)
  const tasksData = useMemo<WidgetData>(
    () => ({
      kind: "categorical",
      data: workspaces.map((entry) => ({
        key: entry.workspace.root,
        label: entry.workspace.name,
        value: entry.tasks.length,
        color: workspaceAccentColor(entry.workspace.root),
      })),
      empty: workspaces.length === 0,
    }),
    [workspaces],
  );
  const projectsData = useMemo<WidgetData>(
    () => ({
      kind: "categorical",
      data: workspaces.map((entry) => ({
        key: entry.workspace.root,
        label: entry.workspace.name,
        value: entry.projects.length,
        color: workspaceAccentColor(entry.workspace.root),
      })),
      empty: workspaces.length === 0,
    }),
    [workspaces],
  );

  return (
    <div className="vf-browse">
      <BrowseHeader
        title="Workspaces"
        noun="workspace"
        count={workspaces.length}
        actionLabel="New workspace"
        onAction={() => tabs.openScreen("new-workspace")}
      >
        <button
          type="button"
          className={`vf-bar-item${showHeroCharts ? " is-on" : ""}`}
          onClick={() => setShowHeroCharts((prev) => !prev)}
        >
          {showHeroCharts ? "Hide charts" : "Show charts"}
        </button>
      </BrowseHeader>

      {showHeroCharts && (
        <div className="vf-browse-hero">
          <div className="vf-browse-hero-chart">
            <div className="vf-dash-widget">
              <div className="vf-dash-widget-head">
                <span className="vf-browse-hero-chart-title">
                  {HERO_TASKS_WIDGET.title}
                </span>
              </div>
              <div className="vf-dash-widget-body">
                <WidgetChart widget={HERO_TASKS_WIDGET} data={tasksData} />
              </div>
            </div>
          </div>
          <div className="vf-browse-hero-chart">
            <div className="vf-dash-widget">
              <div className="vf-dash-widget-head">
                <span className="vf-browse-hero-chart-title">
                  {HERO_PROJECTS_WIDGET.title}
                </span>
              </div>
              <div className="vf-dash-widget-body">
                <WidgetChart widget={HERO_PROJECTS_WIDGET} data={projectsData} />
              </div>
            </div>
          </div>
        </div>
      )}

      {workspaces.length === 0 ? (
        <BrowseEmpty label="workspaces" />
      ) : (
        <BrowseList>
          {workspaces.map((entry) => (
            <BrowseCard
              key={entry.workspace.root}
              className={
                activeRoot === entry.workspace.root
                  ? "is-workspace is-current"
                  : "is-workspace"
              }
              onClick={() => {
                setActiveWorkspace(entry.workspace.root);
                tabs.openView(SYSTEM_VIEW_ALL_TASKS_ID, entry.workspace.root);
              }}
              trailing={
                <BrowseCardMenu
                  open={menuRoot === entry.workspace.root}
                  onToggle={() =>
                    setMenuRoot((r) =>
                      r === entry.workspace.root ? null : entry.workspace.root,
                    )
                  }
                  onClose={() => setMenuRoot(null)}
                >
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuRoot(null);
                      setEditRoot(entry.workspace.root);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuRoot(null);
                      setActiveWorkspace(entry.workspace.root);
                      tabs.syncToWorkspace(entry.workspace.root);
                      tabs.openScreen("settings");
                    }}
                  >
                    Settings
                  </button>
                  <div className="vf-menu-divider" aria-hidden />
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuRoot(null);
                      setActiveWorkspace(entry.workspace.root);
                      plugin.pendingWorkspaceExport = {
                        root: entry.workspace.root,
                        forceMode: "tasks",
                      };
                    }}
                  >
                    Export Tasks…
                  </button>
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuRoot(null);
                      setActiveWorkspace(entry.workspace.root);
                      plugin.pendingWorkspaceExport = {
                        root: entry.workspace.root,
                        forceMode: "template",
                      };
                    }}
                  >
                    Export as Template…
                  </button>
                  <div className="vf-menu-divider" aria-hidden />
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuRoot(null);
                      setDeleteRoot(entry.workspace.root);
                    }}
                  >
                    Move to Trash
                  </button>
                </BrowseCardMenu>
              }
            >
              <WorkspaceCardContent
                snapshot={entry}
                active={activeRoot === entry.workspace.root}
              />
            </BrowseCard>
          ))}
        </BrowseList>
      )}

      {editing && (
        <NamedIconDialog
          title="Edit workspace"
          initialName={editing.workspace.name}
          initialIcon={editing.workspace.icon}
          iconFallback="layers"
          confirmLabel="Save"
          onConfirm={(name, icon) =>
            void plugin.mutations.saveWorkspaceConfig({
              ...editing.workspace,
              name,
              icon,
            })
          }
          onClose={() => setEditRoot(null)}
        />
      )}

      {deleting && (
        <DeleteWorkspaceDialog
          snapshot={deleting}
          onClose={() => setDeleteRoot(null)}
        />
      )}

      {exportTarget && (
        <ExportDialog
          snapshot={exportTarget.workspace}
          allowTemplateExport
          lockScope
          initialScope={{ kind: "workspace" }}
          forceMode={exportTarget.forceMode}
          onClose={() => setExportTarget(null)}
        />
      )}
    </div>
  );
}