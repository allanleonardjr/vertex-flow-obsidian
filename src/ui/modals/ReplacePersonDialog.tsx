/**
 * The confirmation for deleting a person who's in use. Parallel to
 * `ReplaceValueDialog`, not built on it — see `core/people.ts` for why Person
 * deletion doesn't share `TaxonomyDeletionPlan`'s shape. Always offers "clear
 * the field" as the fallback (a nullable single-select field has no other),
 * so there's no `allowRemoveAll` prop to gate it behind.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { describePersonUsage, type PersonDeletionPlan } from "../../core/people";

export function ReplacePersonDialog({
	plan,
	onConfirm,
	onCancel,
}: {
	plan: PersonDeletionPlan;
	/** `null` = clear `assignee`/`owner` everywhere instead of reassigning. */
	onConfirm: (replacementId: string | null) => void;
	onCancel: () => void;
}) {
	const canReassign = plan.replacementCandidates.length > 0;
	const [mode, setMode] = useState<"reassign" | "clear">(
		canReassign ? "reassign" : "clear",
	);
	const [replacementId, setReplacementId] = useState(
		plan.replacementCandidates[0]?.id ?? "",
	);

	const effectiveMode = canReassign ? mode : "clear";
	const confirmDisabled = effectiveMode === "reassign" && !replacementId;

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onCancel}>
			<div
				className="vf-dialog"
				role="dialog"
				onClick={(e) => e.stopPropagation()}
			>
				<h3>Delete "{plan.personName}"?</h3>
				<p className="vf-dialog-lead">
					They're on {describePersonUsage(plan.usage)}.{" "}
					{canReassign
						? "Reassign those, or clear the field instead."
						: "There's no one else to reassign to, so the field will be cleared."}
				</p>

				{canReassign && (
					<div className="vf-field">
						<label className="vf-radio">
							<input
								type="radio"
								name="vf-person-delete-mode"
								checked={mode === "reassign"}
								onChange={() => setMode("reassign")}
							/>
							<span>Reassign to another person</span>
						</label>
						<label className="vf-radio">
							<input
								type="radio"
								name="vf-person-delete-mode"
								checked={mode === "clear"}
								onChange={() => setMode("clear")}
							/>
							<span>Clear it everywhere</span>
						</label>
					</div>
				)}

				{effectiveMode === "reassign" && (
					<label className="vf-field">
						<span>Reassign to</span>
						<select
							className="vf-select"
							value={replacementId}
							onChange={(e) => setReplacementId(e.target.value)}
						>
							{plan.replacementCandidates.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
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
							onConfirm(effectiveMode === "clear" ? null : replacementId)
						}
					>
						Delete
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
