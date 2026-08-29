/**
 * A minimal "are you sure" modal for deleting a chart. `DeleteEntityDialog`
 * only speaks the hierarchy-cascade language (Task / Project `DeletionPlan`s),
 * so a widget — which has no children and no cascade — gets this instead.
 */

import { createPortal } from "react-dom";

export function ConfirmDialog({
	title,
	body,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	body: string;
	confirmLabel: string;
	onConfirm: () => void;
	onClose: () => void;
}) {
	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog"
				role="dialog"
				aria-modal="true"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>{title}</h3>
				<p className="vf-dialog-lead">{body}</p>
				<div className="vf-dialog-actions">
					<button onClick={onClose}>Cancel</button>
					<button
						className="mod-cta mod-warning"
						onClick={() => {
							onConfirm();
							onClose();
						}}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
