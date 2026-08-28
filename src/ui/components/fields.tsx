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
import type { Person } from "../../core/types";
import { Popover } from "./Popover";
import { PriorityIcon } from "./TaskBits";

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

/** The Lucide signal glyphs `PriorityIcon` knows how to draw. */
const BUILT_IN_PRIORITY_IDS = new Set(["urgent", "high", "medium", "low"]);

function PriorityGlyph({
	value,
}: {
	value: { id: string; color?: string | null } | null;
}) {
	if (!value) {
		return (
			<span className="vf-priority-icon is-none" aria-hidden>
				<SignalZero size={14} />
			</span>
		);
	}
	if (BUILT_IN_PRIORITY_IDS.has(value.id.toLowerCase())) {
		return <PriorityIcon priority={value.id} />;
	}
	return (
		<span
			className="vf-priority-dot"
			style={value.color ? { background: value.color } : undefined}
			aria-hidden
		/>
	);
}

/**
 * Priority picker for the task editor.
 *
 * A native `<select>` can't draw the signal icons, so this is a small popover
 * whose trigger and rows both read as "{icon} {name}" — the same glyphs the
 * board and list use. "None" (unset) sits at the top.
 */
export function PrioritySelect({
	taxonomy,
	value,
	onChange,
}: {
	taxonomy: Taxonomy;
	value: string | null;
	onChange: (value: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const values = listValues(taxonomy);
	const selected = value
		? (values.find((entry) => entry.id === value) ?? {
				id: value,
				name: `${value} (removed)`,
				color: null,
			})
		: null;

	const choose = (next: string | null) => {
		onChange(next);
		setOpen(false);
	};

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
				<PriorityGlyph value={selected} />
				<span className="vf-icon-select-name">{selected?.name ?? "None"}</span>
				<span className="vf-icon-select-caret" aria-hidden>
					⌄
				</span>
			</button>

			{open && (
				<Popover align="left" onClose={() => setOpen(false)}>
					<div className="vf-option-list" role="listbox">
						<button
							type="button"
							role="option"
							aria-selected={value == null}
							className={`vf-menu-item${value == null ? " is-active" : ""}`}
							onClick={() => choose(null)}
						>
							<PriorityGlyph value={null} />
							None
						</button>
						{values.map((entry) => (
							<button
								key={entry.id}
								type="button"
								role="option"
								aria-selected={entry.id === value}
								className={`vf-menu-item${entry.id === value ? " is-active" : ""}`}
								onClick={() => choose(entry.id)}
							>
								<PriorityGlyph value={entry} />
								{entry.name}
							</button>
						))}
					</div>
				</Popover>
			)}
		</span>
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
