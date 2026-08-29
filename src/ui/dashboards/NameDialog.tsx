/**
 * A one-field name prompt — used for "New dashboard", rename, and "Save as".
 * Dashboards carry no icon, so `NamedIconDialog` (which always shows an icon
 * picker) would be misleading here.
 */

import { useState } from "react";
import { createPortal } from "react-dom";

export function NameDialog({
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

	const submit = () => {
		if (!valid) return;
		onConfirm(name.trim());
		onClose();
	};

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog"
				role="dialog"
				aria-modal="true"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>{title}</h3>
				<label className="vf-field vf-field-name">
					<span>Name</span>
					<input
						type="text"
						autoFocus
						value={name}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") submit();
						}}
					/>
				</label>
				<div className="vf-dialog-actions">
					<button onClick={onClose}>Cancel</button>
					<button className="mod-cta" disabled={!valid} onClick={submit}>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
