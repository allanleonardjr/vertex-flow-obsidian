/**
 * Trash hub — everything sitting in this workspace's `Trash/` folder, grouped
 * by Item Kind. Each row has an always-visible Restore button; the `⋯` menu
 * holds only the permanent "Delete Forever".
 *
 * Reuses the exact card-content components the other hubs use
 * (`TaskRowContent` / `ProjectCardContent` / `ViewCardContent` /
 * `DashboardCardContent`) — none of them is trash-aware. The "Trashed …" line
 * is a sibling element this view adds, not a prop threaded into them.
 */

import { useState } from "react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type {
  DashboardConfig,
  EntityKind,
  Project,
  SavedView,
  Task,
  TrashedItem,
  WorkspaceSnapshot,
} from "../../core/types";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { TaskRowContent } from "../components/TaskRow";
import { usePlugin, useWorkspaces } from "../context";
import { DashboardCardContent } from "./DashboardCardContent";
import { ProjectCardContent } from "./ProjectCardContent";
import { ViewCardContent } from "./ViewCardContent";
import {
  BrowseCard,
  BrowseCardMenu,
  BrowseEmpty,
  BrowseGroupHeader,
  BrowseHeader,
  BrowseList,
  DeletedWorkspaceRow,
  formatRelativeTime,
} from "./shared";

const KIND_LABEL: Record<EntityKind, string> = {
  task: "Tasks",
  project: "Projects",
  view: "Views",
  dashboard: "Dashboards",
};

/** Kinds render in this order; empty ones are skipped entirely. */
const KIND_ORDER: EntityKind[] = ["task", "project", "view", "dashboard"];

export function TrashBrowseView({
  snapshot,
  taxonomies,
}: {
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
}) {
  const plugin = usePlugin();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashedItem | null>(null);
  const [purgingWorkspace, setPurgingWorkspace] =
    useState<WorkspaceSnapshot | null>(null);

  // Soft-deleted workspaces are vault-wide, not part of this workspace's own
  // `snapshot.trash` — a separate data source shown as its own group.
  const deletedWorkspaces = useWorkspaces({ includeDeleted: true }).filter(
    (w) => w.workspace.deletedAt != null,
  );

  const total = snapshot.trash.length + deletedWorkspaces.length;

  const restore = (item: TrashedItem) => {
    setMenuPath(null);
    void plugin.mutations.restoreItem(snapshot, item);
  };

  const renderBody = (item: TrashedItem) => {
    switch (item.kind) {
      case "task":
        return (
          <div className="vf-trash-task-row">
            <TaskRowContent
              task={item.entity as Task}
              snapshot={snapshot}
              taxonomies={taxonomies}
            />
          </div>
        );
      case "project":
        return (
          <ProjectCardContent
            snapshot={snapshot}
            taxonomies={taxonomies}
            project={item.entity as Project}
          />
        );
      case "view":
        return <ViewCardContent view={item.entity as SavedView} />;
      case "dashboard":
        return (
          <DashboardCardContent dashboard={item.entity as DashboardConfig} />
        );
      default:
        return null;
    }
  };

  return (
    <div className="vf-browse">
      <BrowseHeader title="Trash" noun="item" count={total} />

      {total === 0 ? (
        <BrowseEmpty label="trashed items" />
      ) : (
        <BrowseList>
          {deletedWorkspaces.length > 0 && (
            <div className="vf-trash-group">
              <BrowseGroupHeader
                label="Workspaces"
                count={deletedWorkspaces.length}
              />
              {deletedWorkspaces.map((ws) => (
                <DeletedWorkspaceRow
                  key={ws.workspace.root}
                  snapshot={ws}
                  onPurge={() => setPurgingWorkspace(ws)}
                />
              ))}
            </div>
          )}
          {KIND_ORDER.map((kind) => {
            const items = snapshot.trash.filter((t) => t.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} className="vf-trash-group">
                <BrowseGroupHeader
                  label={KIND_LABEL[kind]}
                  count={items.length}
                />
                {items.map((item) => (
                  <BrowseCard
                    key={item.entity.path}
                    trailing={
                      <>
                        <button
                          className="vf-browse-card-restore"
                          onClick={() => restore(item)}
                        >
                          Restore
                        </button>
                        <BrowseCardMenu
                          open={menuPath === item.entity.path}
                          onToggle={() =>
                            setMenuPath((p) =>
                              p === item.entity.path ? null : item.entity.path,
                            )
                          }
                          onClose={() => setMenuPath(null)}
                        >
                          <button
                            className="vf-menu-item vf-menu-item-danger"
                            onClick={() => {
                              setMenuPath(null);
                              setPurging(item);
                            }}
                          >
                            Delete Forever
                          </button>
                        </BrowseCardMenu>
                      </>
                    }
                  >
                    {renderBody(item)}
                    <span className="vf-trashed-meta">
                      Trashed {formatRelativeTime(item.trashedAt)}
                    </span>
                  </BrowseCard>
                ))}
              </div>
            );
          })}
        </BrowseList>
      )}

      {purging && (
        <ConfirmDeleteDialog
          title={`Delete "${trashedTitle(purging)}" forever?`}
          body="This can't be undone."
          confirmLabel="Delete Forever"
          onCancel={() => setPurging(null)}
          onConfirm={() => {
            void plugin.mutations.permanentlyDeleteItem(purging);
            setPurging(null);
          }}
        />
      )}

      {purgingWorkspace && (
        <PurgeWorkspaceDialog
          snapshot={purgingWorkspace}
          onClose={() => setPurgingWorkspace(null)}
        />
      )}
    </div>
  );
}

function trashedTitle(item: TrashedItem): string {
  const entity = item.entity;
  if ("title" in entity && entity.title) return entity.title;
  if ("name" in entity && entity.name) return entity.name;
  return "this item";
}

function PurgeWorkspaceDialog({
  snapshot,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  onClose: () => void;
}) {
  const plugin = usePlugin();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const name = snapshot.workspace.name;
  const canDelete = typed.trim() === name && !busy;

  const handlePurge = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      await plugin.mutations.permanentlyDeleteWorkspace(snapshot);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vf-editor-backdrop" onClick={onClose}>
      <div
        className="vf-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Permanently delete workspace "{name}"?</h3>

        <p className="vf-dialog-lead">
          This action cannot be undone. This will permanently delete the
          workspace folder and all files inside it from disk.
        </p>

        <label className="vf-field">
          <span>
            Type <strong>"{name}"</strong> to confirm permanent deletion
          </span>
          <input
            className="vf-input"
            type="text"
            value={typed}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canDelete) void handlePurge();
            }}
          />
        </label>

        <div className="vf-dialog-actions">
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="mod-cta mod-warning"
            disabled={!canDelete}
            onClick={() => void handlePurge()}
          >
            Delete Workspace Forever
          </button>
        </div>
      </div>
    </div>
  );
}
