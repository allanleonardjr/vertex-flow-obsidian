/**
 * Onboarding — and its mirror image, recovery.
 *
 * `App.tsx` renders `<EmptyState />` whenever no *live* workspace resolves.
 * Two cases hide behind that:
 *
 *   - **True first run** (no workspaces at all, live or deleted) → the template
 *     gallery, via the `Welcome` card. No "blank" shortcut, no wizard.
 *   - **Everything's in Trash** (you deleted your only workspace) → a recovery
 *     screen listing the soft-deleted workspaces, each restorable in place.
 *     Restoring one rebuilds the index; `useActiveWorkspace()` then resolves
 *     non-null and `App.tsx` stops rendering this on its own — no extra wiring.
 *
 * Both screens are the same centered `.vf-empty-panel` card (accent icon box,
 * centered copy, one primary affordance) — `EmptyPanel` / `EmptyStateIcon`
 * keep them from drifting.
 */

import { useState, type ReactNode } from "react";
import type { WorkspaceSnapshot } from "../core/types";
import { Icon } from "./components/Icon";
// import { HelpView } from "./help/HelpView";
import { RoughNotation } from "react-rough-notation";
import { TemplateGallery } from "./TemplateGallery";
import { useWorkspaces, usePlugin } from "./context";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { pluralize, formatRelativeTime } from "./browse/shared";

export function EmptyState() {
  const [showGallery, setShowGallery] = useState(false);
  const deletedWorkspaces = useWorkspaces({ includeDeleted: true })
    .filter((w) => w.workspace.deletedAt != null)
    .sort((a, b) =>
      (b.workspace.deletedAt ?? "").localeCompare(a.workspace.deletedAt ?? ""),
    );

  if (showGallery) {
    return (
      <div className="vf-empty-scroll">
        <TemplateGallery onClose={() => setShowGallery(false)} />
      </div>
    );
  }

  return (
    <div className="vf-empty-scroll">
      <div className="vf-app-background">
        {deletedWorkspaces.length > 0 ? (
          <RecoverWorkspaces
            deletedWorkspaces={deletedWorkspaces}
            onCreateNew={() => setShowGallery(true)}
          />
        ) : (
          <Welcome onClose={() => setShowGallery(true)} />
        )}
      </div>
      {/* <HelpView /> */}
    </div>
  );
}

/** The centered card shared by the first-run and recovery screens. */
function EmptyPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`vf-empty-panel${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

/**
 * The accent icon box. Box dimensions derive from the glyph size — same math
 * the inline `Welcome` style used before: padding = size/10, radius = box*0.23.
 */
function EmptyStateIcon({
  id,
  fallback,
  size = 70,
}: {
  id: string;
  fallback?: string;
  size?: number;
}) {
  const box = size + (size / 10) * 2;
  return (
    <div
      className="vf-empty-panel-icon"
      style={{ width: box, height: box, borderRadius: box * 0.23 }}
    >
      <Icon id={id} fallback={fallback} size={size} />
    </div>
  );
}

function RecoverWorkspaces({
  deletedWorkspaces,
  onCreateNew,
}: {
  deletedWorkspaces: WorkspaceSnapshot[];
  onCreateNew: () => void;
}) {
  const plural = deletedWorkspaces.length !== 1;

  return (
    <EmptyPanel className="vf-recover">
      <EmptyStateIcon id="archive-restore" fallback="history" />
      <h1>
        {plural ? "Your workspaces are in Trash" : "Your workspace is in Trash"}
      </h1>
      <p className="vf-empty-panel-sub">
        Restore one to pick up where you left off, or start fresh.
      </p>
      <div className="vf-recover-list">
        {deletedWorkspaces.map((ws) => (
          <RecoverableWorkspace key={ws.workspace.root} snapshot={ws} />
        ))}
      </div>
      <button type="button" className="vf-link-button" onClick={onCreateNew}>
        Create a new workspace instead →
      </button>
    </EmptyPanel>
  );
}

/**
 * One soft-deleted workspace on the recovery screen. Deliberately its own
 * stacked card rather than the dense `DeletedWorkspaceRow` the Trash hub uses —
 * this is a focused, one-to-few-item recovery moment that wants a real card and
 * a prominent Restore, not a sliver in a scrollable list.
 */
function RecoverableWorkspace({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const [confirming, setConfirming] = useState(false);
  const { workspace } = snapshot;

  return (
    <div className="vf-recover-card">
      <div className="vf-recover-card-head">
        <Icon id={workspace.icon} fallback="layers" size={16} />
        <span className="vf-recover-card-name">{workspace.name}</span>
      </div>
      <div className="vf-recover-card-meta">
        <span>{pluralize(snapshot.tasks.length, "task")}</span>
        <span>{pluralize(snapshot.projects.length, "project")}</span>
        <span>Trashed {formatRelativeTime(workspace.deletedAt ?? "")}</span>
      </div>
      <div className="vf-recover-card-actions">
        <button
          type="button"
          className="mod-cta"
          onClick={() => void plugin.mutations.restoreWorkspace(snapshot)}
        >
          <Icon id="archive-restore" size={14} /> Restore
        </button>
        <button
          type="button"
          className="vf-recover-card-delete"
          onClick={() => setConfirming(true)}
        >
          Delete forever
        </button>
      </div>

      {confirming && (
        <ConfirmDeleteDialog
          title={`Delete workspace "${workspace.name}" forever?`}
          body="This can't be undone."
          confirmLabel="Delete Forever"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            void plugin.mutations.permanentlyDeleteWorkspace(snapshot);
            setConfirming(false);
          }}
        />
      )}
    </div>
  );
}

function Welcome({ onClose }: { onClose: () => void }) {
  return (
    <EmptyPanel>
      <EmptyStateIcon id="kanban-square" fallback="layers" />
      <h1>Welcome to Vertex Flow</h1>
      <p className="vf-empty-panel-sub">
        Task management for your Obsidian vault. <br />
        Projects and Tasks, List and Board views, all stored as <br />
        <RoughNotation
          type="underline"
          multiline={true}
          color="#ff0000"
          animationDelay={300}
          show={true}
        >
          <span style={{ fontWeight: "bold" }}>plain Markdown notes.</span>
        </RoughNotation>
      </p>
      <button
        type="button"
        className="vf-empty-panel-cta mod-cta"
        onClick={onClose}
      >
        Create your first workspace
      </button>
    </EmptyPanel>
  );
}
