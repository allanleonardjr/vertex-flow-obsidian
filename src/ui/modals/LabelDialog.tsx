/**
 * Name + colour, for creating or editing a label from the sidebar. Mirrors
 * `NamedIconDialog`: a compact swatch trigger sits to the left of the name and
 * opens the full palette only when clicked.
 */

import { useEffect, useState } from "react";
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

				<div className="vf-icon-name-row">
					<div className="vf-field vf-field-icon">
						<span>Colour</span>
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

/**
 * The current colour as a swatch button; clicking it opens the palette grid.
 * The popover mirror of `IconField`, kept small since the palette is fixed.
 */
function ColorField({
	value,
	onChange,
}: {
	value: string;
	onChange: (color: string) => void;
}) {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open) return;
		const close = () => setOpen(false);
		const id = window.setTimeout(() => window.addEventListener("click", close));
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("click", close);
		};
	}, [open]);

	return (
		<div className="vf-color-field">
			<button
				type="button"
				className={`vf-color-trigger${open ? " is-on" : ""}`}
				title="Choose a colour"
				aria-label="Choose a colour"
				aria-expanded={open}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				<span
					className="vf-color-trigger-swatch"
					style={{ backgroundColor: value }}
				/>
			</button>

			{open && (
				<div
					className="vf-color-popover"
					onClick={(event) => event.stopPropagation()}
				>
					<div
						className="vf-swatch-grid"
						role="listbox"
						aria-label="Colour"
					>
						{TAXONOMY_PALETTE.map((swatch) => (
							<button
								key={swatch}
								type="button"
								role="option"
								aria-selected={value === swatch}
								className={`vf-swatch${value === swatch ? " is-on" : ""}`}
								style={{ backgroundColor: swatch }}
								onClick={() => {
									onChange(swatch);
									setOpen(false);
								}}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
