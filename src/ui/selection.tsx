/**
 * The focus + selection model.
 *
 * This is deliberately one shared module rather than per-view hotkey handlers.
 * "Which task does this keystroke act on?" has to have a single answer that
 * works identically in List, Board, and every view added later — otherwise
 * every new view re-invents (and subtly breaks) keyboard navigation.
 *
 * The model:
 *   - `focused` is the one task a keystroke acts on. Exactly one, or none.
 * - `selected` is the multi-selection for bulk actions. Acting on a
 *     selection acts on all of it; acting with no selection acts on `focused`.
 *   - Views register their layout as **columns of paths**, not a flat list.
 *
 * That last point is what makes arrow keys behave. A board's tasks are laid out
 * in columns, so ↑/↓ has to walk down a column rather than through the view's
 * sort order — which interleaves columns and makes focus appear to teleport
 * sideways. A List view is simply the degenerate case: one column.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { Task } from "../core/types";

/** Visual layout: one array of task paths per column, in render order. */
export type FocusLayout = string[][];

export interface SelectionState {
	focusedPath: string | null;
	selectedPaths: string[];
}

export interface SelectionApi extends SelectionState {
	/** The visual layout the view is currently presenting. */
	setLayout: (layout: FocusLayout) => void;
	focus: (path: string | null) => void;
	/** Move within the focused column (↑/↓, k/j). */
	moveFocus: (delta: number) => void;
	/** Move between columns, holding the row position (←/→, h/l). */
	moveColumn: (delta: number) => void;
	/** Click semantics: plain = focus only, cmd = toggle, shift = range. */
	select: (path: string, modifiers?: { toggle?: boolean; range?: boolean }) => void;
	/** Toggle selection of the currently focused task (Spacebar). */
	toggleFocused: () => void;
	clearSelection: () => void;
	selectAll: () => void;
	isSelected: (path: string) => boolean;
	/** Tasks a command should act on: the selection, else the focused task. */
	targets: (tasks: Task[]) => Task[];
}

const SelectionCtx = createContext<SelectionApi | null>(null);

/** Where a path sits in the layout, or null if it isn't rendered. */
function locate(layout: FocusLayout, path: string | null): [number, number] | null {
	if (!path) return null;
	for (let column = 0; column < layout.length; column++) {
		const row = layout[column].indexOf(path);
		if (row !== -1) return [column, row];
	}
	return null;
}

function flatten(layout: FocusLayout): string[] {
	return layout.flat();
}

export function SelectionProvider({ children }: { children: ReactNode }) {
	const [focusedPath, setFocusedPath] = useState<string | null>(null);
	const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
	const layout = useRef<FocusLayout>([]);
	const anchor = useRef<string | null>(null);

	const setLayout = useCallback((next: FocusLayout) => {
		layout.current = next;
	}, []);

	const focus = useCallback((path: string | null) => {
		setFocusedPath(path);
		anchor.current = path;
	}, []);

	const moveFocus = useCallback((delta: number) => {
		const columns = layout.current;
		if (columns.length === 0) return;

		setFocusedPath((current) => {
			const at = locate(columns, current);

			// Arrowing with nothing focused enters from the appropriate end of
			// the first non-empty column.
			if (!at) {
				const column = columns.find((entries) => entries.length > 0);
				if (!column) return current;
				const next = delta > 0 ? column[0] : column[column.length - 1];
				anchor.current = next;
				return next;
			}

			const [columnIndex, row] = at;
			const column = columns[columnIndex];
			// Clamped, not wrapped: hitting the end of a column and jumping to
			// the top of the next one is disorienting on a board.
			const nextRow = Math.max(0, Math.min(column.length - 1, row + delta));
			anchor.current = column[nextRow];
			return column[nextRow];
		});
	}, []);

	const moveColumn = useCallback((delta: number) => {
		const columns = layout.current;
		if (columns.length <= 1) return;

		setFocusedPath((current) => {
			const at = locate(columns, current);
			if (!at) {
				const index = columns.findIndex((entries) => entries.length > 0);
				if (index === -1) return current;
				anchor.current = columns[index][0];
				return columns[index][0];
			}

			const [columnIndex, row] = at;

			// Skip empty columns rather than stalling on them — an empty status
			// column is a real drop target but nothing to focus.
			let next = columnIndex + delta;
			while (next >= 0 && next < columns.length && columns[next].length === 0) {
				next += delta;
			}
			if (next < 0 || next >= columns.length) return current;

			const column = columns[next];
			// Hold the row position where possible, the way a spreadsheet does.
			const path = column[Math.min(row, column.length - 1)];
			anchor.current = path;
			return path;
		});
	}, []);

	const select = useCallback(
		(path: string, modifiers?: { toggle?: boolean; range?: boolean }) => {
			// Range selection runs over the flattened layout, so shift-clicking
			// across two board columns selects everything between them in
			// reading order.
			const paths = flatten(layout.current);

			if (modifiers?.range && anchor.current) {
				const from = paths.indexOf(anchor.current);
				const to = paths.indexOf(path);
				if (from !== -1 && to !== -1) {
					const [lo, hi] = from < to ? [from, to] : [to, from];
					setSelectedPaths(paths.slice(lo, hi + 1));
					setFocusedPath(path);
					return;
				}
			}

			if (modifiers?.toggle) {
				setSelectedPaths((current) =>
					current.includes(path)
						? current.filter((p) => p !== path)
						: [...current, path],
				);
				setFocusedPath(path);
				anchor.current = path;
				return;
			}

			// A plain click moves focus and drops any multi-selection — matching
			// every list UI, and preventing a bulk action from silently applying
			// to a selection the user forgot about.
			setSelectedPaths([]);
			setFocusedPath(path);
			anchor.current = path;
		},
		[],
	);

	const clearSelection = useCallback(() => setSelectedPaths([]), []);
	const selectAll = useCallback(
		() => setSelectedPaths(flatten(layout.current)),
		[],
	);

	const toggleFocused = useCallback(() => {
		if (!focusedPath) return;
		setSelectedPaths((current) =>
			current.includes(focusedPath)
				? current.filter((p) => p !== focusedPath)
				: [...current, focusedPath],
		);
		// Keep anchor on the focused task so range selection still works from it.
		anchor.current = focusedPath;
	}, [focusedPath]);

	const api = useMemo<SelectionApi>(
		() => ({
			focusedPath,
			selectedPaths,
			setLayout,
			focus,
			moveFocus,
			moveColumn,
			select,
			toggleFocused,
			clearSelection,
			selectAll,
			isSelected: (path) => selectedPaths.includes(path),
			targets: (tasks) => {
				if (selectedPaths.length > 0) {
					return tasks.filter((task) => selectedPaths.includes(task.path));
				}
				const focused = tasks.find((task) => task.path === focusedPath);
				return focused ? [focused] : [];
			},
		}),
		[
			focusedPath,
			selectedPaths,
			setLayout,
			focus,
			moveFocus,
			moveColumn,
			select,
			toggleFocused,
			clearSelection,
			selectAll,
		],
	);

	return <SelectionCtx.Provider value={api}>{children}</SelectionCtx.Provider>;
}

export function useSelection(): SelectionApi {
	const value = useContext(SelectionCtx);
	if (!value) throw new Error("useSelection must be used inside <SelectionProvider>");
	return value;
}

/**
 * Register the view's current visual layout, so arrow keys and shift-ranges
 * work over exactly what the user can see — filtered, sorted, grouped, and in
 * the shape it's actually rendered in.
 */
export function useVisualLayout(layout: FocusLayout): void {
	const { setLayout } = useSelection();
	// Structural key: the layout array has a new identity every render, but its
	// contents only change when the view actually changes shape.
	const key = JSON.stringify(layout);
	useEffect(() => {
		setLayout(JSON.parse(key) as FocusLayout);
	}, [key, setLayout]);
}

/**
 * Scroll the focused item into view whenever focus moves.
 *
 * Needed specifically for `moveColumn` (h/l across board columns): the board
 * scrolls horizontally, and jumping focus to a column off-screen otherwise
 * leaves you staring at the old column with no clue anything happened.
 * `scrollIntoView({ block: "nearest", inline: "nearest" })` handles both the
 * board's horizontal scroll and a column's vertical scroll in one call, since
 * it walks every scrollable ancestor between the item and `container`.
 *
 * Looked up by `data-task-path` rather than tracked via refs — every card and
 * row already carries that attribute for the drag-and-drop hit-testing, so
 * this reuses it instead of threading a second mechanism through both views.
 */
export function useScrollFocusIntoView(
	container: HTMLElement | null,
): void {
	const { focusedPath } = useSelection();

	useEffect(() => {
		if (!container || !focusedPath) return;
		const items = container.querySelectorAll<HTMLElement>("[data-task-path]");
		for (const item of items) {
			if (item.dataset.taskPath === focusedPath) {
				item.scrollIntoView({ block: "nearest", inline: "nearest" });
				break;
			}
		}
	}, [container, focusedPath]);
}

export interface Shortcut {
	key: string;
	/** Cmd on macOS, Ctrl elsewhere. */
	mod?: boolean;
	shift?: boolean;
	run: (event: KeyboardEvent) => void;
}

/**
 * Bind view-scoped shortcuts.
 *
 * Anything global belongs in Obsidian's Command Palette instead, so it
 * can be rebound in Obsidian's own hotkey settings. These are the keys that
 * only make sense while a task list has focus.
 */
export function useShortcuts(
	container: HTMLElement | null,
	shortcuts: Shortcut[],
	/**
	 * Set false to suspend these bindings — used while the task editor is open.
	 * The shell's handler sits *below* the editor's on the bubble path, so
	 * without this an Escape meant for the editor would be swallowed here.
	 */
	enabled = true,
): void {
	const ref = useRef(shortcuts);
	ref.current = shortcuts;

	useEffect(() => {
		if (!container || !enabled) return;

		const handler = (event: KeyboardEvent) => {
			// Never steal keys from a field the user is typing into.
			const target = event.target as HTMLElement | null;
			if (
				target?.isContentEditable ||
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement
			) {
				return;
			}

			const mod = event.metaKey || event.ctrlKey;
			for (const shortcut of ref.current) {
				if (shortcut.key.toLowerCase() !== event.key.toLowerCase()) continue;
				if (Boolean(shortcut.mod) !== mod) continue;
				if (shortcut.shift !== undefined && shortcut.shift !== event.shiftKey) {
					continue;
				}
				event.preventDefault();
				event.stopPropagation();
				shortcut.run(event);
				return;
			}
		};

		container.addEventListener("keydown", handler);
		return () => container.removeEventListener("keydown", handler);
	}, [container]);
}
