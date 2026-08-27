/**
 * Reusable form controls for the task editor.
 *
 * Every one of these writes through immediately on change — there is no Save
 * button in the editor, matching Linear (and matching the fact that the note on
 * disk is the source of truth, so a half-saved editor state would be a lie).
 * Free-text fields are the exception; they debounce, see `useDebouncedSave`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { listValues, type Taxonomy } from "../../core/taxonomy";
import type { Person } from "../../core/types";

export function PropertyRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="vf-prop">
			<span className="vf-prop-label">{label}</span>
			<div className="vf-prop-control">{children}</div>
		</div>
	);
}

export function TaxonomySelect({
	taxonomy,
	value,
	onChange,
	allowNone,
	noneLabel = "None",
}: {
	taxonomy: Taxonomy;
	value: string | null;
	onChange: (value: string | null) => void;
	allowNone: boolean;
	noneLabel?: string;
}) {
	return (
		<select
			className="vf-select"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value || null)}
		>
			{allowNone && <option value="">{noneLabel}</option>}
			{listValues(taxonomy).map((entry) => (
				<option key={entry.id} value={entry.id}>
					{entry.name}
				</option>
			))}
			{/* A value the taxonomy no longer defines still has to be selectable,
			    or opening the editor would silently rewrite it. */}
			{value && !taxonomy.values.some((entry) => entry.id === value) && (
				<option value={value}>{value} (removed)</option>
			)}
		</select>
	);
}

export function PersonSelect({
	people,
	value,
	onChange,
}: {
	people: Person[];
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	return (
		<select
			className="vf-select"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value || null)}
		>
			<option value="">Unassigned</option>
			{people.map((person) => (
				<option key={person.id} value={person.id}>
					{person.name}
				</option>
			))}
			{value && !people.some((person) => person.id === value) && (
				<option value={value}>{value} (unknown)</option>
			)}
		</select>
	);
}

export interface Option {
	value: string;
	label: string;
}

export function OptionSelect({
	options,
	value,
	onChange,
	noneLabel,
}: {
	options: Option[];
	value: string | null;
	onChange: (value: string | null) => void;
	noneLabel: string;
}) {
	return (
		<select
			className="vf-select"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value || null)}
		>
			<option value="">{noneLabel}</option>
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
			{value && !options.some((option) => option.value === value) && (
				<option value={value}>{value}</option>
			)}
		</select>
	);
}

/** Labels are the one multi-select taxonomy (§5.4), so they get chips. */
export function LabelPicker({
	taxonomy,
	value,
	onChange,
}: {
	taxonomy: Taxonomy;
	value: string[];
	onChange: (value: string[]) => void;
}) {
	const all = listValues(taxonomy);
	if (all.length === 0) {
		return <span className="vf-prop-empty">No labels configured</span>;
	}

	return (
		<div className="vf-label-picker">
			{all.map((label) => {
				const on = value.includes(label.id);
				return (
					<button
						key={label.id}
						type="button"
						className={`vf-chip vf-chip-button${on ? " is-on" : ""}`}
						style={{ borderColor: label.color, color: on ? undefined : label.color }}
						onClick={() =>
							onChange(
								on
									? value.filter((id) => id !== label.id)
									: [...value, label.id],
							)
						}
					>
						{label.name}
					</button>
				);
			})}
		</div>
	);
}

export function DateField({
	value,
	onChange,
}: {
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	return (
		<input
			className="vf-input"
			type="date"
			value={value ? value.slice(0, 10) : ""}
			onChange={(event) => onChange(event.target.value || null)}
		/>
	);
}

export function NumberField({
	value,
	onChange,
	placeholder,
}: {
	value: number | null;
	onChange: (value: number | null) => void;
	placeholder?: string;
}) {
	return (
		<input
			className="vf-input"
			type="number"
			min={0}
			step="any"
			placeholder={placeholder}
			value={value ?? ""}
			onChange={(event) => {
				const parsed = Number.parseFloat(event.target.value);
				onChange(Number.isFinite(parsed) ? parsed : null);
			}}
		/>
	);
}

/**
 * Local text state that saves after a pause, and flushes on unmount.
 *
 * Writing on every keystroke would mean a vault write (and an index rebuild)
 * per character. Not flushing on unmount would silently drop whatever was typed
 * in the last few hundred milliseconds before the editor closed.
 */
export function useDebouncedSave(
	initial: string,
	save: (value: string) => void,
	delay = 500,
): [string, (value: string) => void, () => void] {
	const [value, setValue] = useState(initial);
	const timer = useRef<number | null>(null);
	const pending = useRef<string | null>(null);
	const saveRef = useRef(save);
	saveRef.current = save;

	const flush = () => {
		if (timer.current != null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		if (pending.current != null) {
			saveRef.current(pending.current);
			pending.current = null;
		}
	};

	const flushRef = useRef(flush);
	flushRef.current = flush;

	useEffect(() => () => flushRef.current(), []);

	const update = (next: string) => {
		setValue(next);
		pending.current = next;
		if (timer.current != null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = null;
			if (pending.current != null) {
				saveRef.current(pending.current);
				pending.current = null;
			}
		}, delay);
	};

	return [value, update, flush];
}
