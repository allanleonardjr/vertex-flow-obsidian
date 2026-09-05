/**
 * Name + color, for creating or editing a label from the sidebar. Mirrors
 * `NamedIconDialog`: a compact swatch trigger sits to the left of the name and
 * opens the full palette only when clicked.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { ColorField } from "../components/ColorField";
import { DescriptionDialogField } from "../components/DescriptionSection";

export function LabelDialog({
	title,
	initialName,
	initialColor,
	initialDescription,
	descriptionSourcePath,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	initialName: string;
	initialColor?: string;
	initialDescription?: string;
	/** Where `[[links]]` in the description resolve against (labels live in the
	 * workspace taxonomy file, so there's no note of their own). */
	descriptionSourcePath: string;
	confirmLabel: string;
	onConfirm: (name: string, color: string, description?: string) => Promise<void>;
	onClose: () => void;
}) {
	const [name, setName] = useState(initialName);
	const [color, setColor] = useState(initialColor ?? "#94a3b8");
	const [description, setDescription] = useState(initialDescription ?? "");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const valid = name.trim().length > 0;

	const submit = async () => {
		if (!valid || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onConfirm(name.trim(), color, description.trim() || undefined);
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

				<div className="vf-icon-name-row">
					<div className="vf-field vf-field-icon">
						<span>Color</span>
						<ColorField value={color} onChange={setColor} />
					</div>
					<label className="vf-field vf-field-name">
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
				</div>

				<DescriptionDialogField
					value={description}
					onChange={setDescription}
					sourcePath={descriptionSourcePath}
				/>

				{error && <p className="vf-error">{error}</p>}

				<div className="vf-dialog-actions">
					<button onClick={onClose}>Cancel</button>
					<button
						className="mod-cta"
						disabled={!valid || busy}
						onClick={() => void submit()}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
