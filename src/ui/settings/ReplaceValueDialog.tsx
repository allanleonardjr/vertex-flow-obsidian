/**
 * The confirmation for a blocked taxonomy deletion.
 *
 * A genuine modal — unlike the browse/settings screens, this interrupts rather
 * than navigates: it exists only because the delete you just clicked can't
 * proceed without one more decision, and cancelling should leave you exactly
 * where you were.
 *
 * For a multi-select taxonomy (labels) the caller passes `allowRemoveAll`, which
 * adds a second choice — strip the value from every task instead of reassigning.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { describeUsage, type TaxonomyDeletionPlan, type TaxonomyUsage } from "../../core/taxonomy";

export function ReplaceValueDialog({
	plan,
	usage,
	allowRemoveAll = false,
	onConfirm,
	onCancel,
}: {
	plan: TaxonomyDeletionPlan;
	usage: TaxonomyUsage;
	allowRemoveAll?: boolean;
	/** `null` = remove from every task (only when `allowRemoveAll`). */
	onConfirm: (replacementId: string | null) => void;
	onCancel: () => void;
}) {
	const [mode, setMode] = useState<"reassign" | "remove">("reassign");
	const [replacementId, setReplacementId] = useState(
		plan.replacementCandidates[0]?.id ?? "",
	);

	const canReassign = plan.replacementCandidates.length > 0;
	const effectiveMode = canReassign ? mode : "remove";
	const confirmDisabled = effectiveMode === "reassign" && !replacementId;

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onCancel}>
			<div
				className="vf-dialog"
				role="dialog"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>Delete {plan.label} "{plan.valueName}"?</h3>
				<p className="vf-dialog-lead">
					It's used by {describeUsage(usage)}.{" "}
					{allowRemoveAll && canReassign
						? "Reassign them, or remove it from every task."
						: "Choose a replacement to reassign them to before it's removed."}
				</p>

				{allowRemoveAll && canReassign && (
					<div className="vf-field">
						<label className="vf-radio">
							<input
								type="radio"
								name="vf-delete-mode"
								checked={mode === "reassign"}
								onChange={() => setMode("reassign")}
							/>
							<span>Reassign to another {plan.label}</span>
						</label>
						<label className="vf-radio">
							<input
								type="radio"
								name="vf-delete-mode"
								checked={mode === "remove"}
								onChange={() => setMode("remove")}
							/>
							<span>Remove it from every task</span>
						</label>
					</div>
				)}

				{effectiveMode === "reassign" && (
					<label className="vf-field">
						<span>Replace with</span>
						<select
							className="vf-select"
							value={replacementId}
							onChange={(event) => setReplacementId(event.target.value)}
						>
							{plan.replacementCandidates.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>
									{candidate.name}
								</option>
							))}
						</select>
					</label>
				)}

				<div className="vf-dialog-actions">
					<button onClick={onCancel}>Cancel</button>
					<button
						className="mod-cta mod-warning"
						disabled={confirmDisabled}
						onClick={() =>
							onConfirm(effectiveMode === "remove" ? null : replacementId)
						}
					>
						{effectiveMode === "remove" ? "Delete and remove" : "Delete and reassign"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
