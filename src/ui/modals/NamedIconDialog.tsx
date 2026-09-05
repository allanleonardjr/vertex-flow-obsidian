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
import { DescriptionDialogField } from "../components/DescriptionSection";

export function NamedIconDialog({
	title,
	initialName,
	initialIcon,
	initialDescription,
	descriptionSourcePath,
	iconFallback,
	confirmLabel,
	validateName,
	onConfirm,
	onCancel,
	onClose,
}: {
	title: string;
	initialName: string;
	initialIcon?: string;
	/**
	 * When provided, the dialog also collects a description for the thing being
	 * created, using the app-wide Description control (Markdown + source toggle).
	 */
	initialDescription?: string;
	/** Where `[[links]]` in that description resolve against — needed when
	 * `initialDescription` is provided. */
	descriptionSourcePath?: string;
	iconFallback?: string;
	confirmLabel: string;
	/**
	 * Extra validation on the typed name — returns a message to show under the
	 * field (and block confirm), or `null` when it's fine. Used for the
	 * per-workspace project-title uniqueness check, mirroring the ID-prefix
	 * collision treatment in the workspace-creation dialog.
	 */
	validateName?: (name: string) => string | null;
	onConfirm: (
		name: string,
		icon: string | undefined,
		description?: string,
	) => void;
	/**
	 * Called when the dialog is dismissed *without* confirming (Cancel button or
	 * backdrop click) — not after a successful confirm. Callers that pre-create
	 * the thing being named (a new View / Dashboard) use this to discard it.
	 */
	onCancel?: () => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(initialName);
	const [icon, setIcon] = useState<string | undefined>(initialIcon);
	const [description, setDescription] = useState(initialDescription ?? "");

	const nameError = validateName?.(name) ?? null;
	const valid = name.trim().length > 0 && !nameError;

	const cancel = () => {
		onCancel?.();
		onClose();
	};

	const submit = () => {
		if (!valid) return;
		onConfirm(name.trim(), icon, description.trim() || undefined);
		onClose();
	};

	return createPortal(
		<div className="vf-editor-backdrop" onClick={cancel}>
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
							aria-invalid={nameError != null}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") submit();
							}}
						/>
						{nameError && (
							<small className="vf-field-error">{nameError}</small>
						)}
					</label>
				</div>

				{initialDescription !== undefined && (
					<DescriptionDialogField
						value={description}
						onChange={setDescription}
						sourcePath={descriptionSourcePath ?? ""}
					/>
				)}

				<div className="vf-dialog-actions">
					<button onClick={cancel}>Cancel</button>
					<button className="mod-cta" disabled={!valid} onClick={submit}>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
