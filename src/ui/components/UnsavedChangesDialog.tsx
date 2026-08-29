/**
 * The leave-guard prompt for a tab holding unsaved draft edits (a dashboard
 * layout, a Saved View definition).
 *
 * Three outcomes, unlike `ConfirmDeleteDialog`'s two: Save keeps the edits and
 * lets you leave, Discard throws them away and lets you leave, Cancel stays
 * put. When the draft's target can't be overwritten in place (a synthesised
 * label view, say), Save is replaced by guidance to use "Save as…" first.
 */

import { useState } from "react";
import { createPortal } from "react-dom";

export function UnsavedChangesDialog({
	what,
	canSave,
	onSave,
	onDiscard,
	onCancel,
}: {
	/** What has unsaved changes, e.g. `"dashboard"` or `"view"`. */
	what: string;
	/** False when there's nothing to overwrite (Save is hidden). */
	canSave: boolean;
	/** Persist the draft, then resolve the guard. May be async. */
	onSave: () => void | Promise<void>;
	/** Throw the draft away, then resolve the guard. */
	onDiscard: () => void;
	/** Leave the draft untouched and stay on the tab. */
	onCancel: () => void;
}) {
	const [busy, setBusy] = useState(false);

	const save = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await onSave();
		} finally {
			setBusy(false);
		}
	};

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onCancel}>
			<div
				className="vf-dialog"
				role="dialog"
				aria-modal="true"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>Unsaved changes to this {what}</h3>
				<p className="vf-dialog-lead">
					{canSave
						? `Save your changes to this ${what} before leaving, or discard them?`
						: `This ${what} can't be saved over. Use "Save as…" first to keep these changes, or discard them.`}
				</p>
				<div className="vf-dialog-actions">
					<button disabled={busy} onClick={onCancel}>
						Cancel
					</button>
					<button
						className="mod-warning"
						disabled={busy}
						onClick={onDiscard}
					>
						Discard
					</button>
					{canSave && (
						<button
							className="mod-cta"
							disabled={busy}
							autoFocus
							onClick={() => void save()}
						>
							Save
						</button>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
