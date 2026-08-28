/**
 * The confirmation for deleting a Task or Project (§7.8).
 *
 * A genuine modal — the delete you just clicked can't proceed without one more
 * decision, and cancelling should leave you exactly where you were.
 *
 * The one rule that shapes this: **one level of nesting at a time.** Cascading
 * into a child that itself has children never happens silently — `applyDeletionPlan`
 * hands those back as follow-up plans, and this dialog re-presents each one as
 * its own question before moving on.
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
	};

	const choose = async (choice: DeletionChoice) => {
		if (busy) return;

		if (choice === "cancel") {
			// Cancelling the very first prompt aborts entirely. Cancelling a
			// follow-up only skips that subtree — the parent it descended from is
			// already gone.
			if (started) advance([]);
			else onClose();
			return;
		}

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

	return createPortal(
		<div className="vf-editor-backdrop" onClick={() => choose("cancel")}>
			<div
				className="vf-dialog"
				role="dialog"
				aria-modal="true"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>
					Delete {noun} "{current.title}"?
				</h3>

				{current.hasChildren ? (
					<p className="vf-dialog-lead">
						It has {describePlanChildren(current)}. Delete those too, or keep
						them and just remove their link to this {noun}?
					</p>
				) : (
					<p className="vf-dialog-lead">This can't be undone.</p>
				)}

				<div className="vf-dialog-actions">
					<button disabled={busy} onClick={() => choose("cancel")}>
						Cancel
					</button>
					{current.hasChildren && (
						<button disabled={busy} onClick={() => choose("unparent")}>
							Keep {childNoun}s
						</button>
					)}
					<button
						className="mod-cta mod-warning"
						disabled={busy}
						onClick={() => choose("cascade")}
					>
						{current.hasChildren ? `Delete ${childNoun}s too` : "Delete"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
