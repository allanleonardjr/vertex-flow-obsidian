/**
 * Name + icon, for creating or editing a Workspace, View, or Project from the
 * sidebar. A genuine modal (like `ReplaceValueDialog`): it interrupts to collect
 * two fields and leaves you where you were on cancel.
 *
 * The icon sits as a button to the left of the name, opening the full picker
 * only when clicked — the grid is ~290 icons, far too much to show up front.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { IconField } from "../components/Icon";

export function NamedIconDialog({
	title,
	initialName,
	initialIcon,
	iconFallback,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	initialName: string;
	initialIcon?: string;
	iconFallback?: string;
	confirmLabel: string;
	onConfirm: (name: string, icon: string | undefined) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(initialName);
	const [icon, setIcon] = useState<string | undefined>(initialIcon);
	const valid = name.trim().length > 0;

	const submit = () => {
		if (!valid) return;
		onConfirm(name.trim(), icon);
		onClose();
	};

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog"
				role="dialog"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>{title}</h3>

				<div className="vf-icon-name-row">
					<div className="vf-field vf-field-icon">
						<span>Icon</span>
						<IconField
							value={icon}
							fallback={iconFallback}
							onChange={setIcon}
						/>
					</div>
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
				</div>

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
