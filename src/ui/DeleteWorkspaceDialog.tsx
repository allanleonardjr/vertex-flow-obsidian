/**
 * The confirmation for deleting an entire workspace.
 *
 * The non-destructive soft step, parallel to `DeleteEntityDialog`'s "Move to
 * Trash" phase: `_workspace.md` is stamped with `deletedAt`, the workspace
 * drops out of the switcher, and its folder stays on disk untouched (it can't
 * be trashed — its own `Trash/` folder lives inside it). It's fully
 * reversible from the Trash view or the empty-state recovery screen.
 *
 * The genuinely irreversible step is `Mutations.permanentlyDeleteWorkspace`,
 * triggered from the Trash view or the empty-state recovery screen — never
 * from here.
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { danglingRelationEditsForWorkspaceDeletion } from "../core/hierarchy";
import type { WorkspaceSnapshot } from "../core/types";
import { usePlugin, useWorkspaces } from "./context";

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function DeleteWorkspaceDialog({
  snapshot,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  onClose: () => void;
}) {
  const plugin = usePlugin();
  const workspaces = useWorkspaces();
  const [busy, setBusy] = useState(false);

  const name = snapshot.workspace.name;
  const root = snapshot.workspace.root;

  // Links in *other* workspaces that point into this one — those get rewritten
  // silently on delete, so the user should know before confirming.
  const crossLinks = useMemo(
    () => danglingRelationEditsForWorkspaceDeletion(workspaces, root),
    [workspaces, root],
  );

  const canDelete = !busy;

  const remove = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      await plugin.mutations.deleteWorkspace(snapshot);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="vf-editor-backdrop" onClick={onClose}>
      <div
        className="vf-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Move workspace "{name}" to Trash?</h3>

        <p className="vf-dialog-lead">
          This hides "{name}" from your sidebar and workspace switcher. Nothing
          on disk changes — you can restore it anytime from the Trash view.
        </p>

        {crossLinks.length > 0 && (
          <p className="vf-dialog-lead">
            {count(crossLinks.length, "task")} in other workspaces link into
            this one (blocks, blocked by, related, or duplicate). Those links
            will be cleaned up automatically.
          </p>
        )}

        <div className="vf-dialog-actions">
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="mod-cta"
            disabled={busy}
            autoFocus
            onClick={() => void remove()}
          >
            Move to Trash
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
