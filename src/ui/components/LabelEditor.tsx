/**
 * The task editor's label control (§5.4).
 *
 * Labels are fluid: you don't pre-define them in Settings. The box is a
 * combobox rather than a plain search field — clicking it lists every label
 * the task doesn't already carry, so you can see what the workspace has before
 * inventing a near-duplicate ("Backend" vs "backend work"); typing filters that
 * list and offers to create what you typed. Attached labels stack below as
 * pills. Clicking a pill opens the Edit label dialog to rename/recolour it in
 * place; the `×` detaches it from this task.
 *
 * Enter with nothing highlighted still creates-or-attaches whatever is typed —
 * the arrow keys, not the first match, are what pick an existing label, so
 * typing a new name that happens to be a substring of an old one can't
 * silently attach the wrong thing.
 */

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { listValues } from "../../core/taxonomy";
import type { Taxonomy } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";
import { LabelDialog } from "../modals/LabelDialog";
import { LabelChip } from "./TaskBits";

export function LabelEditor({
	snapshot,
	taxonomy,
	value,
	onChange,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomy: Taxonomy;
	value: string[];
	onChange: (value: string[]) => void;
}) {
	const plugin = usePlugin();
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	// -1 is "nothing highlighted" — the state Enter treats as "create what I
	// typed". Arrowing into the list is what opts into picking an existing one.
	const [active, setActive] = useState(-1);
	const [editingId, setEditingId] = useState<string | null>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const byId = useMemo(
		() => new Map(taxonomy.values.map((v) => [v.id, v])),
		[taxonomy.values],
	);

	const all = useMemo(() => listValues(taxonomy), [taxonomy]);
	const needle = query.trim().toLowerCase();

	// Only labels this task doesn't already carry — the attached ones are the
	// pills right below, and offering them again would just be a no-op row.
	const available = useMemo(
		() => all.filter((v) => !value.includes(v.id)),
		[all, value],
	);
	const suggestions = useMemo(
		() =>
			needle
				? available.filter((v) => v.name.toLowerCase().includes(needle))
				: available,
		[available, needle],
	);

	const exactMatch = all.some((v) => v.name.trim().toLowerCase() === needle);
	const canCreate = needle.length > 0 && !exactMatch;
	const rowCount = suggestions.length + (canCreate ? 1 : 0);
	const activeIndex = Math.min(active, rowCount - 1);

	const editingLabel = editingId ? byId.get(editingId) : undefined;

	const close = () => {
		setOpen(false);
		setQuery("");
		setActive(-1);
	};

	// Adding several labels in a row is the common case, so the menu stays open
	// and focused after each pick — only an outside click or Escape closes it.
	const attach = (id: string) => {
		if (!value.includes(id)) onChange([...value, id]);
		setQuery("");
		setActive(-1);
		inputRef.current?.focus();
	};

	const commit = async () => {
		const name = query.trim();
		if (!name || busy) return;
		setBusy(true);
		try {
			const id = await plugin.mutations.addLabel(snapshot, name);
			if (!value.includes(id)) onChange([...value, id]);
			setQuery("");
			setActive(-1);
		} finally {
			setBusy(false);
			inputRef.current?.focus();
		}
	};

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!boxRef.current?.contains(event.target as Node)) close();
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	useEffect(() => {
		menuRef.current
			?.querySelector<HTMLElement>("[data-highlighted='true']")
			?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setOpen(true);
			if (rowCount === 0) return;
			setActive(
				event.key === "ArrowDown"
					? Math.min(activeIndex + 1, rowCount - 1)
					: Math.max(activeIndex - 1, -1),
			);
		} else if (event.key === "Enter") {
			event.preventDefault();
			const picked = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
			if (picked) attach(picked.id);
			else void commit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};

	const emptyNote = needle
		? exactMatch
			? "Already added"
			: null
		: all.length === 0
			? "No labels yet — type to create one"
			: "Every label is already added";

	return (
		<div className="vf-label-editor" ref={boxRef}>
			<div className="vf-label-editor-input">
				<input
					ref={inputRef}
					type="text"
					className="vf-input"
					placeholder="Add a label…"
					role="combobox"
					aria-expanded={open}
					value={query}
					aria-busy={busy}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(-1);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onBlur={(event) => {
						// Tabbing (or clicking) out of the control closes it; focus
						// moving within it — to the caret, a row, a pill — doesn't.
						if (!boxRef.current?.contains(event.relatedTarget)) close();
					}}
					onKeyDown={onKeyDown}
				/>

				<button
					type="button"
					className="vf-label-editor-caret"
					tabIndex={-1}
					aria-label="Show labels"
					onClick={() => {
						if (open) close();
						else {
							setOpen(true);
							inputRef.current?.focus();
						}
					}}
				>
					⌄
				</button>

				{open && (
					<div
						ref={menuRef}
						className="vf-label-editor-menu"
						role="listbox"
						onMouseDown={(event) => event.preventDefault()}
					>
						{suggestions.map((v, index) => (
							<button
								key={v.id}
								type="button"
								role="option"
								aria-selected={false}
								data-highlighted={index === activeIndex}
								className={`vf-menu-item${index === activeIndex ? " is-highlighted" : ""}`}
								onMouseEnter={() => setActive(index)}
								onClick={() => attach(v.id)}
							>
								<LabelChip name={v.name} color={v.color} />
							</button>
						))}

						{canCreate && (
							<button
								type="button"
								data-highlighted={activeIndex === suggestions.length}
								className={`vf-menu-item vf-label-editor-create${
									activeIndex === suggestions.length ? " is-highlighted" : ""
								}`}
								onMouseEnter={() => setActive(suggestions.length)}
								onClick={() => void commit()}
							>
								Create “{query.trim()}”
							</button>
						)}

						{rowCount === 0 && emptyNote && (
							<p className="vf-menu-empty">{emptyNote}</p>
						)}
					</div>
				)}
			</div>

			{value.length > 0 && (
				<div className="vf-label-editor-list">
					{value.map((id) => {
						const label = byId.get(id);
						const name = label?.name ?? id;
						return (
							<span key={id} className="vf-label-editor-row">
								<button
									type="button"
									className="vf-label-editor-chip"
									title={`Edit ${name}`}
									onClick={() => {
										close();
										setEditingId(id);
									}}
								>
									<LabelChip
										name={name}
										color={label?.color}
										className="vf-nav-chip"
									/>
								</button>
								<button
									type="button"
									className="vf-icon-button"
									title={`Remove ${name}`}
									onClick={() => onChange(value.filter((v) => v !== id))}
								>
									✕
								</button>
							</span>
						);
					})}
				</div>
			)}

			{editingLabel && (
				<LabelDialog
					title="Edit label"
					initialName={editingLabel.name}
					initialColor={editingLabel.color}
					confirmLabel="Save"
					onConfirm={(name, color) =>
						plugin.mutations.updateLabel(snapshot, editingLabel.id, {
							name,
							color,
						})
					}
					onClose={() => setEditingId(null)}
				/>
			)}
		</div>
	);
}
