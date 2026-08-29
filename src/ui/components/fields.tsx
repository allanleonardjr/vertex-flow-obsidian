/**
 * Reusable form controls for the task editor.
 *
 * Every one of these writes through immediately on change — there is no Save
 * button in the editor, matching Linear (and matching the fact that the note on
 * disk is the source of truth, so a half-saved editor state would be a lie).
 * Free-text fields are the exception; they debounce, see `useDebouncedSave`.
 */

import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { listValues, type Taxonomy } from "../../core/taxonomy";
import type { Person, TaxonomyValue } from "../../core/types";
import { LabelChip, PersonAvatar, PriorityIcon } from "./TaskBits";

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

/** Rows beyond this and the menu is worth filtering; below it, a box is noise. */
const SEARCH_THRESHOLD = 8;

/** Breathing room kept between the menu and the window edge. */
const MARGIN = 8;
/** Below this, opening downward isn't worth it — flip above the trigger. */
const MIN_MENU_HEIGHT = 160;

interface SelectRow {
	value: string | null;
	/** Rendered in the row — and, for the current value, in the trigger. */
	node: ReactNode;
	/** Plain text the search box matches against. */
	search: string;
	className?: string;
	/** Rule off beneath this row (sets the "no value" row apart). */
	dividerAfter?: boolean;
}

interface MenuPlacement {
	top?: number;
	bottom?: number;
	left: number;
	width: number;
	maxHeight: number;
}

/**
 * The shell every picker in the editor rail shares: a trigger that renders the
 * current value exactly as the menu rows do, over an anchored list of those
 * rows. Rows are `<button>`s rather than `<option>`s because a native `<select>`
 * can't draw a colour dot, a signal glyph, a tinted pill or an avatar.
 *
 * A search box appears only once the list is long enough to be worth filtering
 * — people and projects grow, a five-value status list doesn't. Arrow keys
 * move the highlight, Enter picks, Escape closes; the highlight follows the
 * mouse so keyboard and pointer never disagree about what Enter would do.
 *
 * The menu is portaled and positioned from the trigger, the same as the task
 * picker: the rail is an overflow-scroll container, so an in-flow menu would be
 * clipped — worst exactly where the longest lists (Project, Assignee) sit.
 */
function SelectMenu({
	rows,
	value,
	trigger,
	onChange,
	searchPlaceholder = "Search…",
}: {
	rows: SelectRow[];
	value: string | null;
	trigger: ReactNode;
	onChange: (value: string | null) => void;
	searchPlaceholder?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [placement, setPlacement] = useState<MenuPlacement | null>(null);
	const anchorRef = useRef<HTMLSpanElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const showSearch = rows.length > SEARCH_THRESHOLD;
	const needle = query.trim().toLowerCase();
	const shown = needle
		? rows.filter((row) => row.search.toLowerCase().includes(needle))
		: rows;
	// Clamped at render rather than reset in an effect — filtering can shrink
	// the list under the highlight between two keystrokes.
	const activeIndex = Math.min(active, Math.max(0, shown.length - 1));

	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
	}, []);

	const choose = (next: string | null) => {
		onChange(next);
		close();
	};

	const toggle = () => {
		if (open) {
			close();
			return;
		}
		// Open with the current value under the highlight, so Enter is a no-op
		// and the arrows start from where you are.
		setActive(Math.max(0, rows.findIndex((row) => row.value === value)));
		setOpen(true);
	};

	const place = useCallback(() => {
		const rect = anchorRef.current?.getBoundingClientRect();
		if (!rect) return;
		const width = Math.min(
			Math.max(rect.width, 220),
			window.innerWidth - 2 * MARGIN,
		);
		const left = Math.min(
			Math.max(MARGIN, rect.left),
			window.innerWidth - width - MARGIN,
		);
		const below = window.innerHeight - rect.bottom - MARGIN - 4;
		const above = rect.top - MARGIN - 4;
		// Drop down unless there's too little room and more of it overhead.
		setPlacement(
			below < MIN_MENU_HEIGHT && above > below
				? {
						bottom: window.innerHeight - rect.top + 4,
						left,
						width,
						maxHeight: above,
					}
				: { top: rect.bottom + 4, left, width, maxHeight: below },
		);
	}, []);

	useLayoutEffect(() => {
		if (!open) return;
		place();
		// Follow the anchor rather than close — the editor rail scrolls.
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		const onClick = () => close();
		const id = window.setTimeout(() =>
			window.addEventListener("click", onClick),
		);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("click", onClick);
		};
	}, [open, place, close]);

	// Without a search box there's nothing focusable in the menu, so the list
	// itself takes focus — otherwise the arrow keys would go to the page.
	useEffect(() => {
		if (open && !showSearch) listRef.current?.focus();
	}, [open, showSearch]);

	useEffect(() => {
		listRef.current
			?.querySelector<HTMLElement>("[data-highlighted='true']")
			?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	const onKeyDown = (event: ReactKeyboardEvent) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (shown.length === 0) return;
			const delta = event.key === "ArrowDown" ? 1 : -1;
			setActive((activeIndex + delta + shown.length) % shown.length);
		} else if (event.key === "Enter") {
			event.preventDefault();
			const row = shown[activeIndex];
			if (row) choose(row.value);
		} else if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};

	return (
		<span className="vf-icon-select" ref={anchorRef}>
			<button
				type="button"
				className="vf-icon-select-trigger"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={(event) => {
					event.stopPropagation();
					toggle();
				}}
			>
				{trigger}
				<span className="vf-icon-select-caret" aria-hidden>
					⌄
				</span>
			</button>

			{open &&
				placement &&
				createPortal(
					<div
						className="vf-select-menu"
						style={{
							top: placement.top,
							bottom: placement.bottom,
							left: placement.left,
							width: placement.width,
							maxHeight: placement.maxHeight,
						}}
						onClick={(event) => event.stopPropagation()}
						onKeyDown={onKeyDown}
					>
						{showSearch && (
							<input
								autoFocus
								type="text"
								className="vf-input vf-select-search"
								placeholder={searchPlaceholder}
								value={query}
								onChange={(event) => {
									setQuery(event.target.value);
									setActive(0);
								}}
							/>
						)}

						<div
							ref={listRef}
							className="vf-option-list vf-option-list-scroll"
							role="listbox"
							tabIndex={-1}
						>
							{shown.map((row, index) => (
								<Fragment key={row.value ?? "__none__"}>
									<button
										type="button"
										role="option"
										aria-selected={row.value === value}
										data-highlighted={index === activeIndex}
										className={[
											"vf-menu-item",
											row.className ?? "",
											row.value === value ? "is-active" : "",
											index === activeIndex ? "is-highlighted" : "",
										]
											.filter(Boolean)
											.join(" ")}
										onMouseEnter={() => setActive(index)}
										onClick={() => choose(row.value)}
									>
										{row.node}
									</button>
									{row.dividerAfter && index < shown.length - 1 && (
										<div className="vf-menu-divider" aria-hidden />
									)}
								</Fragment>
							))}

							{shown.length === 0 && (
								<p className="vf-menu-empty">No matches</p>
							)}
						</div>
					</div>,
					document.body,
				)}
		</span>
	);
}

/**
 * A taxonomy picker whose trigger and rows show the value exactly as it renders
 * everywhere else in the app — a colour dot for Status, a signal icon for
 * Priority, a tinted pill for Type. A native `<select>` can't draw any of that.
 *
 * `renderOption(null)` is the "no value" row; pass `allowNone: false` (Status)
 * to drop it. When shown it renders in italics with a rule beneath, set apart
 * from the real values.
 */
function TaxonomyMenuSelect({
	taxonomy,
	value,
	onChange,
	allowNone,
	renderOption,
}: {
	taxonomy: Taxonomy;
	value: string | null;
	onChange: (value: string | null) => void;
	allowNone: boolean;
	renderOption: (entry: TaxonomyValue | null) => ReactNode;
}) {
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

	const entries = removed ? [...values, removed] : values;
	const rows: SelectRow[] = entries.map((entry) => ({
		value: entry.id,
		node: renderOption(entry),
		search: entry.name,
	}));

	if (allowNone) {
		rows.unshift({
			value: null,
			node: renderOption(null),
			search: "none",
			className: "vf-menu-none",
			dividerAfter: true,
		});
	}

	return (
		<SelectMenu
			rows={rows}
			value={value}
			onChange={onChange}
			trigger={renderOption(selected)}
		/>
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

/**
 * The same rank-based signal glyph the board and list use — so the picker reads
 * exactly like the rows it edits, for default and custom priorities alike.
 */
function priorityGlyph(taxonomy: Taxonomy, entry: TaxonomyValue | null): ReactNode {
	const ordered = listValues(taxonomy);
	const index = entry ? ordered.findIndex((value) => value.id === entry.id) : -1;
	return (
		<PriorityIcon
			index={index}
			count={ordered.length}
			color={entry?.color}
			name={entry?.name}
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
			renderOption={(entry) => (
				<IconLabel
					glyph={priorityGlyph(props.taxonomy, entry)}
					name={entry?.name ?? "None"}
				/>
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

/**
 * A person as they read everywhere else — initials avatar plus name. `hint`
 * marks the `isSelf` entry in the menu; the trigger leaves it off, where the
 * caret already occupies the right edge.
 */
function personNode(person: Person, hint: boolean): ReactNode {
	return (
		<>
			<PersonAvatar name={person.name} />
			<span className="vf-icon-select-name">{person.name}</span>
			{hint && person.isSelf && <span className="vf-menu-hint">You</span>}
		</>
	);
}

/**
 * Assignee (§7.4 — exactly one) and the Project's Owner: the same control under
 * two names, differing only in what "nobody" is called.
 */
export function PersonSelect({
	people,
	value,
	onChange,
	noneLabel = "Unassigned",
}: {
	people: Person[];
	value: string | null;
	onChange: (value: string | null) => void;
	noneLabel?: string;
}) {
	const known = people.find((person) => person.id === value) ?? null;
	// Someone dropped from the register still has to show and stay selectable,
	// or opening the editor would silently drop the assignment. The id is all
	// that's left of them, so it stands in for the name.
	const unknownNode = value && !known && (
		<>
			<PersonAvatar name={value} />
			<span className="vf-icon-select-name">{value}</span>
			<span className="vf-menu-hint">unknown</span>
		</>
	);

	const rows: SelectRow[] = [
		{
			value: null,
			node: <span className="vf-icon-select-name">{noneLabel}</span>,
			search: noneLabel,
			className: "vf-menu-none",
			dividerAfter: true,
		},
		...people.map((person) => ({
			value: person.id,
			node: personNode(person, true),
			// Aliases (§5.5) match but don't show: they exist so `@mentions`
			// resolve, not as a second display name.
			search: [person.name, ...(person.aliases ?? [])].join(" "),
		})),
	];

	if (value && unknownNode) {
		rows.push({ value, node: unknownNode, search: value });
	}

	return (
		<SelectMenu
			rows={rows}
			value={value}
			onChange={onChange}
			searchPlaceholder="Search people…"
			trigger={
				known ? (
					personNode(known, false)
				) : unknownNode ? (
					unknownNode
				) : (
					<span className="vf-icon-select-name vf-prop-empty">{noneLabel}</span>
				)
			}
		/>
	);
}

export interface Option {
	value: string;
	label: string;
	/** Optional leading glyph — the Project picker passes the project's icon. */
	icon?: ReactNode;
}

/**
 * A picker over a plain list of named things (the task's Project). Same menu as
 * the taxonomy and person pickers so every row in the rail opens the same way.
 */
export function OptionSelect({
	options,
	value,
	onChange,
	noneLabel,
	searchPlaceholder,
}: {
	options: Option[];
	value: string | null;
	onChange: (value: string | null) => void;
	noneLabel: string;
	searchPlaceholder?: string;
}) {
	// A link pointing at something that no longer exists (or was renamed) stays
	// selectable rather than vanishing from the picker.
	const known = options.find((option) => option.value === value) ?? null;
	const unknown: Option | null =
		value && !known ? { value, label: value } : null;
	const selected = known ?? unknown;

	const optionNode = (option: Option) => (
		<>
			{option.icon}
			<span className="vf-icon-select-name">{option.label}</span>
		</>
	);

	const rows: SelectRow[] = [
		{
			value: null,
			node: <span className="vf-icon-select-name">{noneLabel}</span>,
			search: noneLabel,
			className: "vf-menu-none",
			dividerAfter: true,
		},
		...[...options, ...(unknown ? [unknown] : [])].map((option) => ({
			value: option.value,
			node: optionNode(option),
			search: option.label,
		})),
	];

	return (
		<SelectMenu
			rows={rows}
			value={value}
			onChange={onChange}
			searchPlaceholder={searchPlaceholder}
			trigger={
				selected ? (
					optionNode(selected)
				) : (
					<span className="vf-icon-select-name vf-prop-empty">{noneLabel}</span>
				)
			}
		/>
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
