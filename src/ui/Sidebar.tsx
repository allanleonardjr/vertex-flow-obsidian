/**
 * Sidebar: a minimizable, drag-resizable rail of three collapsible
 * sections — Workspaces, Views, Projects — each showing an item count and a
 * "new" button, plus Settings pinned at the bottom.
 *
 * Every row is flat hoverable text with an editable icon. The active view row
 * shows accent text; the current workspace row is filled with the accent, since
 * the workspace is the primary selection.
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { planDeletion, scopeOf, type DeletionPlan } from "../core/hierarchy";
import { withoutExtension } from "../obsidian/note-io";
import { labelView, personView } from "./App";
import { MeIdentityBanner } from "./components/MeIdentityBanner";
import { useMePersonId } from "./useMe";
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
import { ExportDialog } from "./modals/ExportDialog";
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
import { useCompactNav } from "./compact-nav-context";
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
  const plugin = usePlugin();
  const { activeId, openScreen } = useTabs();
  const {
    minimized,
    width: storedWidth,
    setMinimized,
    setWidth,
  } = useSidebarChrome();
  const [exporting, setExporting] = useState(false);

  // Bridge for the "Export…" command — kept outside the `{!minimized}` block so
  // it still fires when the sidebar is collapsed. Mirrors the
  // pendingEditPath/pendingOpenView pattern in main.ts; the command calls
  // `index.touch()` so this repaints and the check below runs even when the
  // sidebar was already mounted.
  useEffect(() => {
    if (!plugin.pendingExport) return;
    plugin.pendingExport = false;
    setExporting(true);
  });
  // Compact-mode drawer state. In wide panes `navOpen` stays false and this is
  // inert; in compact panes the strip's Navigation button drives it and the
  // aside slides in as a drawer. Any navigation from a row here closes it.
  const { navOpen, closeDrawers } = useCompactNav();

  const width = minimized
    ? SLIVER_WIDTH
    : clamp(storedWidth, MIN_WIDTH, maxSidebarWidth());

  return (
    <aside
      className={`vf-sidebar${minimized ? " is-minimized" : ""}${
        navOpen ? " is-compact-open" : ""
      }`}
      style={{ width, flexBasis: width, ["--vf-sidebar-w" as string]: width }}
      onClickCapture={(event) => {
        // In compact mode the sidebar is an overlay drawer. Any interaction
        // that navigates (a view/project/label/workspace/screen row, a section
        // title that opens a hub) should also dismiss it; collapsing a section,
        // opening a row menu / "+" add, or toggling the minimize stay put.
        const el = event.target as HTMLElement;
        if (
          el.closest(
            ".vf-menu, .vf-nav-row-menu, .vf-section-chevron-btn, .vf-section-add, .vf-sidebar-minimize",
          )
        ) {
          return;
        }
        closeDrawers();
      }}
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

      <div className="vf-drawer-head">
        <span className="vf-drawer-head-title">Navigation</span>
        <button
          className="vf-nav-close"
          title="Close navigation"
          aria-label="Close navigation"
          onClick={() => closeDrawers()}
        >
          <PanelLeftClose size={16} />
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

          <div className="vf-sidebar-sep" aria-hidden />

          <NavRow
            icon="repeat"
            label="Recurring"
            active={activeId === "recurring"}
            onClick={() => openScreen("recurring")}
          />

          <div className="vf-sidebar-spacer" />

          <div className="vf-sidebar-sep" aria-hidden />

          <NavRow
            icon="download"
            label="Export…"
            onClick={() => setExporting(true)}
          />

          <NavRow
            icon="history"
            label="History"
            active={activeId === "history"}
            onClick={() => openScreen("history")}
          />

          <NavRow
            icon="trash-2"
            label="Trash"
            active={activeId === "trash"}
            onClick={() => openScreen("trash")}
          />

          <div className="vf-sidebar-sep" aria-hidden />

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

          <ResizeHandle width={width} onResize={(w) => setWidth(w)} />
        </>
      )}
      {exporting && (
        <ExportDialog
          snapshot={snapshot}
          allowTemplateExport
          initialScope={
            activeViewId && snapshot.views.some((v) => v.id === activeViewId)
              ? {
                  kind: "view",
                  view: snapshot.views.find((v) => v.id === activeViewId)!,
                }
              : { kind: "workspace" }
          }
          onClose={() => setExporting(false)}
        />
      )}
      <div className="vf-sidebar-footer">
        v{plugin.manifest.version} by{" "}
        <a href="https://www.linkedin.com/in/allanleonardjr"> JR Leonard </a>
      </div>
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
        <button className="vf-section-title-btn" onClick={onOpenHub ?? toggle}>
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
  displayLabel,
  indent = 0,
  icon,
  iconFallback,
  chipColor,
  accentColor,
  active,
  variant,
  onClick,
  trailing,
  hint,
}: {
  label: string;
  /**
   * Text actually rendered; falls back to `label`. Nested label rows pass just
   * the leaf segment here while `label` (the full path) backs the tooltip.
   */
  displayLabel?: string;
  /** Nesting depth — adds `20 + indent * 14`px of left padding, overriding the base. */
  indent?: number;
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
  /** Identity marker at the row end, e.g. "You" — an accent pill, same
   *  `.vf-you-badge` treatment as `personNode` and the People hub. */
  hint?: string;
}) {
  const cls = [
    "vf-nav-row",
    active && variant === "workspace" ? "is-current" : "",
    active && variant !== "workspace" ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const text = displayLabel ?? label;

  return (
    <div className="vf-nav-row-wrap">
      <button
        className={cls}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        style={indent ? { paddingLeft: 20 + indent * 14 } : undefined}
        aria-label={displayLabel && displayLabel !== label ? label : undefined}
      >
        {chipColor !== undefined ? (
          <LabelChip name={text} color={chipColor} className="vf-nav-chip" />
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
            <span className="vf-nav-label">{text}</span>
            {hint && <span className="vf-you-badge">{hint}</span>}
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
  const [exportTarget, setExportTarget] = useState<{
    workspace: WorkspaceSnapshot;
    forceMode?: "tasks" | "template";
  } | null>(null);

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
            showWorkspaceAccents && openWorkspaceRoots.has(entry.workspace.root)
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
                className="vf-menu-item"
                onClick={() => {
                  setMenuRoot(null);
                  setActiveWorkspace(entry.workspace.root);
                  setExportTarget({ workspace: entry });
                }}
              >
                Export Tasks…
              </button>
              <button
                className="vf-menu-item"
                onClick={() => {
                  setMenuRoot(null);
                  setActiveWorkspace(entry.workspace.root);
                  setExportTarget({ workspace: entry, forceMode: "template" });
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  return (
    <>
      <NavRow
        icon={view?.icon ?? fallbackIcon}
        iconFallback={fallbackIcon}
        label={view?.name ?? name}
        variant="view"
        active={activeViewId === viewId}
        onClick={() => onSelectView(viewId)}
        trailing={
          <RowMenu
            open={menuOpen}
            onToggle={() => setMenuOpen((o) => !o)}
            onClose={() => setMenuOpen(false)}
          >
            <button
              className="vf-menu-item"
              onClick={() => {
                setMenuOpen(false);
                setExporting(true);
              }}
            >
              Export Tasks…
            </button>
          </RowMenu>
        }
      />
      {exporting && view && (
        <ExportDialog
          snapshot={snapshot}
          lockScope
          initialScope={{ kind: "view", view }}
          onClose={() => setExporting(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ views -- */

type ViewDialogState = { mode: "edit"; view: SavedView } | null;

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
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<ViewDialogState>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const [exportingView, setExportingView] = useState<SavedView | null>(null);

  // The two System Views (All Tasks, Untriaged) render as their own bare rows
  // above this section — never in the list, never in the count.
  const userViews = snapshot.views
    .filter((v) => !isSystemViewId(v.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tree = buildTree(userViews, (v) => v.name);

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
      action={<AddButton title="New view" onClick={() => setCreating(true)} />}
      onOpenHub={() => openScreen("views")}
    >
      {userViews.length === 0 && (
        <p className="vf-section-empty">No custom views yet</p>
      )}
      <TreeList
        nodes={tree}
        depth={0}
        groupKeyPrefix="view-group"
        renderLeaf={(view, segment, depth) => (
          <NavRow
            key={view.id}
            label={view.name}
            displayLabel={segment}
            indent={depth}
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
                <div className="vf-menu-divider" aria-hidden />
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuOpenId(null);
                    setExportingView(view);
                  }}
                >
                  Export Tasks…
                </button>
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuOpenId(null);
                    setDeleting(view);
                  }}
                >
                  Move to Trash
                </button>
              </RowMenu>
            }
          />
        )}
      />

      {deleting && (
        <ConfirmDeleteDialog
          destructive={false}
          title={`Move view "${deleting.name}" to Trash?`}
          body="The view definition is removed. Tasks are not affected. You can restore it anytime from the Trash view."
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            remove(deleting);
            setDeleting(null);
          }}
        />
      )}

      {creating && (
        <NamedIconDialog
          title="New view"
          nameHint="Use / to nest under a group in the sidebar"
          initialName="New view"
          initialIcon={layoutIcon("list")}
          initialDescription=""
          descriptionSourcePath={`${snapshot.workspace.root}/Untitled`}
          iconFallback={layoutIcon("list")}
          confirmLabel="Create"
          onConfirm={(name, icon, description) => {
            const view = {
              ...newView(newConfigId("view"), "New view", "list"),
              name,
              icon,
              description: description?.trim() || undefined,
            };
            void plugin.mutations
              .addView(snapshot, view)
              .then(() => onSelectView(view.id));
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {dialog && (
        <NamedIconDialog
          title="Edit view"
          nameHint="Use / to nest under a group in the sidebar"
          initialName={dialog.view.name}
          initialIcon={dialog.view.icon}
          iconFallback={layoutIcon(dialog.view.viewType)}
          confirmLabel="Save"
          onConfirm={(name, icon) =>
            void plugin.mutations.updateView(snapshot, {
              ...dialog.view,
              name,
              icon,
            })
          }
          onClose={() => setDialog(null)}
        />
      )}

      {exportingView && (
        <ExportDialog
          snapshot={snapshot}
          lockScope
          initialScope={{ kind: "view", view: exportingView }}
          onClose={() => setExportingView(null)}
        />
      )}
    </Section>
  );
}

/* ------------------------------------------------------------- dashboards -- */

type DashboardDialogState = { mode: "edit"; dashboard: DashboardConfig } | null;

function DashboardsSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const { activeTab, openDashboard, openScreen } = useTabs();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<DashboardDialogState>(null);
  const [deleting, setDeleting] = useState<DashboardConfig | null>(null);

  const dashboards = [...snapshot.dashboards].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const tree = buildTree(dashboards, (d) => d.name);
  const activeDashboardId =
    activeTab?.kind === "dashboard" ? activeTab.dashboardId : null;

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
      action={
        <AddButton title="New dashboard" onClick={() => setCreating(true)} />
      }
      onOpenHub={() => openScreen("dashboards")}
    >
      {dashboards.length === 0 ? (
        <p className="vf-section-empty">No dashboards yet</p>
      ) : (
        <TreeList
          nodes={tree}
          depth={0}
          groupKeyPrefix="dashboard-group"
          renderLeaf={(dashboard, segment, depth) => (
            <NavRow
              key={dashboard.id}
              label={dashboard.name}
              displayLabel={segment}
              indent={depth}
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
                  <div className="vf-menu-divider" aria-hidden />
                  <button
                    className="vf-menu-item"
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
          )}
        />
      )}

      {creating && (
        <NamedIconDialog
          title="New dashboard"
          nameHint="Use / to nest under a group in the sidebar"
          initialName="New dashboard"
          initialIcon="layout-dashboard"
          initialDescription=""
          descriptionSourcePath={`${snapshot.workspace.root}/Untitled`}
          iconFallback="layout-dashboard"
          confirmLabel="Create"
          onConfirm={(name, icon, description) => {
            const dashboard = {
              ...newDashboard(newConfigId("dashboard"), "New dashboard"),
              name,
              icon,
              description: description?.trim() || undefined,
            };
            void plugin.mutations
              .addDashboard(snapshot, dashboard)
              .then(() => openDashboard(dashboard.id));
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {dialog && (
        <NamedIconDialog
          title="Edit dashboard"
          nameHint="Use / to nest under a group in the sidebar"
          initialName={dialog.dashboard.name}
          initialIcon={dialog.dashboard.icon}
          iconFallback="layout-dashboard"
          confirmLabel="Save"
          onConfirm={(name, icon) =>
            void plugin.mutations.updateDashboard(snapshot, {
              ...dialog.dashboard,
              name,
              icon,
            })
          }
          onClose={() => setDialog(null)}
        />
      )}

      {deleting && (
        <ConfirmDeleteDialog
          destructive={false}
          title={`Move dashboard "${deleting.name}" to Trash?`}
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
  const [exportingProject, setExportingProject] = useState<Project | null>(
    null,
  );

  const projects = [...snapshot.projects].sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  const tree = buildTree(projects, (p) => p.title);

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
        <TreeList
          nodes={tree}
          depth={0}
          groupKeyPrefix="project-group"
          renderLeaf={(project, segment, depth) => (
            <NavRow
              key={project.path}
              label={project.title}
              displayLabel={segment}
              indent={depth}
              icon={project.icon}
              iconFallback="folder"
              variant="view"
              active={activeProjectPath === project.path}
              onClick={() => tabs.openProject(project.path)}
              trailing={
                <RowMenu
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
                      setExportingProject(project);
                    }}
                  >
                    Export Tasks…
                  </button>
                  <button
                    className="vf-menu-item"
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
          )}
        />
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
          nameHint="Use / to nest under a group in the sidebar"
          initialName="New project"
          initialIcon="folder"
          initialDescription=""
          descriptionSourcePath={`${snapshot.workspace.root}/Untitled`}
          confirmLabel="Create"
          validateName={(name) =>
            isProjectTitleTaken(snapshot.projects, name)
              ? `A project named "${name.trim()}" already exists`
              : null
          }
          onConfirm={(name, icon, description) =>
            void plugin.mutations
              .createProject(snapshot, name, icon, description)
              .then((file) => tabs.openProject(withoutExtension(file.path)))
          }
          onClose={() => setCreating(false)}
        />
      )}

      {editing && (
        <NamedIconDialog
          title="Edit project"
          nameHint="Use / to nest under a group in the sidebar"
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

      {exportingProject && (
        <ExportDialog
          snapshot={snapshot}
          lockScope
          initialScope={{ kind: "project", project: exportingProject }}
          onClose={() => setExportingProject(null)}
        />
      )}
    </Section>
  );
}

/* ------------------------------------------------------ generic tree list -- */

/**
 * A node in a sidebar tree. Items whose display name contains `/` are split
 * into nested folders — one level per segment — purely for rendering; the
 * item's stored name/title stays the full path everywhere else.
 */
export type TreeNode<T> =
  | { kind: "leaf"; segment: string; value: T }
  | {
      kind: "folder";
      segment: string;
      /** Full path from the root, e.g. `"Application/UI"`. */
      path: string;
      children: TreeNode<T>[];
    };

/**
 * Alphabetical by segment, leaf before folder on a tie. This is today's
 * only sort — exported so a future manual-order feature can fall back to
 * it (e.g. "alphabetical unless a stored rank says otherwise") instead of
 * re-deriving the tie-break rule.
 */
export function defaultTreeSort<T>(a: TreeNode<T>, b: TreeNode<T>): number {
  const bySegment = a.segment.localeCompare(b.segment);
  if (bySegment !== 0) return bySegment;
  return (a.kind === "leaf" ? 0 : 1) - (b.kind === "leaf" ? 0 : 1);
}

type MutableFolder<T> = {
  path: string;
  folders: Map<string, MutableFolder<T>>;
  leaves: T[];
};

/**
 * Split each item's name on `/` and walk/create folder nodes for every
 * segment but the last. Siblings at each depth are ordered by
 * `compareSiblings` (defaults to `defaultTreeSort`) — a future manual-sort
 * feature can pass a comparator that checks a stored rank first and falls
 * back to `defaultTreeSort`, without buildTree's own logic changing.
 */
export function buildTree<T>(
  items: T[],
  getName: (item: T) => string,
  options?: { compareSiblings?: (a: TreeNode<T>, b: TreeNode<T>) => number },
): TreeNode<T>[] {
  const compare = options?.compareSiblings ?? defaultTreeSort;
  const root: MutableFolder<T> = { path: "", folders: new Map(), leaves: [] };

  for (const item of items) {
    const segments = getName(item)
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (segments.length <= 1) {
      root.leaves.push(item);
      continue;
    }

    let folder = root;
    for (const segment of segments.slice(0, -1)) {
      let next = folder.folders.get(segment);
      if (!next) {
        next = {
          path: folder.path ? `${folder.path}/${segment}` : segment,
          folders: new Map(),
          leaves: [],
        };
        folder.folders.set(segment, next);
      }
      folder = next;
    }
    folder.leaves.push(item);
  }

  const convert = (folder: MutableFolder<T>): TreeNode<T>[] => {
    const nodes: TreeNode<T>[] = [];
    for (const [segment, child] of folder.folders) {
      nodes.push({
        kind: "folder",
        segment,
        path: child.path,
        children: convert(child),
      });
    }
    for (const value of folder.leaves) {
      const segments = getName(value)
        .split("/")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      nodes.push({
        kind: "leaf",
        segment: segments[segments.length - 1] ?? getName(value),
        value,
      });
    }
    nodes.sort(compare);
    return nodes;
  };

  return convert(root);
}

function TreeGroupRow({
  segment,
  path,
  depth,
  collapsed,
  onToggle,
}: {
  segment: string;
  /** Full path from the root — shown as the hover tooltip. */
  path: string;
  depth: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="vf-tree-group-row"
      aria-expanded={!collapsed}
      onClick={onToggle}
      aria-label={path}
      style={{ paddingLeft: 20 + depth * 14 }}
    >
      <span
        className={`vf-section-chevron${collapsed ? "" : " is-open"}`}
        aria-hidden
      >
        ›
      </span>
      {segment}
    </button>
  );
}

/**
 * Renders `nodes` as an indented, collapsible forest. `TreeList` owns only the
 * folder recursion and per-folder collapse state (keyed
 * `${groupKeyPrefix}:${node.path}` so each entity type has its own namespace in
 * `useSidebarChrome().collapsed`); the caller's `renderLeaf` supplies the row
 * for the leaf case, receiving the leaf value, its leaf segment, and its depth.
 */
function TreeList<T>({
  nodes,
  depth,
  groupKeyPrefix,
  renderLeaf,
}: {
  nodes: TreeNode<T>[];
  depth: number;
  groupKeyPrefix: string;
  renderLeaf: (value: T, segment: string, depth: number) => ReactNode;
}) {
  const { collapsed: collapsedMap, toggleSection } = useSidebarChrome();

  return (
    <>
      {nodes.map((node, i) => {
        if (node.kind === "leaf") {
          return (
            <Fragment key={`leaf:${i}:${node.segment}`}>
              {renderLeaf(node.value, node.segment, depth)}
            </Fragment>
          );
        }

        const groupId = `${groupKeyPrefix}:${node.path}`;
        const isCollapsed = collapsedMap[groupId] === true;
        return (
          <div className="vf-tree-group" key={`folder:${node.path}`}>
            <TreeGroupRow
              segment={node.segment}
              path={node.path}
              depth={depth}
              collapsed={isCollapsed}
              onToggle={() => toggleSection(groupId)}
            />
            {!isCollapsed && (
              <TreeList
                nodes={node.children}
                depth={depth + 1}
                groupKeyPrefix={groupKeyPrefix}
                renderLeaf={renderLeaf}
              />
            )}
          </div>
        );
      })}
    </>
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
  const [exportingLabelId, setExportingLabelId] = useState<string | null>(
    null,
  );
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
        <TreeList
          nodes={buildTree(ordered, (l) => l.name)}
          depth={0}
          groupKeyPrefix="label-group"
          renderLeaf={(label, segment, depth) => (
            <NavRow
              key={`label:${label.id}`}
              label={label.name}
              displayLabel={segment}
              indent={depth}
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
                  <div className="vf-menu-divider" aria-hidden />
                  <button
                    className="vf-menu-item"
                    onClick={() => {
                      setMenuId(null);
                      setExportingLabelId(label.id);
                    }}
                  >
                    Export Tasks…
                  </button>
                  <div className="vf-menu-divider" aria-hidden />
                  <button
                    className="vf-menu-item vf-menu-item-danger"
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
          )}
        />
      )}

      {creating && (
        <LabelDialog
          title="New label"
          initialName="New label"
          descriptionSourcePath={`${snapshot.workspace.root}/Untitled`}
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
          descriptionSourcePath={`${snapshot.workspace.root}/Untitled`}
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

      {exportingLabelId && (
        <ExportDialog
          snapshot={snapshot}
          lockScope
          initialScope={{
            kind: "view",
            view: labelView(snapshot, exportingLabelId),
          }}
          onClose={() => setExportingLabelId(null)}
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
  const mePersonId = useMePersonId(snapshot.workspace.root);

  const [menuId, setMenuId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [exportingPersonId, setExportingPersonId] = useState<string | null>(
    null,
  );
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
      action={
        <AddButton title="New person" onClick={() => setCreating(true)} />
      }
      onOpenHub={() => openScreen("people")}
    >
      <MeIdentityBanner
        workspace={snapshot.workspace}
        onOpenSettings={() => openScreen("settings", "vf-settings-people")}
      />
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
            hint={mePersonId === person.id ? "You" : undefined}
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
                <div className="vf-menu-divider" aria-hidden />
                <button
                  className="vf-menu-item"
                  onClick={() => {
                    setMenuId(null);
                    setExportingPersonId(person.id);
                  }}
                >
                  Export Tasks…
                </button>
                <div className="vf-menu-divider" aria-hidden />
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
            plugin.mutations
              .createPerson(snapshot, name, aliases)
              .then(() => {})
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

      {exportingPersonId && (
        <ExportDialog
          snapshot={snapshot}
          lockScope
          initialScope={{
            kind: "view",
            view: personView(snapshot, exportingPersonId),
          }}
          onClose={() => setExportingPersonId(null)}
        />
      )}
    </Section>
  );
}
