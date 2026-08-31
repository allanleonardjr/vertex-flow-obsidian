/**
 * The confirmation for deleting a Task or Project.
 *
 * A genuine modal — the delete you just clicked can't proceed without one more
 * decision, and cancelling should leave you exactly where you were.
 *
 * Two rules shape this:
 *
 *   1. **Always ask "are you sure?" first** (the `confirm` phase). Only after
 *      that yes does the "what about the children?" question appear — the app's
 *      consistent order everywhere: confirm the delete, *then* decide what
 *      happens to what it leaves behind.
 *   2. **One level of nesting at a time.** Cascading into a child that itself
 *      has children never happens silently — `applyDeletionPlan` hands those
 *      back as follow-up plans, and this dialog re-presents each one (starting
 *      again from its own `confirm` phase) before moving on.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  describePlanChildren,
  type DeletionChoice,
  type DeletionPlan,
} from "../core/hierarchy";
import type { WorkspaceSnapshot } from "../core/types";
import { usePlugin } from "./context";

const NOUN: Record<DeletionPlan["kind"], string> = {
  task: "task",
  project: "project",
};

type Phase = "confirm" | "resolve";

export function DeleteEntityDialog({
  snapshot,
  plan,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  plan: DeletionPlan;
  onClose: () => void;
}) {
  const plugin = usePlugin();
  const [current, setCurrent] = useState<DeletionPlan>(plan);
  const [pending, setPending] = useState<DeletionPlan[]>([]);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);

  const noun = NOUN[current.kind];
  const childNoun = current.kind === "task" ? "sub-task" : "task";

  /** Move on to the next queued follow-up, or close when the queue is empty. */
  const advance = (followUps: DeletionPlan[]) => {
    const next = [...followUps, ...pending];
    if (next.length === 0) {
      onClose();
      return;
    }
    setCurrent(next[0]);
    setPending(next.slice(1));
    setPhase("confirm");
  };

  const apply = async (choice: Exclude<DeletionChoice, "cancel">) => {
    if (busy) return;
    setBusy(true);
    try {
      const followUps = await plugin.mutations.applyDeletionPlan(
        snapshot,
        current,
        choice,
      );
      setStarted(true);
      advance(followUps);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busy) return;
    // Cancelling the very first prompt aborts entirely. Cancelling a follow-up
    // only skips that subtree — the parent it descended from is already gone.
    if (started) advance([]);
    else onClose();
  };

  const confirmDelete = () => {
    // No children → the confirm *is* the whole decision, delete straight away.
    if (!current.hasChildren) {
      void apply("cascade");
      return;
    }
    setPhase("resolve");
  };

  return createPortal(
    <div className="vf-editor-backdrop" onClick={cancel}>
      <div
        className="vf-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {phase === "confirm" ? (
          <>
            <h3>
              Move {noun} "{current.title}" to Trash?
            </h3>
            <p className="vf-dialog-lead">
              {current.hasChildren
                ? `It has ${describePlanChildren(current)} — you'll choose what happens to ${current.kind === "task" ? "them" : "those"} next.`
                : "You can restore it at any time from the Trash view."}
            </p>
            <div className="vf-dialog-actions">
              <button disabled={busy} onClick={cancel}>
                Cancel
              </button>
              <button
                className="mod-cta"
                disabled={busy}
                autoFocus
                onClick={confirmDelete}
              >
                Move to Trash
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>
              The {childNoun}s of "{current.title}"
            </h3>
            <p className="vf-dialog-lead">
              Move the {describePlanChildren(current)} to Trash too, or keep{" "}
              {current.kind === "task" ? "them" : "those"} as top-level items?
            </p>
            <div className="vf-dialog-actions">
              <button disabled={busy} onClick={cancel}>
                Cancel
              </button>
              <button disabled={busy} onClick={() => void apply("unparent")}>
                Keep {childNoun}s
              </button>
              <button
                className="mod-cta"
                disabled={busy}
                onClick={() => void apply("cascade")}
              >
                Move {childNoun}s to Trash
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
