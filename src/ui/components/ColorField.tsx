/**
 * The reusable color picker: a swatch trigger that opens a 48-color Spectrum
 * Matrix popover (8 columns, vertical color columns — see `COLOR_PALETTE`).
 *
 * Used everywhere a color is chosen: taxonomy settings (statuses, priorities,
 * task types) and the label editor. A "Custom Color" row lets power users
 * escape the presets and pick a raw color via the native browser wheel or a
 * typed hex code.
 */

import { useEffect, useRef, useState } from "react";
import { COLOR_PALETTE } from "../../core/color";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function ColorField({
	value,
	onChange,
}: {
	value: string;
	onChange: (color: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [hex, setHex] = useState(value);

	// Latest state visible to the outside-click close handler, so a pending
	// custom hex is committed when the popover closes instead of being lost.
	const stateRef = useRef({ hex, value });
	stateRef.current = { hex, value };

	useEffect(() => {
		if (!open) return;
		const close = () => {
			const { hex: pendingHex, value: committed } = stateRef.current;
			const pending = normalizeHex(pendingHex);
			if (pending && pending !== committed) onChange(pending);
			setOpen(false);
		};
		const id = window.setTimeout(() => window.addEventListener("click", close));
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("click", close);
		};
	}, [open, onChange]);

	// Stay in sync when the parent resets the value (e.g. AddValueRow picking a
	// fresh random color after submit).
	useEffect(() => {
		if (open && HEX_RE.test(value)) setHex(value);
	}, [value, open]);

	const hexValid = HEX_RE.test(hex);
	const normalized = hexValid ? normalizeHex(hex) : null;

	const select = (next: string) => {
		onChange(next);
		setOpen(false);
	};

	return (
		<div className="vf-color-field">
			<button
				type="button"
				className={`vf-color-trigger${open ? " is-on" : ""}`}
				title="Choose a color"
				aria-label="Choose a color"
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
						aria-label="Color"
					>
						{COLOR_PALETTE.map((swatch) => (
							<button
								key={swatch}
								type="button"
								role="option"
								aria-selected={value === swatch}
								className={`vf-swatch${value === swatch ? " is-on" : ""}`}
								style={{ backgroundColor: swatch }}
								onClick={() => select(swatch)}
							/>
						))}
					</div>

					<p className="vf-color-custom-label">Custom Color</p>

					<div className="vf-color-custom-row">
						<label
							className={`vf-swatch vf-color-custom-wheel${normalized === value ? " is-on" : ""}`}
							style={{ backgroundColor: normalized ?? "#000000" }}
							title="Pick a custom color"
							aria-label="Pick a custom color"
						>
							<input
								type="color"
								value={normalized ?? "#000000"}
								onInput={(event) => {
									setHex(event.currentTarget.value);
								}}
								onChange={(event) => {
									setHex(event.target.value);
								}}
							/>
						</label>
						<input
							type="text"
							className="vf-input vf-color-custom-hex"
							placeholder="#RRGGBB"
							value={hex}
							spellCheck={false}
							onChange={(event) => {
								setHex(event.target.value);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter" && hexValid) {
									select(normalized!);
								}
							}}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

/** Accepts 3- and 6-digit hex; expands 3-digit to 6. Returns null if invalid. */
function normalizeHex(raw: string): string | null {
	const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw.trim());
	if (!m) return null;
	const digits = m[1].toLowerCase();
	const full = digits.length === 3 ? digits.replace(/(.)/g, "$1$1") : digits;
	return `#${full}`;
}
