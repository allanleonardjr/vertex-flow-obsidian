/**
 * Name + aliases, for creating or editing a person from the sidebar or the
 * People hub. Mirrors `LabelDialog`'s shell (backdrop / dialog / busy+error /
 * submit), swapping the colour field for a comma-separated aliases field.
 *
 * No `isSelf` toggle — that invariant ("exactly one person is self") stays in
 * Settings' `PeopleSection`.
 */

import { useState } from "react";
import { createPortal } from "react-dom";

/** Same split/trim/filter `PeopleSection` uses for its aliases input. */
function parseAliases(raw: string): string[] {
	return raw
		.split(",")
		.map((alias) => alias.trim())
		.filter(Boolean);
}

export function PersonDialog({
	title,
	initialName,
	initialAliases,
	confirmLabel,
	onConfirm,
	onClose,
}: {
	title: string;
	initialName: string;
	initialAliases?: string[];
	confirmLabel: string;
	onConfirm: (name: string, aliases: string[]) => Promise<void>;
	onClose: () => void;
}) {
	const [name, setName] = useState(initialName);
	const [aliases, setAliases] = useState((initialAliases ?? []).join(", "));
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const valid = name.trim().length > 0;

	const submit = async () => {
		if (!valid || busy) return;
		setBusy(true);
		setError(null);
		try {
			await onConfirm(name.trim(), parseAliases(aliases));
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

				<label className="vf-field">
					<span>Aliases</span>
					<input
						type="text"
						placeholder="Comma-separated"
						value={aliases}
						onChange={(event) => setAliases(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void submit();
						}}
					/>
				</label>

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
