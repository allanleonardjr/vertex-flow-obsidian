/**
 * A task picker whose options are the List-view row itself — status dot, id,
 * title, and the trailing meta cluster — rather than a bare "id · title" line.
 * Used for the Parent field and for adding relations, so choosing what a task
 * links to shows you what you're linking to.
 *
 * `extraOptions` carries non-task rows (the Parent field mixes in Projects).
 * `value` is whichever option is current — a task path or an extra value — and
 * gets the same tick a native `<select>` shows.
 *
 * The menu renders in a portal, anchored to the trigger: the editor rail is an
 * overflow-scroll container, and a menu this wide would otherwise be clipped.
 */

import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";
import { TaskRowContent } from "./TaskRow";

export interface TaskSelectExtraOption {
	value: string;
	label: ReactNode;
	/** Plain text this row matches against the search box. */
	search?: string;
}

const MARGIN = 8;
const MIN_W = 260;
const MIN_H = 180;

export function TaskSelectMenu({
	candidates,
	snapshot,
	taxonomies,
	value,
	onSelect,
	noneLabel,
	searchPlaceholder = "Search tasks…",
	extraOptions = [],
	trigger,
}: {
	candidates: Task[];
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	value: string | null;
	onSelect: (value: string | null) => void;
	noneLabel: string;
	searchPlaceholder?: string;
	extraOptions?: TaskSelectExtraOption[];
	trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
}) {
	const plugin = usePlugin();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const [size, setSize] = useState({
		w: plugin.settings.taskPickerWidth,
		h: plugin.settings.taskPickerHeight,
	});
	const anchorRef = useRef<HTMLSpanElement>(null);
	const resize = useRef<{
		edge: "left" | "right";
		startX: number;
		startY: number;
		startW: number;
		startH: number;
		startLeft: number;
	} | null>(null);

	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
	}, []);
	const toggle = () => (open ? close() : setOpen(true));
	const choose = (next: string | null) => {
		onSelect(next);
		close();
	};

	const beginResize =
		(edge: "left" | "right") => (event: ReactPointerEvent) => {
			if (!pos) return;
			event.preventDefault();
			resize.current = {
				edge,
				startX: event.clientX,
				startY: event.clientY,
				startW: size.w,
				startH: size.h,
				startLeft: pos.left,
			};
			(event.target as HTMLElement).setPointerCapture(event.pointerId);
		};

	const moveResize = (event: ReactPointerEvent) => {
		const s = resize.current;
		if (!s || !pos) return;
		const dx = event.clientX - s.startX;
		const h = Math.min(
			window.innerHeight - pos.top - MARGIN,
			Math.max(MIN_H, s.startH + (event.clientY - s.startY)),
		);

		if (s.edge === "right") {
			// Left edge fixed; grow right, then spill leftward once the viewport
			// edge is hit — so a picker pinned to the rail can still expand.
			const w = Math.max(
				MIN_W,
				Math.min(window.innerWidth - 2 * MARGIN, s.startW + dx),
			);
			const left = Math.max(
				MARGIN,
				Math.min(s.startLeft, window.innerWidth - w - MARGIN),
			);
			setSize({ w, h });
			setPos((p) => (p ? { ...p, left } : p));
		} else {
			// Right edge fixed; left edge follows the cursor.
			const right = s.startLeft + s.startW;
			const left = Math.min(
				right - MIN_W,
				Math.max(MARGIN, s.startLeft + dx),
			);
			setSize({ w: right - left, h });
			setPos((p) => (p ? { ...p, left } : p));
		}
	};

	const endResize = (event: ReactPointerEvent) => {
		if (!resize.current) return;
		resize.current = null;
		(event.target as HTMLElement).releasePointerCapture(event.pointerId);
		plugin.settings.taskPickerWidth = size.w;
		plugin.settings.taskPickerHeight = size.h;
		void plugin.saveSettings();
	};

	const place = useCallback(() => {
		const rect = anchorRef.current?.getBoundingClientRect();
		if (!rect) return;
		const width = Math.min(
			plugin.settings.taskPickerWidth,
			window.innerWidth - 2 * MARGIN,
		);
		const left = Math.min(
			Math.max(MARGIN, rect.right - width),
			window.innerWidth - width - MARGIN,
		);
		setPos({ top: rect.bottom + 4, left });
	}, [plugin]);

	useLayoutEffect(() => {
		if (!open) return;
		place();
		// Follow the anchor rather than close — the editor rail scrolls.
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		const onClick = () => close();
		const id = window.setTimeout(() => window.addEventListener("click", onClick));
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("click", onClick);
		};
	}, [open, place, close]);

	const needle = query.trim().toLowerCase();
	const shownExtras = useMemo(
		() =>
			needle
				? extraOptions.filter((o) =>
						(o.search ?? "").toLowerCase().includes(needle),
					)
				: extraOptions,
		[extraOptions, needle],
	);
	const shownTasks = useMemo(
		() =>
			needle
				? candidates.filter((t) =>
						`${t.id} ${t.title}`.toLowerCase().includes(needle),
					)
				: candidates,
		[candidates, needle],
	);
	const firstMatch = shownExtras[0]?.value ?? shownTasks[0]?.path ?? null;

	return (
		<span className="vf-task-select" ref={anchorRef}>
			{trigger({ open, toggle })}

			{open &&
				pos &&
				createPortal(
					<div
						className="vf-task-menu"
						style={{
							top: pos.top,
							left: pos.left,
							width: size.w,
							height: size.h,
						}}
						onClick={(event) => event.stopPropagation()}
					>
						<input
							autoFocus
							type="text"
							className="vf-input vf-task-menu-search"
							placeholder={searchPlaceholder}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && needle && firstMatch) {
									event.preventDefault();
									choose(firstMatch);
								} else if (event.key === "Escape") {
									event.preventDefault();
									close();
								}
							}}
						/>

						<div className="vf-task-menu-list" role="listbox">
							<button
								type="button"
								role="option"
								aria-selected={value == null}
								className={`vf-menu-item vf-menu-none${value == null ? " is-active" : ""}`}
								onClick={() => choose(null)}
							>
								{noneLabel}
							</button>

							<div className="vf-menu-divider" aria-hidden />

							{shownExtras.map((option) => (
								<button
									key={option.value}
									type="button"
									role="option"
									aria-selected={option.value === value}
									className={`vf-menu-item${option.value === value ? " is-active" : ""}`}
									onClick={() => choose(option.value)}
								>
									{option.label}
								</button>
							))}

							{shownTasks.map((task) => (
								<button
									key={task.path}
									type="button"
									role="option"
									aria-selected={task.path === value}
									className={`vf-menu-item vf-task-option${task.path === value ? " is-active" : ""}`}
									onClick={() => choose(task.path)}
								>
									<TaskRowContent
										task={task}
										snapshot={snapshot}
										taxonomies={taxonomies}
									/>
								</button>
							))}

							{shownExtras.length === 0 && shownTasks.length === 0 && (
								<p className="vf-task-menu-empty">No matches</p>
							)}
						</div>

						<div
							className="vf-task-menu-grip is-left"
							role="separator"
							aria-label="Resize"
							title="Drag to resize"
							onPointerDown={beginResize("left")}
							onPointerMove={moveResize}
							onPointerUp={endResize}
						/>
						<div
							className="vf-task-menu-grip is-right"
							role="separator"
							aria-label="Resize"
							title="Drag to resize"
							onPointerDown={beginResize("right")}
							onPointerMove={moveResize}
							onPointerUp={endResize}
						/>
					</div>,
					document.body,
				)}
		</span>
	);
}
