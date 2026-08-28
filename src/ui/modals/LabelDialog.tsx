/**
 * Name + colour, for creating or editing a label from the sidebar. Mirrors
 * `NamedIconDialog` but swaps the icon grid for the taxonomy colour palette,
 * since a label carries a colour, not an icon.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { TAXONOMY_PALETTE } from "../../core/taxonomy";

export function LabelDialog({
	title,
	initialName,
	initialColor,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	initialName: string;
	initialColor?: string;
	confirmLabel: string;
	onConfirm: (name: string, color: string) => Promise<void>;
	onClose: () => void;
}) {
	const [name, setName] = useState(initialName);
	const [color, setColor] = useState(initialColor ?? TAXONOMY_PALETTE[0]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const valid = name.trim().length > 0;

	const submit = async () => {
		if (!valid || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onConfirm(name.trim(), color);
			onClose();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setBusy(false);
		}
	};

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
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") void submit();
						}}
					/>
				</label>

				<div className="vf-field">
					<span>Colour</span>
					<div className="vf-swatch-grid" role="listbox" aria-label="Colour">
						{TAXONOMY_PALETTE.map((swatch) => (
							<button
								key={swatch}
								type="button"
								role="option"
								aria-selected={color === swatch}
								className={`vf-swatch${color === swatch ? " is-on" : ""}`}
								style={{ backgroundColor: swatch }}
								onClick={() => setColor(swatch)}
							/>
						))}
					</div>
				</div>

				{error && <p className="vf-error">{error}</p>}

				<div className="vf-dialog-actions">
					<button onClick={onClose}>Cancel</button>
					<button className="mod-cta" disabled={!valid || busy} onClick={() => void submit()}>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
