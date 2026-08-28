/**
 * Name a Saved View — used both when creating one and when renaming. A genuine
 * modal (like `ReplaceValueDialog`): it interrupts to collect one string and
 * leaves you where you were on cancel.
 */

import { useState } from "react";
import { createPortal } from "react-dom";

export function ViewDialog({
	title,
	initialName,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	initialName: string;
	confirmLabel: string;
	onConfirm: (name: string) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(initialName);
	const valid = name.trim().length > 0;

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog"
				role="dialog"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>{title}</h3>
				<label className="vf-field">
					<span>Name</span>
					<input
						type="text"
						autoFocus
						value={name}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && valid) {
								onConfirm(name.trim());
								onClose();
							}
						}}
					/>
				</label>

				<div className="vf-dialog-actions">
					<button onClick={onClose}>Cancel</button>
					<button
						className="mod-cta"
						disabled={!valid}
						onClick={() => {
							onConfirm(name.trim());
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
