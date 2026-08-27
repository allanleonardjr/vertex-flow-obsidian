/**
 * The confirmation for a blocked taxonomy deletion (§5.6).
 *
 * A genuine modal — unlike the browse/settings screens, this interrupts rather
 * than navigates: it exists only because the delete you just clicked can't
 * proceed without one more decision, and cancelling should leave you exactly
 * where you were.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { describeUsage, type TaxonomyDeletionPlan, type TaxonomyUsage } from "../../core/taxonomy";

export function ReplaceValueDialog({
	plan,
	usage,
	onConfirm,
	onCancel,
}: {
	plan: TaxonomyDeletionPlan;
	usage: TaxonomyUsage;
	onConfirm: (replacementId: string) => void;
	onCancel: () => void;
}) {
	const [replacementId, setReplacementId] = useState(
		plan.replacementCandidates[0]?.id ?? "",
	);

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onCancel}>
			<div
				className="vf-dialog"
				role="dialog"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>Delete {plan.label} "{plan.valueName}"?</h3>
				<p className="vf-dialog-lead">
					It's used by {describeUsage(usage)}. Choose a replacement to reassign
					them to before it's removed.
				</p>

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

				<div className="vf-dialog-actions">
					<button onClick={onCancel}>Cancel</button>
					<button
						className="mod-cta mod-warning"
						disabled={!replacementId}
						onClick={() => onConfirm(replacementId)}
					>
						Delete and reassign
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
