/**
 * Recurring Overview — every live recurrence in the workspace in one list.
 *
 * Opened by the "Recurring overview" command and the `g r` chord.
 * and the `g r` chord. Read-only over `recurringOverview()`; each row can jump
 * to its source task or stop the whole series (with a confirm).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { localTodayIso } from "../core/date";
import { describeRecurrence, recurringOverview } from "../core/recurrence";
import type { WorkspaceSnapshot } from "../core/types";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { StatusDot } from "./components/TaskBits";
import { displayTitle } from "./components/TaskTitle";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";

export function RecurringOverviewModal({
  snapshot,
  taxonomies,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onClose: () => void;
}) {
  const plugin = usePlugin();
  const tabs = useTabs();
  const [stopPath, setStopPath] = useState<string | null>(null);

  const rows = recurringOverview(snapshot, localTodayIso());
  const stopping = rows.find((row) => row.task.path === stopPath);

  return createPortal(
    <div className="vf-editor-backdrop" onClick={onClose}>
      <div
        className="vf-dialog vf-recurring-overview"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Recurring tasks</h3>

        {rows.length === 0 ? (
          <p className="vf-dialog-lead">
            Nothing in this workspace repeats yet. Open a task and set its
            Repeat field to start a series.
          </p>
        ) : (
          <ul className="vf-recurring-list">
            {rows.map((row) => {
              const total = row.recurrence.endsAfter;
              return (
                <li key={row.task.path} className="vf-recurring-item">
                  <div className="vf-recurring-main">
                    <span className="vf-recurring-title">
                      <StatusDot
                        taxonomies={taxonomies}
                        status={row.task.status}
                      />
                      {displayTitle(row.task)}
                    </span>
                    <span className="vf-dialog-hint">
                      {describeRecurrence(
                        row.recurrence,
                        snapshot.workspace.statuses,
                      )}
                    </span>
                    <span className="vf-dialog-hint">
                      {total
                        ? `${row.chainLength} of ${total}`
                        : `${row.chainLength} so far`}
                      {row.nextDate ? ` · next ${row.nextDate}` : ""}
                    </span>
                  </div>
                  <div className="vf-recurring-actions">
                    <button
                      type="button"
                      className="vf-linkish"
                      onClick={() => {
                        tabs.openTask(row.task.path);
                        onClose();
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="vf-linkish vf-linkish-warn"
                      onClick={() => setStopPath(row.task.path)}
                    >
                      Stop
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="vf-dialog-actions">
          <span className="vf-editor-spacer" />
          <button type="button" className="mod-cta" onClick={onClose}>
            Done
          </button>
        </div>
      </div>

      {stopping && (
        <ConfirmDeleteDialog
          title={`Stop “${displayTitle(stopping.task)}” repeating?`}
          body="Occurrences already spawned stay; no new ones are created."
          confirmLabel="Stop repeating"
          destructive={false}
          onCancel={() => setStopPath(null)}
          onConfirm={() => {
            void plugin.mutations.stopRecurrence(stopping.task);
            setStopPath(null);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/**
 * Mounted once inside the workspace shell. Watches the one-shot
 * Opened by the "Recurring overview" command and the `g r` chord.
 * modal when it flips.
 */
export function RecurringOverviewHost({
  snapshot,
  taxonomies,
}: {
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
}) {
  const plugin = usePlugin();
  const [open, setOpen] = useState(false);


  if (!open) return null;
  return (
    <RecurringOverviewModal
      snapshot={snapshot}
      taxonomies={taxonomies}
      onClose={() => setOpen(false)}
    />
  );
}
