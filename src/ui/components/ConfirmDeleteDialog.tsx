/**
 * The one "are you sure you want to delete this?" gate, used everywhere the app
 * deletes something.
 *
 * Deletion is always a two-beat interaction: this plain yes/no confirm first,
 * and only *then* — if the thing being deleted needs one — a follow-up modal
 * about what to do with what it leaves behind (reassign a taxonomy value,
 * keep-or-cascade sub-tasks). Callers open this first and open the follow-up in
 * its `onConfirm`.
 */

import { createPortal } from "react-dom";

export function ConfirmDeleteDialog({
	title,
	body,
	confirmLabel = "Delete",
	destructive = true,
	onConfirm,
	onCancel,
}: {
	/** e.g. `Delete label "Performance"?` */
	title: string;
	/** One line of consequence. Defaults to the generic warning. */
	body?: string;
	confirmLabel?: string;
	/**
	 * When `true` (default) the confirm button is the destructive red
	 * `mod-warning`. Set to `false` for the reversible "Move to Trash" step —
	 * a blue `mod-cta`, matching `DeleteWorkspaceDialog`, because nothing is
	 * irreversibly gone yet.
	 */
	destructive?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return createPortal(
		<div className="vf-editor-backdrop" onClick={onCancel}>
			<div
				className="vf-dialog"
				role="dialog"
				aria-modal="true"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>{title}</h3>
				<p className="vf-dialog-lead">
					{body ?? "This can't be undone."}
				</p>
				<div className="vf-dialog-actions">
					<button onClick={onCancel}>Cancel</button>
					<button
						className={destructive ? "mod-cta mod-warning" : "mod-cta"}
						autoFocus
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
