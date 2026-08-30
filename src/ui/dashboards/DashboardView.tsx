/**
 * A dashboard: a global filter bar over a grid of configurable charts
 * (§Dashboards Phase 1).
 *
 * One unified data fetch: the dashboard-wide `ViewFilters` are applied once,
 * through the shared `applyFilters` engine, and every widget aggregates over
 * the resulting task list (`computeWidgetData`). Charts are pure and receive
 * pre-filtered data as props. Live refresh rides the same fresh-`snapshot`-prop
 * mechanism the List/Board views use — the index rebuild re-renders `App`,
 * which passes a new snapshot down here.
 *
 * Editing the filter bar or moving/resizing/adding/removing widgets produces an
 * in-memory draft (`useDashboardDraft`); Save / Save As write it to
 * `_dashboards`.
 */

import { useEffect, useMemo, useState } from "react";
import type { ViewContext } from "../../core/views";
import { applyFilters, fallbackView } from "../../core/views";
import {
  computeWidgetData,
  newDashboardId,
  reconfigureWidget,
  widgetFromConfig,
  duplicateWidget as cloneWidget,
} from "../../core/dashboards";
import type {
  DashboardConfig,
  DashboardWidget,
  SavedView,
  WorkspaceSnapshot,
} from "../../core/types";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";
import {
  AddFilterTrigger,
  FilterControls,
  useFilterClauseState,
} from "../views/FilterControls";
import { Icon } from "../components/Icon";
import { EmptyView } from "../components/EmptyView";
import { EditableTitle } from "../components/EditableTitle";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { useUnsavedGuard } from "../components/useUnsavedGuard";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { AddWidgetTile } from "./AddWidgetTile";
import { DashboardGrid } from "./DashboardGrid";
import { useDashboardDraft } from "./useDashboardDraft";
import {
  WidgetConfigDialog,
  type WidgetConfigResult,
} from "./WidgetConfigDialog";
import { WidgetFrame } from "./WidgetFrame";

type DialogState =
  | { mode: "add" }
  | { mode: "edit"; widget: DashboardWidget }
  | { mode: "delete"; widget: DashboardWidget }
  | { mode: "save-as" }
  | null;

export function DashboardView({
  dashboardId,
  snapshot,
  context,
}: {
  dashboardId: string;
  snapshot: WorkspaceSnapshot;
  context: ViewContext;
}) {
  const plugin = usePlugin();
  const tabs = useTabs();
  const dashboard =
    snapshot.dashboards.find((d) => d.id === dashboardId) ?? null;

  // A one-frame skeleton: RGL's WidthProvider needs a mount tick to measure,
  // and the grid should appear fully populated rather than reflow into place.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  if (!dashboard) {
    // Absent from the active snapshot but still alive in another workspace: this
    // tab briefly outlived a workspace switch before `syncToWorkspace` /
    // `activate` re-homes it. Render nothing for that (unpainted) frame rather
    // than flashing the "no longer exists" state.
    if (plugin.index.hasDashboard(dashboardId)) return null;
    return (
      <EmptyView
        iconFallback="layout-dashboard"
        title="This dashboard no longer exists."
        note="It may have been deleted or renamed."
      />
    );
  }

  return (
    <DashboardBody
      key={dashboard.id}
      dashboard={dashboard}
      snapshot={snapshot}
      context={context}
      ready={ready}
      plugin={plugin}
      openDashboard={tabs.openDashboard}
    />
  );
}

function DashboardBody({
  dashboard,
  snapshot,
  context,
  ready,
  plugin,
  openDashboard,
}: {
  dashboard: DashboardConfig;
  snapshot: WorkspaceSnapshot;
  context: ViewContext;
  ready: boolean;
  plugin: ReturnType<typeof usePlugin>;
  openDashboard: (id: string) => void;
}) {
  const draft = useDashboardDraft(snapshot, dashboard, newDashboardId);
  const effective = draft.effective;
  const [dialog, setDialog] = useState<DialogState>(null);
  const filterClause = useFilterClauseState();

  const canOverwrite = snapshot.dashboards.some((d) => d.id === dashboard.id);

  // Switching tabs unmounts this component and drops the draft — guard it.
  const leaveGuard = useUnsavedGuard({
    dirty: draft.dirty,
    canSave: canOverwrite,
    what: "dashboard",
    name: dashboard.name,
    guardKey: dashboard.id,
    save: () => draft.save(),
    reset: draft.reset,
  });

  // The one unified fetch: dashboard-wide filter, applied once.
  const tasks = useMemo(
    () => applyFilters(snapshot.tasks, effective.filters, context),
    [snapshot.tasks, effective.filters, context],
  );

  const dataByWidget = useMemo(() => {
    const map = new Map(
      effective.widgets.map((widget) => [
        widget.id,
        computeWidgetData(widget, tasks, context),
      ]),
    );
    return map;
  }, [effective.widgets, tasks, context]);

  // --- Widget CRUD, all through the draft ---------------------------------

  const setWidgets = (widgets: DashboardWidget[]) =>
    draft.edit({ ...effective, widgets });

  const addWidget = (result: WidgetConfigResult) =>
    setWidgets([
      ...effective.widgets,
      widgetFromConfig(
        result.chartType,
        result.fieldMapping,
        effective.widgets,
        context,
      ),
    ]);

  const reconfigure = (widget: DashboardWidget, result: WidgetConfigResult) =>
    setWidgets(
      effective.widgets.map((w) =>
        w.id === widget.id
          ? reconfigureWidget(w, result.chartType, result.fieldMapping, context)
          : w,
      ),
    );

  const renameWidget = (widget: DashboardWidget, title: string) =>
    setWidgets(
      effective.widgets.map((w) =>
        w.id === widget.id ? { ...w, title, titleIsCustom: true } : w,
      ),
    );

  const duplicate = (widget: DashboardWidget) =>
    setWidgets([...effective.widgets, cloneWidget(widget, effective.widgets)]);

  const remove = (widget: DashboardWidget) =>
    setWidgets(effective.widgets.filter((w) => w.id !== widget.id));

  // --- Filter bar: reuse FilterControls via a synthetic SavedView ---------

  const filterProxy: SavedView = {
    ...fallbackView(),
    filters: effective.filters,
  };
  const onFilterChange = (next: SavedView) =>
    draft.edit({ ...effective, filters: next.filters });

  return (
    <>
      {leaveGuard}
      <header className="vf-view-header vf-dash-header">
        <div className="vf-view-title">
          {canOverwrite ? (
            <EditableTitle
              key={dashboard.id}
              icon={dashboard.icon}
              iconFallback="layout-dashboard"
              name={dashboard.name}
              suffix={`(${snapshot.workspace.idPrefix})`}
              placeholder="Dashboard name"
              onRename={(name) =>
                plugin.mutations.updateDashboard(snapshot, {
                  ...dashboard,
                  name,
                })
              }
              onIconChange={(icon) =>
                void plugin.mutations.updateDashboard(snapshot, {
                  ...dashboard,
                  icon,
                })
              }
            />
          ) : (
            <h2>
              <span className="vf-view-title-icon" aria-hidden>
                <Icon
                  id={dashboard.icon}
                  fallback="layout-dashboard"
                  size={16}
                />
              </span>
              {dashboard.name}
              <span className="vf-view-title-code">
                ({snapshot.workspace.idPrefix})
              </span>
            </h2>
          )}
          <span className="vf-count">
            {effective.widgets.length}{" "}
            {effective.widgets.length === 1 ? "chart" : "charts"}
          </span>

          <span className="vf-view-title-spacer" />

          {draft.dirty && (
            <>
              <button
                type="button"
                className="vf-bar-item vf-bar-reset"
                title="Discard unsaved changes"
                onClick={draft.reset}
              >
                Reset
              </button>
              {canOverwrite && (
                <button
                  type="button"
                  className="vf-bar-item vf-bar-save"
                  title={`Save changes to "${dashboard.name}"`}
                  onClick={() => void draft.save()}
                >
                  Save
                </button>
              )}
            </>
          )}

          {/* Always available — duplicating a clean, saved dashboard as a
					    starting point is a legitimate move, not just a way to
					    rescue unsaved edits. */}
          <button
            type="button"
            className="vf-bar-item vf-bar-save"
            onClick={() => setDialog({ mode: "save-as" })}
          >
            Save dashboard as…
          </button>

          <button
            className="mod-cta"
            onClick={() => setDialog({ mode: "add" })}
          >
            New chart
          </button>
        </div>

        <div className="vf-view-bar">
          <AddFilterTrigger view={filterProxy} clause={filterClause} />
          <FilterControls
            snapshot={snapshot}
            view={filterProxy}
            taxonomies={context.taxonomies}
            onChange={onFilterChange}
            clause={filterClause}
          />
        </div>
      </header>

      <div className="vf-dash-scroll">
        {!ready ? (
          <DashboardSkeleton />
        ) : effective.widgets.length === 0 ? (
          <div className="vf-dash-empty">
            <AddWidgetTile onClick={() => setDialog({ mode: "add" })} />
          </div>
        ) : (
          <DashboardGrid
            widgets={effective.widgets}
            onLayoutChange={setWidgets}
            renderWidget={(widget) => (
              <WidgetFrame
                widget={widget}
                data={
                  dataByWidget.get(widget.id) ?? {
                    kind: "categorical",
                    data: [],
                    empty: true,
                  }
                }
                onRename={(title) => renameWidget(widget, title)}
                onEditConfig={() => setDialog({ mode: "edit", widget })}
                onDuplicate={() => duplicate(widget)}
                onDelete={() => setDialog({ mode: "delete", widget })}
              />
            )}
          />
        )}
      </div>

      {(dialog?.mode === "add" || dialog?.mode === "edit") && (
        <WidgetConfigDialog
          snapshot={snapshot}
          context={context}
          initial={
            dialog.mode === "edit"
              ? {
                  chartType: dialog.widget.chartType,
                  fieldMapping: dialog.widget.fieldMapping,
                }
              : undefined
          }
          confirmLabel={dialog.mode === "edit" ? "Save chart" : "Add chart"}
          onConfirm={(result) =>
            dialog.mode === "edit"
              ? reconfigure(dialog.widget, result)
              : addWidget(result)
          }
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.mode === "delete" && (
        <ConfirmDeleteDialog
          title={`Delete chart "${dialog.widget.title}"?`}
          body="It's removed from this dashboard and the layout closes the gap."
          confirmLabel="Delete chart"
          onConfirm={() => {
            remove(dialog.widget);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.mode === "save-as" && (
        <NamedIconDialog
          title="Save dashboard as"
          initialName={`${dashboard.name} copy`}
          initialIcon={dashboard.icon}
          iconFallback="layout-dashboard"
          confirmLabel="Create dashboard"
          onConfirm={(name, icon) => {
            void draft.saveAs(name, icon).then((id) => openDashboard(id));
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="vf-dash-skeleton" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="vf-dash-skeleton-tile" />
      ))}
    </div>
  );
}
