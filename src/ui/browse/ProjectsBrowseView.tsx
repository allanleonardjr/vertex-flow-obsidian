/**
 * Projects hub — every Project in the workspace, as a card with its status,
 * task count, and computed progress. Each card carries an Edit / Duplicate row
 * menu, matching what `ProjectsSection` offers in the sidebar.
 *
 * Deliberately *not* a Saved View (those filter Tasks, not Projects) — it's a
 * plain manager list. Each card's menu mirrors `ProjectsSection` in the
 * sidebar: Edit / Duplicate / Delete.
 *
 * The header carries a fixed, non-configurable 2-up hero chart row (task
 * status + priority distribution across the whole workspace) behind a
 * show/hide toggle. These are plain `DashboardWidget` objects fed through the
 * real `computeWidgetData` / `WidgetChart` pipeline used by full dashboards —
 * they're just never persisted to a `DashboardConfig`, since they're fixed
 * presets rather than something the user configures.
 */

import { useMemo, useState } from "react";
import { planDeletion, scopeOf, type DeletionPlan } from "../../core/hierarchy";
import { isProjectTitleTaken } from "../../core/serialization";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type {
  DashboardWidget,
  Project,
  WorkspaceSnapshot,
} from "../../core/types";
import { computeWidgetData } from "../../core/dashboards";
import { snapshotContext } from "../../core/views";
import { withoutExtension } from "../../obsidian/note-io";
import { usePlugin } from "../context";
import { WidgetChart } from "../dashboards/charts/WidgetChart";
import { DeleteEntityDialog } from "../DeleteEntityDialog";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useTabs } from "../tabs-context";
import { ProjectCardContent } from "./ProjectCardContent";
import {
  BrowseCard,
  BrowseCardMenu,
  BrowseEmpty,
  BrowseHeader,
  BrowseList,
} from "./shared";

/**
 * Fixed hero-chart presets for the Projects hub header — task-level status
 * and priority distribution across every task in the workspace. Not
 * user-configurable and never persisted to a `DashboardConfig`; `layout` is
 * unused since these never go through `DashboardGrid`.
 */
const HERO_STATUS_WIDGET: DashboardWidget = {
  id: "hero-status",
  chartType: "bar",
  title: "Tasks by Status",
  titleIsCustom: true,
  fieldMapping: { chartType: "bar", groupBy: "status" },
  layout: { x: 0, y: 0, w: 0, h: 0 },
};

const HERO_PRIORITY_WIDGET: DashboardWidget = {
  id: "hero-priority",
  chartType: "pie",
  title: "Priority Breakdown",
  titleIsCustom: true,
  fieldMapping: { chartType: "pie", groupBy: "priority" },
  layout: { x: 0, y: 0, w: 0, h: 0 },
};

export function ProjectsBrowseView({
  snapshot,
  taxonomies,
}: {
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
}) {
  const plugin = usePlugin();
  const tabs = useTabs();

  const [showHeroCharts, setShowHeroCharts] = useState(true);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deletePlan, setDeletePlan] = useState<DeletionPlan | null>(null);

  const duplicate = (project: Project) => {
    void plugin.mutations
      .duplicateProject(snapshot, project)
      .then((file) => tabs.openProject(withoutExtension(file.path)));
  };

  const context = useMemo(() => snapshotContext(snapshot), [snapshot]);
  const statusData = useMemo(
    () => computeWidgetData(HERO_STATUS_WIDGET, snapshot.tasks, context),
    [snapshot.tasks, context],
  );
  const priorityData = useMemo(
    () => computeWidgetData(HERO_PRIORITY_WIDGET, snapshot.tasks, context),
    [snapshot.tasks, context],
  );

  return (
    <div className="vf-browse">
      <BrowseHeader
        title="Projects"
        noun="project"
        count={snapshot.projects.length}
        idPrefix={snapshot.workspace.idPrefix}
        actionLabel="New project"
        onAction={() => setCreating(true)}
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
                  {HERO_STATUS_WIDGET.title}
                </span>
              </div>
              <div className="vf-dash-widget-body">
                <WidgetChart widget={HERO_STATUS_WIDGET} data={statusData} />
              </div>
            </div>
          </div>
          <div className="vf-browse-hero-chart">
            <div className="vf-dash-widget">
              <div className="vf-dash-widget-head">
                <span className="vf-browse-hero-chart-title">
                  {HERO_PRIORITY_WIDGET.title}
                </span>
              </div>
              <div className="vf-dash-widget-body">
                <WidgetChart
                  widget={HERO_PRIORITY_WIDGET}
                  data={priorityData}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {snapshot.projects.length === 0 ? (
        <BrowseEmpty label="projects" actionLabel="New project" />
      ) : (
        <BrowseList>
          {snapshot.projects.map((project) => (
            <BrowseCard
              key={project.path}
              onClick={() => tabs.openProject(project.path)}
              trailing={
                <BrowseCardMenu
                  open={menuPath === project.path}
                  onToggle={() =>
                    setMenuPath((p) =>
                      p === project.path ? null : project.path,
                    )
                  }
                  onClose={() => setMenuPath(null)}
                >
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuPath(null);
                      setEditing(project);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuPath(null);
                      duplicate(project);
                    }}
                  >
                    Duplicate
                  </button>
                  <div className="vf-menu-divider" aria-hidden />
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuPath(null);
                      setDeletePlan(planDeletion(scopeOf(snapshot), project));
                    }}
                  >
                    Move to Trash
                  </button>
                </BrowseCardMenu>
              }
            >
              <ProjectCardContent
                snapshot={snapshot}
                taxonomies={taxonomies}
                project={project}
              />
            </BrowseCard>
          ))}
        </BrowseList>
      )}

      {deletePlan && (
        <DeleteEntityDialog
          snapshot={snapshot}
          plan={deletePlan}
          onClose={() => setDeletePlan(null)}
        />
      )}

      {creating && (
        <NamedIconDialog
          title="New project"
          initialName="New project"
          initialIcon="folder"
          confirmLabel="Create"
          validateName={(name) =>
            isProjectTitleTaken(snapshot.projects, name)
              ? `A project named "${name.trim()}" already exists`
              : null
          }
          onConfirm={(name, icon) =>
            void plugin.mutations
              .createProject(snapshot, name, icon)
              .then((file) => tabs.openProject(withoutExtension(file.path)))
          }
          onClose={() => setCreating(false)}
        />
      )}

      {editing && (
        <NamedIconDialog
          title="Edit project"
          initialName={editing.title}
          initialIcon={editing.icon}
          iconFallback="folder"
          confirmLabel="Save"
          validateName={(name) =>
            isProjectTitleTaken(snapshot.projects, name, editing.path)
              ? `A project named "${name.trim()}" already exists`
              : null
          }
          onConfirm={(name, icon) =>
            void plugin.mutations.updateProject(editing, {
              title: name,
              icon,
            })
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
