/**
 * The keyboard-driven taxonomy picker (§9.1 / B2): `s` Status, `p` Priority,
 * `l` Label, `t` Task Type on the focused task.
 *
 * A small portaled menu anchored to the focused row (found by `data-task-path`,
 * the same attribute drag-and-drop and scroll-into-view already use), falling
 * back to screen-centre. Arrow keys move the highlight, Enter picks, Esc /
 * click-away closes. Status / Priority / Type set-and-close; Label toggles the
 * picked value and closes.
 */

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { listValues, type WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Task } from "../../core/types";
import { usePlugin } from "../context";

export type QuickPickerKind = "status" | "priority" | "taskType" | "label";

const TITLE: Record<QuickPickerKind, string> = {
	status: "Set status",
	priority: "Set priority",
	taskType: "Set type",
	label: "Toggle label",
};

export function QuickTaxonomyPicker({
	task,
	kind,
	taxonomies,
	onClose,
}: {
	task: Task;
	kind: QuickPickerKind;
	taxonomies: WorkspaceTaxonomies;
	onClose: () => void;
}) {
	const plugin = usePlugin();
	const listRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

	const rows = useMemo(() => {
		const values = listValues(taxonomies[kind]).map((v) => ({
			id: v.id as string | null,
			name: v.name,
			color: v.color,
		}));
		// Priority and Type can be cleared; Status can't; Label is a toggle set.
		if (kind === "priority" || kind === "taskType") {
			return [{ id: null, name: "None", color: "" }, ...values];
		}
		return values;
	}, [taxonomies, kind]);

	const currentIds = useMemo<Set<string | null>>(() => {
		if (kind === "status") return new Set([task.status]);
		if (kind === "priority") return new Set([task.priority ?? null]);
		if (kind === "taskType") return new Set([task.taskType ?? null]);
		return new Set(task.labels);
	}, [kind, task]);

	const [active, setActive] = useState(() => {
		const at = rows.findIndex((r) => currentIds.has(r.id));
		return at === -1 ? 0 : at;
	});

	const place = useCallback(() => {
		const row = document.querySelector<HTMLElement>(
			`[data-task-path="${CSS.escape(task.path)}"]`,
		);
		if (row) {
			const rect = row.getBoundingClientRect();
			setPos({
				top: Math.min(rect.bottom + 4, window.innerHeight - 260),
				left: Math.min(rect.left + 24, window.innerWidth - 260),
			});
		} else {
			setPos({
				top: window.innerHeight / 2 - 120,
				left: window.innerWidth / 2 - 120,
			});
		}
	}, [task.path]);

	useLayoutEffect(() => {
		place();
		listRef.current?.focus();
		const onScroll = () => place();
		window.addEventListener("resize", onScroll);
		window.addEventListener("scroll", onScroll, true);
		const onClick = () => onClose();
		const id = window.setTimeout(() =>
			window.addEventListener("click", onClick),
		);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("resize", onScroll);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("click", onClick);
		};
	}, [place, onClose]);

	const choose = useCallback(
		(id: string | null) => {
			const m = plugin.mutations;
			if (kind === "status") {
				if (id) void m.setStatus(task, id);
			} else if (kind === "priority") {
				void m.setPriority(task, id);
			} else if (kind === "taskType") {
				void m.updateTask(task, { taskType: id ?? null });
			} else {
				const next = task.labels.includes(id as string)
					? task.labels.filter((l) => l !== id)
					: [...task.labels, id as string];
				void m.setLabels(task, next);
			}
			onClose();
		},
		[plugin, kind, task, onClose],
	);

	// Own the keyboard while open — window capture so it doesn't depend on the
	// list keeping DOM focus, and beats the shell's tab-closing Escape handler.
	const activeRef = useRef(active);
	activeRef.current = active;
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				setActive((a) => (a + 1) % rows.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				setActive((a) => (a - 1 + rows.length) % rows.length);
			} else if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				const row = rows[activeRef.current];
				if (row) choose(row.id);
			} else if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [rows, choose, onClose]);

	useEffect(() => {
		listRef.current
			?.querySelector<HTMLElement>("[data-highlighted='true']")
			?.scrollIntoView({ block: "nearest" });
	}, [active]);

	if (!pos) return null;

	return createPortal(
		<div
			className="vf-select-menu vf-quick-picker"
			style={{ top: pos.top, left: pos.left, width: 240, maxHeight: 260 }}
			onClick={(event) => event.stopPropagation()}
		>
			<div className="vf-quick-picker-title">{TITLE[kind]}</div>
			<div
				ref={listRef}
				className="vf-option-list vf-option-list-scroll"
				role="listbox"
				tabIndex={-1}
			>
				{rows.map((row, index) => (
					<button
						key={row.id ?? "__none__"}
						type="button"
						role="option"
						aria-selected={currentIds.has(row.id)}
						data-highlighted={index === active}
						className={[
							"vf-menu-item",
							currentIds.has(row.id) ? "is-active" : "",
							index === active ? "is-highlighted" : "",
						]
							.filter(Boolean)
							.join(" ")}
						onMouseEnter={() => setActive(index)}
						onClick={() => choose(row.id)}
					>
						<span
							className="vf-status-dot"
							style={row.color ? { background: row.color } : undefined}
							aria-hidden
						/>
						<span className="vf-icon-select-name">{row.name}</span>
					</button>
				))}
			</div>
		</div>,
		document.body,
	);
}
