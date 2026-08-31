/**
 * Sidebar: a minimizable, drag-resizable rail of three collapsible
 * sections — Workspaces, Views, Projects — each showing an item count and a
 * "new" button, plus Settings pinned at the bottom.
 *
 * Every row is flat hoverable text with an editable icon. The active view row
 * shows accent text; the current workspace row is filled with the accent, since
 * the workspace is the primary selection.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  SYSTEM_VIEW_ALL_TASKS_ID,
  SYSTEM_VIEW_ALL_TASKS_NAME,
  SYSTEM_VIEW_UNTRIAGED_ID,
  SYSTEM_VIEW_UNTRIAGED_NAME,
  isSystemViewId,
  layoutIcon,
  newView,
} from "../core/views";
import { newDashboard } from "../core/dashboards";
import { newConfigId } from "../core/ids";
import { isProjectTitleTaken } from "../core/serialization";
import {
  planDeletion,
  scopeOf,
  type DeletionPlan,
} from "../core/hierarchy";
import { withoutExtension } from "../obsidian/note-io";
import {
  describeUsage,
  findTaxonomyUsage,
  planTaxonomyDeletion,
  workspaceTaxonomies,
  type TaxonomyDeletionPlan,
  type TaxonomyUsage,
} from "../core/taxonomy";
import {
  findPersonUsage,
  planPersonDeletion,
  type PersonDeletionPlan,
} from "../core/people";
import type {
  DashboardConfig,
  Person,
  Project,
  SavedView,
  WorkspaceSnapshot,
} from "../core/types";
import { Icon } from "./components/Icon";
import { LabelChip } from "./components/TaskBits";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { DeleteEntityDialog } from "./DeleteEntityDialog";
import { LabelDialog } from "./modals/LabelDialog";
import { PersonDialog } from "./modals/PersonDialog";
import { ReplacePersonDialog } from "./modals/ReplacePersonDialog";
import { ReplaceValueDialog } from "./settings/ReplaceValueDialog";
import {
  usePlugin,
  useSetActiveWorkspace,
  useSidebarChrome,
  useWorkspaces,
} from "./context";
import { NamedIconDialog } from "./modals/NamedIconDialog";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { tabAccentRoot, useTabs } from "./tabs-context";
import { workspaceAccentColor } from "../core/workspace-color";

const MIN_WIDTH = 170;
const SLIVER_WIDTH = 44;
/** No fixed upper bound — only keep this much room for the content area. */
const MIN_CONTENT_WIDTH = 240;

/** The widest the sidebar may get right now, given the window. */
function maxSidebarWidth(): number {
  return Math.max(MIN_WIDTH, window.innerWidth - MIN_CONTENT_WIDTH);
}

export function Sidebar({
  snapshot,
  activeViewId,
  onSelectView,
}: {
  snapshot: WorkspaceSnapshot;
  activeViewId: string;
  onSelectView: (id: string) => void;
}) {
  const { activeId, openScreen } = useTabs();
  const { minimized, width: storedWidth, setMinimized, setWidth } =
    useSidebarChrome();

  const width = minimized
    ? SLIVER_WIDTH
    : clamp(storedWidth, MIN_WIDTH, maxSidebarWidth());

  return (
    <aside
      className={`vf-sidebar${minimized ? " is-minimized" : ""}`}
      style={{ width, flexBasis: width }}
    >
      <div className="vf-sidebar-top">
        <button
          className="vf-sidebar-minimize"
          title={minimized ? "Expand sidebar" : "Minimize sidebar"}
          aria-label={minimized ? "Expand sidebar" : "Minimize sidebar"}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
      </div>

      {!minimized && (
        <>
          <WorkspacesSection snapshot={snapshot} />

          {/* All Tasks + Untriaged are permanent System Views — they can't be
              deleted and don't belong in the Views section list. Rendered as
              bare rows (like Help/Settings), fenced off with a divider top and
              bottom so they read as their own band between Workspaces and
              Views. */}
          <div className="vf-sidebar-sep" aria-hidden />
          <div className="vf-permanent-views">
            <PermanentViewRow
              snapshot={snapshot}
              viewId={SYSTEM_VIEW_UNTRIAGED_ID}
              name={SYSTEM_VIEW_UNTRIAGED_NAME}
              fallbackIcon="inbox"
              activeViewId={activeViewId}
              onSelectView={onSelectView}
            />
            <PermanentViewRow
              snapshot={snapshot}
              viewId={SYSTEM_VIEW_ALL_TASKS_ID}
              name={SYSTEM_VIEW_ALL_TASKS_NAME}
              fallbackIcon="list"
              activeViewId={activeViewId}
              onSelectView={onSelectView}
            />
          </div>
          <div className="vf-sidebar-sep" aria-hidden />

          <ViewsSection
            snapshot={snapshot}
            activeViewId={activeViewId}
            onSelectView={onSelectView}
          />

          <DashboardsSection snapshot={snapshot} />

          <ProjectsSection snapshot={snapshot} />

          <LabelsSection snapshot={snapshot} />

          <PeopleSection snapshot={snapshot} />

          <div className="vf-sidebar-spacer" />

          <div className="vf-sidebar-sep" aria-hidden />

          <NavRow
            icon="trash-2"
            label="Trash"
            active={activeId === "trash"}
            onClick={() => openScreen("trash")}
          />

          <NavRow
            icon="circle-help"
            label="Help"
            active={activeId === "help"}
            onClick={() => openScreen("help")}
          />

          <NavRow
            icon="settings-glyph"
            label="Settings"
            active={activeId === "settings"}
            onClick={() => openScreen("settings")}
          />

          <ResizeHandle
            width={width}
            onResize={(w) => setWidth(w)}
          />
        </>
      )}
    </aside>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function ResizeHandle({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  return (
    <div
      className="vf-sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { startX: event.clientX, startWidth: width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const next = clamp(
          drag.current.startWidth + (event.clientX - drag.current.startX),
          MIN_WIDTH,
          maxSidebarWidth(),
        );
        onResize(next);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onDoubleClick={() => onResize(220)}
      title="Drag to resize — double-click to reset"
    />
  );
}

/* ---------------------------------------------------------------- section -- */

function Section({
  id,
  title,
  count,
  action,
  onOpenHub,
  children,
}: {
  id: string;
  title: string;
  count: number;
  action?: ReactNode;
  /**
   * Where the title + count click leads, for sections that have a hub screen
   * (Views/Dashboards/Projects). Absent — Labels, Workspaces — the title falls
   * back to toggling collapse, same as the chevron.
   */
  onOpenHub?: () => void;
  children: ReactNode;
}) {
  const { collapsed: collapsedMap, toggleSection } = useSidebarChrome();
  const collapsed = collapsedMap[id] === true;

  const toggle = () => toggleSection(id);

  return (
    <div className="vf-section">
      <div className="vf-section-head">
        {/* Chevron and title are separate sibling buttons — a button can't nest
            inside a button, and only the chevron should toggle collapse when a
            hub exists. */}
        <button
          className="vf-section-chevron-btn"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          onClick={toggle}
        >
          <span
            className={`vf-section-chevron${collapsed ? "" : " is-open"}`}
            aria-hidden
          >
            ›
          </span>
        </button>
        <button
          className="vf-section-title-btn"
          onClick={onOpenHub ?? toggle}
        >
          <span className="vf-section-title">{title}</span>
          <span className="vf-section-count">({count})</span>
        </button>
        {action && <div className="vf-section-action">{action}</div>}
      </div>
      {!collapsed && <div className="vf-section-body">{children}</div>}
    </div>
  );
}

function AddButton({
  title,
  onClick,
}: {
  title: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      className="vf-section-add"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
    >
      +
    </button>
  );
}

/* -------------------------------------------------------------------- row -- */

function NavRow({
  label,
  icon,
  iconFallback,
  chipColor,
  accentColor,
  active,
  variant,
  onClick,
  trailing,
}: {
  label: string;
  /** Curated icon id, or the sentinel "settings-glyph". */
  icon?: string;
  iconFallback?: string;
  /** Render the label text as a tinted pill in this colour — labels use this. */
  chipColor?: string;
  /**
   * Owning-workspace accent dot, shown before the icon. Only passed for
   * `variant="workspace"` rows while tabs from more than one workspace are open.
   */
  accentColor?: string;
  active?: boolean;
  variant?: "view" | "workspace";
  onClick: () => void;
  trailing?: ReactNode;
}) {
  const cls = [
    "vf-nav-row",
    active && variant === "workspace" ? "is-current" : "",
    active && variant !== "workspace" ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="vf-nav-row-wrap">
      <button
        className={cls}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
      >
        {chipColor !== undefined ? (
          <LabelChip name={label} color={chipColor} className="vf-nav-chip" />
        ) : (
          <>
            {accentColor && (
              <span
                className="vf-workspace-dot"
                style={{ backgroundColor: accentColor }}
                aria-hidden
              />
            )}
            <span className="vf-nav-icon" aria-hidden>
              {icon === "settings-glyph" ? (
                "⚙"
              ) : (
                <Icon id={icon} fallback={iconFallback} size={14} />
              )}
            </span>
            <span className="vf-nav-label">{label}</span>
          </>
        )}
      </button>
      {trailing}
    </div>
  );
}

function RowMenu({
  open,
  onToggle,
  onClose,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    window.addEventListener("click", onClose);
    return () => window.removeEventListener("click", onClose);
  }, [open, onClose]);

  return (
    <>
      <button
        className="vf-nav-row-menu"
        title="Options"
        aria-label="Options"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        ⋯
      </button>
      {open && (
        <div className="vf-menu" onClick={(event) => event.stopPropagation()}>
          {children}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- workspaces -- */

function WorkspacesSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const workspaces = useWorkspaces();
  const setActiveWorkspace = useSetActiveWorkspace();
  const tabs = useTabs();
  const [menuRoot, setMenuRoot] = useState<string | null>(null);
  const [editRoot, setEditRoot] = useState<string | null>(null);
  const [deleteRoot, setDeleteRoot] = useState<string | null>(null);

  const editing = workspaces.find((w) => w.workspace.root === editRoot);
  const deleting = workspaces.find((w) => w.workspace.root === deleteRoot);

  // Distinct owning-workspace roots among all currently open tabs. Accents turn
  // on the moment an open tab points somewhere other than the active workspace
  // (a second workspace's tab alongside this one's, or the tab left stranded
  // after switching workspace) — then every row with ≥ 1 open tab gets a dot in
  // its colour. Pure derived state, disappears when tabs close.
  const openWorkspaceRoots = useMemo(() => {
    const roots = new Set<string>();
    for (const tab of tabs.tabs) {
      const root = tabAccentRoot(plugin, tab, snapshot.workspace.root);
      if (root) roots.add(root);
    }
    return roots;
  }, [tabs.tabs, plugin, snapshot.workspace.root]);

  const showWorkspaceAccents = [...openWorkspaceRoots].some(
    (root) => root !== snapshot.workspace.root,
  );

  return (
    <Section
      id="workspaces"
      title="Workspaces"
      count={workspaces.length}
      action={
        <AddButton
          title="New workspace"
          onClick={() => tabs.openScreen("new-workspace")}
        />
      }
    >
      {workspaces.map((entry) => (
        <NavRow
          key={entry.workspace.root}
          label={entry.workspace.name}
          icon={entry.workspace.icon}
          iconFallback="layers"
          variant="workspace"
          accentColor={
            showWorkspaceAccents &&
            openWorkspaceRoots.has(entry.workspace.root)
              ? workspaceAccentColor(entry.workspace.root)
              : undefined
          }
          active={entry.workspace.root === snapshot.workspace.root}
          onClick={() => {
            setActiveWorkspace(entry.workspace.root);
            // If the front tab belongs to the workspace being left, move to an
            // already-open tab that renders against the new one (see
            // `syncToWorkspace`) — only opening its All Tasks as a last resort.
            // The foreign tab stays open, accent-coloured.
            tabs.syncToWorkspace(entry.workspace.root);
            // Clicking a workspace row with nothing open lands on its All Tasks —
            // including a click on the workspace that's already active, which
            // doesn't change the root and so wouldn't trip TabsProvider's
            // auto-open effect on its own.
            if (tabs.tabs.length === 0)
              tabs.openView(SYSTEM_VIEW_ALL_TASKS_ID, entry.workspace.root);
          }}
          trailing={
            <RowMenu
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
                className="vf-menu-item vf-menu-item-danger"
                onClick={() => {
                  setMenuRoot(null);
                  setDeleteRoot(entry.workspace.root);
                }}
              >
                Move to Trash
              </button>
            </RowMenu>
          }
        />
      ))}

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
    </Section>
  );
}

/* -------------------------------------------------------- permanent views -- */

function PermanentViewRow({
  snapshot,
  viewId,
  name,
  fallbackIcon,
  activeViewId,
  onSelectView,
}: {
  snapshot: WorkspaceSnapshot;
  viewId: string;
  name: string;
  fallbackIcon: string;
  activeViewId: string;
  onSelectView: (id: string) => void;
}) {
  const view = snapshot.views.find((v) => v.id === viewId);
  return (
    <NavRow
      icon={view?.icon ?? fallbackIcon}
      iconFallback={fallbackIcon}
      label={view?.name ?? name}
      variant="view"
      active={activeViewId === viewId}
      onClick={() => onSelectView(viewId)}
    />
  );
}

/* ------------------------------------------------------------------ views -- */

type ViewDialogState =
  | { mode: "create"; view: SavedView }
  | { mode: "edit"; view: SavedView }
  | null;

function ViewsSection({
  snapshot,
  activeViewId,
  onSelectView,
}: {
  snapshot: WorkspaceSnapshot;
  activeViewId: string;
  onSelectView: (id: string) => void;
}) {
  const plugin = usePlugin();
  const { openScreen } = useTabs();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ViewDialogState>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);

  // The two System Views (All Tasks, Untriaged) render as their own bare rows
  // above this section — never in the list, never in the count.
  const userViews = snapshot.views.filter(
    (v) => !isSystemViewId(v.id),
  );

  const create = () => {
    const view = newView(newConfigId("view"), "New view", "list");
    void plugin.mutations.addView(snapshot, view).then(() => {
      onSelectView(view.id);
      setDialog({ mode: "create", view });
    });
  };

  const duplicate = (view: SavedView) => {
    const copy: SavedView = {
      ...view,
      id: newConfigId("view"),
      name: `${view.name} copy`,
    };
    void plugin.mutations
      .addView(snapshot, copy)
      .then(() => onSelectView(copy.id));
  };

  const remove = (view: SavedView) => {
    if (isSystemViewId(view.id)) return;
    // The view's tab (if open) is closed by App's `pruneViews` once the view
    // leaves `snapshot.views`.
    void plugin.mutations.deleteView(snapshot, view.id);
  };

  return (
    <Section
      id="views"
      title="Views"
      count={userViews.length}
      action={<AddButton title="New view" onClick={create} />}
      onOpenHub={() => openScreen("views")}
    >
      {userViews.length === 0 && (
        <p className="vf-section-empty">No custom views yet</p>
      )}
      {userViews.map((view) => (
        <NavRow
          key={view.id}
          label={view.name}
          icon={view.icon}
          iconFallback={layoutIcon(view.viewType)}
          variant="view"
          active={view.id === activeViewId}
          onClick={() => onSelectView(view.id)}
          trailing={
            <RowMenu
              open={menuOpenId === view.id}
              onToggle={() =>
                setMenuOpenId((current) =>
                  current === view.id ? null : view.id,
                )
              }
              onClose={() => setMenuOpenId(null)}
            >
              <button
                className="vf-menu-item"
                onClick={() => {
                  setMenuOpenId(null);
                  setDialog({ mode: "edit", view });
                }}
              >
                Edit
              </button>
              <button
                className="vf-menu-item"
                onClick={() => {
                  setMenuOpenId(null);
                  duplicate(view);
                }}
              >
                Duplicate
              </button>
              {!isSystemViewId(view.id) && (
                <button
                  className="vf-menu-item vf-menu-item-danger"
                  onClick={() => {
                    setMenuOpenId(null);
                    setDeleting(view);
                  }}
                >
                  Move to Trash
                </button>
              )}
            </RowMenu>
          }
        />
      ))}

      {deleting && (
        <ConfirmDeleteDialog
          title={`Delete view "${deleting.name}"?`}
          body="The view definition is removed. Tasks are not affected. You can restore it anytime from the Trash view."
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            remove(deleting);
            setDeleting(null);
          }}
        />
      )}

      {dialog && (
        <NamedIconDialog
          title={dialog.mode === "create" ? "Name your view" : "Edit view"}
          initialName={dialog.view.name}
          initialIcon={dialog.view.icon}
          iconFallback={layoutIcon(dialog.view.viewType)}
          confirmLabel={dialog.mode === "create" ? "Create" : "Save"}
          onConfirm={(name, icon) =>
            void plugin.mutations.updateView(snapshot, {
              ...dialog.view,
              name,
              icon,
            })
          }
          // Cancelling the "name your new view" step discards the view that was
          // auto-created to open it; App's `pruneViews` then closes its tab.
          onCancel={
            dialog.mode === "create"
              ? () => void plugin.mutations.deleteView(snapshot, dialog.view.id)
              : undefined
          }
          onClose={() => setDialog(null)}
        />
      )}
    </Section>
  );
}

/* ------------------------------------------------------------- dashboards -- */

type DashboardDialogState =
  | { mode: "create"; dashboard: DashboardConfig }
  | { mode: "edit"; dashboard: DashboardConfig }
  | null;

function DashboardsSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const { activeTab, openDashboard, openScreen } = useTabs();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DashboardDialogState>(null);
  const [deleting, setDeleting] = useState<DashboardConfig | null>(null);

  const dashboards = [...snapshot.dashboards].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const activeDashboardId =
    activeTab?.kind === "dashboard" ? activeTab.dashboardId : null;

  // Mirror the "new view" flow: create with a default name, then open the
  // name + icon modal to finish it.
  const create = () => {
    const dashboard = newDashboard(newConfigId("dashboard"), "New dashboard");
    void plugin.mutations.addDashboard(snapshot, dashboard).then(() => {
      openDashboard(dashboard.id);
      setDialog({ mode: "create", dashboard });
    });
  };

  const duplicate = (id: string) => {
    const source = snapshot.dashboards.find((d) => d.id === id);
    if (!source) return;
    const copy: DashboardConfig = {
      ...source,
      id: newConfigId("dashboard"),
      name: `${source.name} copy`,
      widgets: source.widgets.map((w) => ({ ...w })),
    };
    void plugin.mutations
      .addDashboard(snapshot, copy)
      .then(() => openDashboard(copy.id));
  };

  return (
    <Section
      id="dashboards"
      title="Dashboards"
      count={dashboards.length}
      action={<AddButton title="New dashboard" onClick={create} />}
      onOpenHub={() => openScreen("dashboards")}
    >
      {dashboards.length === 0 ? (
        <p className="vf-section-empty">No dashboards yet</p>
      ) : (
        dashboards.map((dashboard) => (
          <NavRow
            key={dashboard.id}
            label={dashboard.name}
            icon={dashboard.icon}
            iconFallback="layout-dashboard"
            variant="view"
            active={activeDashboardId === dashboard.id}
            onClick={() => openDashboard(dashboard.id)}
            trailing={
              <RowMenu
                open={menuId === dashboard.id}
                onToggle={() =>
                  setMenuId((m) => (m === dashboard.id ? null : dashboard.id))
                }
                onClose={() => setMenuId(null)}
              >
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuId(null);
                    setDialog({ mode: "edit", dashboard });
                  }}
                >
                  Edit
                </button>
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuId(null);
                    duplicate(dashboard.id);
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="vf-menu-item vf-menu-item-danger"
                  onClick={() => {
                    setMenuId(null);
                    setDeleting(dashboard);
                  }}
                >
                  Move to Trash
                </button>
              </RowMenu>
            }
          />
        ))
      )}

      {dialog && (
        <NamedIconDialog
          title={
            dialog.mode === "create" ? "Name your dashboard" : "Edit dashboard"
          }
          initialName={dialog.dashboard.name}
          initialIcon={dialog.dashboard.icon}
          iconFallback="layout-dashboard"
          confirmLabel={dialog.mode === "create" ? "Create" : "Save"}
          onConfirm={(name, icon) =>
            void plugin.mutations.updateDashboard(snapshot, {
              ...dialog.dashboard,
              name,
              icon,
            })
          }
          // Cancelling the "name your new dashboard" step discards the dashboard
          // that was auto-created to open it; App's `pruneDashboards` then
          // closes its tab.
          onCancel={
            dialog.mode === "create"
              ? () =>
                  void plugin.mutations.deleteDashboard(
                    snapshot,
                    dialog.dashboard.id,
                  )
              : undefined
          }
          onClose={() => setDialog(null)}
        />
      )}

      {deleting && (
        <ConfirmDeleteDialog
          title={`Delete dashboard "${deleting.name}"?`}
          body={`Removes the dashboard and its ${deleting.widgets.length} chart${deleting.widgets.length === 1 ? "" : "s"}. Tasks are not affected. You can restore it anytime from the Trash view.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void plugin.mutations.deleteDashboard(snapshot, deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- projects -- */

function ProjectsSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const tabs = useTabs();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletePlan, setDeletePlan] = useState<DeletionPlan | null>(null);

  const projects = [...snapshot.projects].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  const activeProjectPath =
    tabs.activeTab?.kind === "project" ? tabs.activeTab.path : null;

  const duplicate = (project: Project) => {
    void plugin.mutations
      .duplicateProject(snapshot, project)
      .then((file) => tabs.openProject(withoutExtension(file.path)));
  };

  return (
    <Section
      id="projects"
      title="Projects"
      count={projects.length}
      action={
        <AddButton title="New project" onClick={() => setCreating(true)} />
      }
      onOpenHub={() => tabs.openScreen("projects")}
    >
      {projects.length === 0 ? (
        <p className="vf-section-empty">No projects yet</p>
      ) : (
        projects.map((project) => (
          <NavRow
            key={project.path}
            label={project.title}
            icon={project.icon}
            iconFallback="folder"
            variant="view"
            active={activeProjectPath === project.path}
            onClick={() => tabs.openProject(project.path)}
            trailing={
              <RowMenu
                open={menuPath === project.path}
                onToggle={() =>
                  setMenuPath((p) => (p === project.path ? null : project.path))
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
                <button
                  className="vf-menu-item vf-menu-item-danger"
                  onClick={() => {
                    setMenuPath(null);
                    setDeletePlan(planDeletion(scopeOf(snapshot), project));
                  }}
                >
                  Move to Trash
                </button>
              </RowMenu>
            }
          />
        ))
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
    </Section>
  );
}

/* ----------------------------------------------------------------- labels -- */

function LabelsSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const { activeTab, openLabel, openScreen } = useTabs();
  const labels = workspaceTaxonomies(snapshot.workspace).label;
  const ordered = [...labels.values].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const [menuId, setMenuId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<{
    plan: TaxonomyDeletionPlan;
    usage: TaxonomyUsage;
  } | null>(null);
  // Plain "are you sure?" gate, shown before the reassign / remove-from-all modal.
  const [confirming, setConfirming] = useState<{
    plan: TaxonomyDeletionPlan;
    usage: TaxonomyUsage;
  } | null>(null);

  const editLabel = ordered.find((l) => l.id === editing);
  const activeLabelId = activeTab?.kind === "label" ? activeTab.labelId : null;

  const requestDelete = (id: string) => {
    const usage = findTaxonomyUsage("label", id, {
      tasks: snapshot.tasks,
      projects: snapshot.projects,
    });
    const plan = planTaxonomyDeletion(labels, id, usage.count);
    setConfirming({ plan, usage });
  };

  const performDelete = (plan: TaxonomyDeletionPlan, usage: TaxonomyUsage) => {
    setConfirming(null);
    if (!plan.blocked) {
      void plugin.mutations.applyTaxonomyDeletionPlan(
        snapshot,
        labels,
        plan,
        null,
      );
      return;
    }
    setDeletion({ plan, usage });
  };

  return (
    <Section
      id="labels"
      title="Labels"
      count={ordered.length}
      action={<AddButton title="New label" onClick={() => setCreating(true)} />}
      onOpenHub={() => openScreen("labels")}
    >
      {ordered.length === 0 ? (
        <p className="vf-section-empty">No labels yet</p>
      ) : (
        ordered.map((label) => (
          <NavRow
            key={label.id}
            label={label.name}
            chipColor={label.color}
            active={activeLabelId === label.id}
            variant="view"
            onClick={() => openLabel(label.id)}
            trailing={
              <RowMenu
                open={menuId === label.id}
                onToggle={() =>
                  setMenuId((m) => (m === label.id ? null : label.id))
                }
                onClose={() => setMenuId(null)}
              >
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuId(null);
                    setEditing(label.id);
                  }}
                >
                  Edit
                </button>
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuId(null);
                    requestDelete(label.id);
                  }}
                >
                  Delete
                </button>
              </RowMenu>
            }
          />
        ))
      )}

      {creating && (
        <LabelDialog
          title="New label"
          initialName="New label"
          confirmLabel="Create"
          onConfirm={(name, color, description) =>
            plugin.mutations
              .createLabel(snapshot, name, color, description)
              .then(() => {})
          }
          onClose={() => setCreating(false)}
        />
      )}

      {editLabel && (
        <LabelDialog
          title="Edit label"
          initialName={editLabel.name}
          initialColor={editLabel.color}
          initialDescription={editLabel.description}
          confirmLabel="Save"
          onConfirm={(name, color, description) =>
            plugin.mutations.updateLabel(snapshot, editLabel.id, {
              name,
              color,
              description,
            })
          }
          onClose={() => setEditing(null)}
        />
      )}

      {confirming && (
        <ConfirmDeleteDialog
          title={`Delete label "${confirming.plan.valueName}"?`}
          body={
            confirming.plan.blocked
              ? `It's on ${describeUsage(confirming.usage)} — you'll choose what happens to ${confirming.usage.count === 1 ? "it" : "them"} next.`
              : "This can't be undone."
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => performDelete(confirming.plan, confirming.usage)}
        />
      )}

      {deletion && (
        <ReplaceValueDialog
          plan={deletion.plan}
          usage={deletion.usage}
          allowRemoveAll
          onCancel={() => setDeletion(null)}
          onConfirm={(replacementId) => {
            void plugin.mutations.applyTaxonomyDeletionPlan(
              snapshot,
              labels,
              deletion.plan,
              replacementId,
            );
            setDeletion(null);
          }}
        />
      )}
    </Section>
  );
}

/* ----------------------------------------------------------------- people -- */

function PeopleSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const { activeTab, openPerson, openScreen } = useTabs();
  const people = [...snapshot.workspace.people].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const [menuId, setMenuId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // Person deletion is never simply "blocked" — reassign-or-clear is always the
  // one dialog, so there's no separate confirm step the way Labels has.
  const [deleting, setDeleting] = useState<PersonDeletionPlan | null>(null);

  const editPerson = people.find((p) => p.id === editing);
  const activePersonId =
    activeTab?.kind === "person" ? activeTab.personId : null;

  const requestDelete = (person: Person) => {
    const usage = findPersonUsage(person.id, {
      tasks: snapshot.tasks,
      projects: snapshot.projects,
      commentCount:
        plugin.index.commentCountsByPerson(snapshot.workspace.root)[
          person.id
        ] ?? 0,
    });
    if (usage.count === 0) {
      void plugin.mutations.deletePerson(snapshot, person.id, null);
      return;
    }
    setDeleting(planPersonDeletion(person, snapshot.workspace.people, usage));
  };

  return (
    <Section
      id="people"
      title="People"
      count={people.length}
      action={<AddButton title="New person" onClick={() => setCreating(true)} />}
      onOpenHub={() => openScreen("people")}
    >
      {people.length === 0 ? (
        <p className="vf-section-empty">No people yet</p>
      ) : (
        people.map((person) => (
          <NavRow
            key={person.id}
            label={person.name}
            iconFallback="user"
            active={activePersonId === person.id}
            variant="view"
            onClick={() => openPerson(person.id)}
            trailing={
              <RowMenu
                open={menuId === person.id}
                onToggle={() =>
                  setMenuId((m) => (m === person.id ? null : person.id))
                }
                onClose={() => setMenuId(null)}
              >
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuId(null);
                    setEditing(person.id);
                  }}
                >
                  Edit
                </button>
                <button
                  className="vf-menu-item vf-menu-item-danger"
                  onClick={() => {
                    setMenuId(null);
                    requestDelete(person);
                  }}
                >
                  Delete
                </button>
              </RowMenu>
            }
          />
        ))
      )}

      {creating && (
        <PersonDialog
          title="New person"
          initialName=""
          confirmLabel="Create"
          onConfirm={(name, aliases) =>
            plugin.mutations.createPerson(snapshot, name, aliases).then(() => {})
          }
          onClose={() => setCreating(false)}
        />
      )}

      {editPerson && (
        <PersonDialog
          title="Edit person"
          initialName={editPerson.name}
          initialAliases={editPerson.aliases}
          confirmLabel="Save"
          onConfirm={(name, aliases) =>
            plugin.mutations.updatePerson(snapshot, editPerson.id, {
              name,
              aliases,
            })
          }
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ReplacePersonDialog
          plan={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={(replacementId) => {
            void plugin.mutations.deletePerson(
              snapshot,
              deleting.personId,
              replacementId,
            );
            setDeleting(null);
          }}
        />
      )}
    </Section>
  );
}
