/**
 * An entity's name and icon, edited in place in a header — used by the Saved
 * View title row and the Project editor header, so both behave identically.
 *
 * The name is a chrome-less text field sized to its content (so a trailing
 * `(PREFIX)` sits right beside it, the way a static heading would); the icon is
 * a bare `IconField` that opens the picker on click. Neither shows a filled
 * background — they read as the heading they replace until you interact.
 */

import { useCallback, type ReactNode } from "react";
import { Notice } from "obsidian";
import { IconField } from "./Icon";
import { useDebouncedSave } from "./fields";

export function EditableTitle({
	icon,
	iconFallback,
	name,
	suffix,
	placeholder,
	autoFocus = false,
	onRename,
	onIconChange,
}: {
	icon: string | undefined;
	iconFallback: string;
	name: string;
	/** Muted, non-editable text after the name — e.g. `(SMP4)`. */
	suffix?: ReactNode;
	placeholder: string;
	/** Select-all on mount, for a freshly created entity. */
	autoFocus?: boolean;
	/** May reject (e.g. a duplicate project title) — the field then reverts. */
	onRename: (name: string) => void | Promise<unknown>;
	onIconChange: (id: string) => void;
}) {
	const [value, setValue, flush] = useDebouncedSave(name, (next) => {
		const result = onRename(next.trim() || name);
		if (result instanceof Promise) {
			result.catch((cause) => {
				new Notice(cause instanceof Error ? cause.message : String(cause));
				setValue(name);
			});
		}
	});

	const focusRef = useCallback(
		(element: HTMLInputElement | null) => {
			if (element && autoFocus) {
				element.focus();
				element.select();
			}
		},
		[autoFocus],
	);

	return (
		<span className="vf-editable-title">
			<IconField
				value={icon}
				fallback={iconFallback}
				onChange={onIconChange}
				className="vf-title-icon"
			/>
			<input
				ref={focusRef}
				type="text"
				className="vf-editable-title-input"
				// Size to the text so the suffix hugs the name like a static heading.
				size={Math.max(6, Math.min(value.length + 1, 48))}
				value={value}
				placeholder={placeholder}
				onChange={(event) => setValue(event.target.value)}
				onBlur={flush}
			/>
			{suffix != null && (
				<span className="vf-editable-title-suffix">{suffix}</span>
			)}
		</span>
	);
}
