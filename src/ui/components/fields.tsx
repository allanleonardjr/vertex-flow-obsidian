/**
 * Reusable form controls for the task editor.
 *
 * Every one of these writes through immediately on change — there is no Save
 * button in the editor, matching Linear (and matching the fact that the note on
 * disk is the source of truth, so a half-saved editor state would be a lie).
 * Free-text fields are the exception; they debounce, see `useDebouncedSave`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SignalZero } from "lucide-react";
import { listValues, type Taxonomy } from "../../core/taxonomy";
import type { Person, TaxonomyValue } from "../../core/types";
import { Popover } from "./Popover";
import { LabelChip, PriorityIcon } from "./TaskBits";

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

/**
 * A taxonomy picker whose trigger and rows show the value exactly as it renders
 * everywhere else in the app — a colour dot for Status, a signal icon for
 * Priority, a tinted pill for Type. A native `<select>` can't draw any of that.
 *
 * `renderOption(null)` is the "no value" row; pass `allowNone: false` (Status)
 * to drop it. `dividerAfterNone` sets it apart from an ordered scale.
 */
function TaxonomyMenuSelect({
	taxonomy,
	value,
	onChange,
	allowNone,
	renderOption,
	dividerAfterNone = false,
}: {
	taxonomy: Taxonomy;
	value: string | null;
	onChange: (value: string | null) => void;
	allowNone: boolean;
	renderOption: (entry: TaxonomyValue | null) => ReactNode;
	dividerAfterNone?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const values = listValues(taxonomy);

	// A value the taxonomy no longer defines still has to show and stay
	// selectable, or opening the editor would silently drop it.
	const removed: TaxonomyValue | null =
		value && !values.some((entry) => entry.id === value)
			? { id: value, name: `${value} (removed)`, color: "" }
			: null;
	const selected = value
		? (values.find((entry) => entry.id === value) ?? removed)
		: null;

	const choose = (next: string | null) => {
		onChange(next);
		setOpen(false);
	};

	const row = (entry: TaxonomyValue | null, key: string) => (
		<button
			key={key}
			type="button"
			role="option"
			aria-selected={(entry?.id ?? null) === value}
			className={`vf-menu-item${(entry?.id ?? null) === value ? " is-active" : ""}`}
			onClick={() => choose(entry?.id ?? null)}
		>
			{renderOption(entry)}
		</button>
	);

	return (
		<span className="vf-icon-select">
			<button
				type="button"
				className="vf-icon-select-trigger"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				{renderOption(selected)}
				<span className="vf-icon-select-caret" aria-hidden>
					⌄
				</span>
			</button>

			{open && (
				<Popover align="left" onClose={() => setOpen(false)}>
					<div className="vf-option-list" role="listbox">
						{allowNone && row(null, "__none__")}
						{allowNone && dividerAfterNone && (
							<div className="vf-menu-divider" aria-hidden />
						)}
						{values.map((entry) => row(entry, entry.id))}
						{removed && row(removed, removed.id)}
					</div>
				</Popover>
			)}
		</span>
	);
}

function IconLabel({ glyph, name }: { glyph: ReactNode; name: string }) {
	return (
		<>
			{glyph}
			<span className="vf-icon-select-name">{name}</span>
		</>
	);
}

/** The Lucide signal glyphs `PriorityIcon` knows how to draw. */
const BUILT_IN_PRIORITY_IDS = new Set(["urgent", "high", "medium", "low"]);

function priorityGlyph(entry: TaxonomyValue | null): ReactNode {
	if (!entry) {
		return (
			<span className="vf-priority-icon is-none" aria-hidden>
				<SignalZero size={14} />
			</span>
		);
	}
	if (BUILT_IN_PRIORITY_IDS.has(entry.id.toLowerCase())) {
		return <PriorityIcon priority={entry.id} />;
	}
	return (
		<span
			className="vf-priority-dot"
			style={entry.color ? { background: entry.color } : undefined}
			aria-hidden
		/>
	);
}

/** Priority: "{signal icon} {name}", "None" set apart at the top. */
export function PrioritySelect(props: {
	taxonomy: Taxonomy;
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	return (
		<TaxonomyMenuSelect
			{...props}
			allowNone
			dividerAfterNone
			renderOption={(entry) => (
				<IconLabel glyph={priorityGlyph(entry)} name={entry?.name ?? "None"} />
			)}
		/>
	);
}

/** Status: "{colour dot} {name}". Always set — no "None" row. */
export function StatusSelect({
	value,
	onChange,
	...rest
}: {
	taxonomy: Taxonomy;
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	return (
		<TaxonomyMenuSelect
			{...rest}
			value={value}
			onChange={(next) => next && onChange(next)}
			allowNone={false}
			renderOption={(entry) => (
				<IconLabel
					glyph={
						<span
							className="vf-status-dot"
							style={entry?.color ? { background: entry.color } : undefined}
							aria-hidden
						/>
					}
					name={entry?.name ?? "—"}
				/>
			)}
		/>
	);
}

/** Type: the tinted pill itself, exactly as it renders on cards. */
export function TypeSelect(props: {
	taxonomy: Taxonomy;
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	return (
		<TaxonomyMenuSelect
			{...props}
			allowNone
			renderOption={(entry) =>
				entry ? (
					<LabelChip name={entry.name} color={entry.color} />
				) : (
					<span className="vf-icon-select-name vf-prop-empty">None</span>
				)
			}
		/>
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
