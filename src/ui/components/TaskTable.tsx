/**
 * The Table view's grid — one row per task, one column per field.
 *
 * Presentation-only, mirroring `TaskList`'s seam: `TableView` owns
 * interaction (open-task, selection), this module just renders the headers
 * and rows it's given, and reuses `TaskListGroup`/`TaskListInteraction`
 * rather than inventing parallel shapes.
 *
 * Mandatory columns (status/id/title) are always first and always shown.
 * Every other visible `TaskField` follows, in `columnOrder` (falling back to
 * canonical `TASK_FIELDS` order).
 *
 * Cells are editable in place:
 *   - Title/Estimate/Start/Due click into a plain input (`EditableCell` +
 *     `useCellEditor`), committing on blur/Enter and reverting on Escape with
 *     no write — the same mutation shapes `QuickFieldPicker` uses.
 *   - Status/Priority/Type/Assignee/Project render the rail's own
 *     `*Select` components directly and permanently — they already own their
 *     open/close state and portal their menu, so a cell click IS the trigger
 *     click. These don't participate in `editingCell` below (only one thing
 *     to coordinate: the simple-field edit box), since each menu already
 *     closes itself on an outside click.
 *   - Labels renders a `SelectMenu` with `closeOnSelect={false}` so picking
 *     several labels in a row doesn't reopen the menu each time.
 *   - Relations keeps the read-only badge and adds a "+" opening the same
 *     three-kind `AddRelationTrigger` flow (with its cycle-guarded mutations)
 *     the task editor's Relations section uses.
 *   - Progress stays fully display-only — it's a computed rollup, never
 *     written anywhere in the app.
 */

import {
	Fragment,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
	ArrowDown,
	ArrowUp,
	GripVertical,
	Plus,
	SquareArrowOutUpRight,
} from "lucide-react";
import {
	scopeOf,
	subtaskProgress,
	type HierarchyScope,
} from "../../core/hierarchy";
import { listValues, type WorkspaceTaxonomies } from "../../core/taxonomy";
import { isCanceled, isCompleted } from "../../core/taxonomy";
import {
	TASK_FIELDS,
	emptyProgress,
	type SortField,
	type Task,
	type TableSortKey,
	type TaskField,
	type WorkspaceSnapshot,
} from "../../core/types";
import { nextTableSort } from "../../core/views";
import type { Mutations } from "../../obsidian/mutations";
import { usePlugin } from "../context";
import { reorderColumns, type ColumnDragState } from "../views/useColumnDrag";
import {
	DateField,
	NumberField,
	OptionSelect,
	PersonSelect,
	PrioritySelect,
	SelectMenu,
	StatusSelect,
	TypeSelect,
	type Option,
	type SelectRow,
} from "./fields";
import { Icon } from "./Icon";
import { AddRelationTrigger, RELATION_KINDS } from "./RelationsEditor";
import { ResizeHandle } from "./ResizeHandle";
import { LabelChip, PersonAvatar, PriorityIcon, RelationBadge } from "./TaskBits";
import type { TaskListGroup, TaskListInteraction } from "./TaskList";
import { displayTitle, TaskTitle } from "./TaskTitle";

type MandatoryColumn = "status" | "id" | "title";
type Column = MandatoryColumn | TaskField;

const MANDATORY_COLUMNS: readonly MandatoryColumn[] = ["status", "id", "title"];

function isMandatory(column: Column): column is MandatoryColumn {
	return (MANDATORY_COLUMNS as readonly Column[]).includes(column);
}

/** Reasonable starting widths (px) — title widest, dates/estimate narrow. */
const DEFAULT_WIDTH: Record<Column, number> = {
	status: 36,
	id: 90,
	title: 260,
	type: 110,
	project: 150,
	priority: 110,
	assignee: 90,
	labels: 170,
	estimate: 90,
	startDate: 110,
	dueDate: 110,
	progress: 90,
	relations: 130,
};

/** Per-column floor — no max-width cap (a Table hard non-goal). */
const MIN_WIDTH: Record<Column, number> = {
	status: 32,
	id: 60,
	title: 120,
	type: 70,
	project: 80,
	priority: 70,
	assignee: 60,
	labels: 80,
	estimate: 60,
	startDate: 70,
	dueDate: 70,
	progress: 60,
	relations: 70,
};

/** No max-width cap is a deliberate Table hard non-goal — this floor is generous by design. */
const NO_MAX_WIDTH = Number.MAX_SAFE_INTEGER;

/** Which `SortField` a column sorts by. Every column is sortable. */
const COLUMN_SORT_FIELD: Record<Column, SortField> = {
	status: "status",
	id: "id",
	title: "title",
	type: "taskType",
	project: "project",
	priority: "priority",
	assignee: "assignee",
	labels: "labels",
	estimate: "estimate",
	startDate: "startDate",
	dueDate: "dueDate",
	progress: "progress",
	relations: "relations",
};

const COLUMN_LABEL: Record<Column, string> = {
	status: "Status",
	id: "ID",
	title: "Title",
	type: "Type",
	project: "Project",
	priority: "Priority",
	assignee: "Assignee",
	labels: "Labels",
	estimate: "Estimate",
	startDate: "Start date",
	dueDate: "Due date",
	progress: "Progress",
	relations: "Relations",
};

/**
 * The non-mandatory columns to render, in display order. Exported so
 * `TableView` can feed the same reorderable set into `useColumnDrag` that
 * `TaskTable` renders — the two must always agree on what "index 2" means.
 */
export function orderedTaskFields(
	hiddenFields: readonly TaskField[] | undefined,
	columnOrder: readonly TaskField[] | undefined,
): TaskField[] {
	const hidden = new Set(hiddenFields ?? []);
	const visible = TASK_FIELDS.filter((field) => !hidden.has(field));
	const ordered = (columnOrder ?? []).filter((field) =>
		visible.includes(field),
	);
	const rest = visible.filter((field) => !ordered.includes(field));
	return [...ordered, ...rest];
}

/** Drag-to-reorder wiring, threaded down from `TableView`'s `useColumnDrag`. */
export interface TableColumnReorder {
	onPointerDown: (event: React.PointerEvent, column: TaskField) => void;
	isDragging: (column: TaskField) => boolean;
	/** A drag just ended — swallow the trailing click so the header doesn't also sort. */
	consumeDragClick: () => boolean;
	/** Live drag state, so a caller can float a preview of the column being moved. */
	drag: ColumnDragState | null;
}

export interface TaskTableProps {
	groups: TaskListGroup[];
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	/** Render group headers. Off for a flat, ungrouped table. */
	grouped?: boolean;
	interaction?: TaskListInteraction;
	onOpenTask?: (path: string) => void;
	/** Fields hidden from this view — mandatory columns are never in this list. */
	hiddenFields?: readonly TaskField[];
	/** Column order for the non-mandatory fields; absent/empty = canonical `TASK_FIELDS` order. */
	columnOrder?: TaskField[];
	tableSort: TableSortKey[];
	onSortChange: (next: TableSortKey[]) => void;
	/** Row/header stripe color, or absent for no striping. */
	tableStripe?: string;
	/** Placeholder inside an empty group. */
	emptyGroupLabel?: string;
	/** Column drag-to-reorder — omitted disables the drag handle entirely. */
	reorder?: TableColumnReorder;
	/** Per-column pixel widths, keyed by "status" | "id" | "title" | `TaskField`. */
	columnWidths?: Record<string, number>;
	/** Persists the full width map — furniture, writes straight through on drag-end. */
	onColumnWidthsChange?: (widths: Record<string, number>) => void;
}

/** Which single cell (task × column) is mid-edit — only one at a time. */
interface EditingCell {
	path: string;
	column: Column;
}

export function TaskTable({
	groups,
	snapshot,
	taxonomies,
	grouped = false,
	interaction,
	onOpenTask,
	hiddenFields,
	columnOrder,
	tableSort,
	onSortChange,
	tableStripe,
	emptyGroupLabel,
	reorder,
	columnWidths,
	onColumnWidthsChange,
}: TaskTableProps) {
	const plugin = usePlugin();
	const mutations = plugin.mutations;

	const fieldColumns = orderedTaskFields(hiddenFields, columnOrder);
	// While a drag is live, preview the other columns shuffling into the
	// gap — using the exact same `reorderColumns` the hook itself commits
	// on drop (Phase 3c), so this can never settle into an order different
	// from what actually gets saved.
	const liveFieldColumns = reorder?.drag
		? reorderColumns(
				fieldColumns,
				reorder.drag.column,
				reorder.drag.targetIndex,
			)
		: fieldColumns;
	const columns: Column[] = [...MANDATORY_COLUMNS, ...liveFieldColumns];
	const scope = scopeOf(snapshot);

	// Local width overrides during a live drag, so resizing feels immediate
	// even though `onColumnWidthsChange` writes to disk (async, and only
	// commits at drag-end) — same split `ResizeHandle`'s own contract expects.
	const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
	const widthFor = (column: Column) =>
		liveWidths[column] ?? columnWidths?.[column] ?? DEFAULT_WIDTH[column];

	// The one simple-field cell (Title/Estimate/Start/Due) currently swapped
	// into its input. Picker cells (Status/Priority/…) manage their own
	// open/close state independently — see the module doc.
	const [editingCell, setEditingCell] = useState<EditingCell | null>(null);

	const handleHeaderClick = (field: SortField, event: React.MouseEvent) => {
		onSortChange(nextTableSort(tableSort, field, event.shiftKey));
	};

	const commitWidth = (column: Column, value: number) => {
		setLiveWidths((widths) => ({ ...widths, [column]: value }));
		onColumnWidthsChange?.({
			...(columnWidths ?? {}),
			...liveWidths,
			[column]: value,
		});
	};

	const style = tableStripe
		? ({ "--vf-table-stripe": tableStripe } as CSSProperties)
		: undefined;

	// Two single-axis scroll containers, not one two-axis one: a shared
	// `overflow: auto` on both axes at once makes Chromium/Electron fall back
	// from an auto-hiding overlay scrollbar to a classic reserved-space one
	// (it can't cleanly render the corner where both bars would meet). The
	// outer container owns vertical scroll and is `position: sticky`'s
	// reference for the header track; the inner owns horizontal scroll for
	// the body. `position: sticky` can't cross the inner container's own
	// `overflow-x` boundary to reach the outer one (any ancestor `overflow`
	// besides `visible` becomes sticky's containing block), so the header
	// lives in its own non-scrolling, clipped track instead, and its
	// horizontal position is synced to the body's `scrollLeft` by hand.
	const scrollXRef = useRef<HTMLDivElement>(null);
	const headerRowRef = useRef<HTMLTableRowElement>(null);
	useEffect(() => {
		const scrollX = scrollXRef.current;
		const headerRow = headerRowRef.current;
		if (!scrollX || !headerRow) return;
		const sync = () => {
			headerRow.style.transform = `translateX(-${scrollX.scrollLeft}px)`;
		};
		sync();
		scrollX.addEventListener("scroll", sync);
		return () => scrollX.removeEventListener("scroll", sync);
	}, []);

	const colgroup = (
		<colgroup>
			<col style={{ width: 32 }} />
			{columns.map((column) => (
				<col key={column} style={{ width: widthFor(column) }} />
			))}
		</colgroup>
	);

	return (
		<div
			className={`vf-table-wrap${tableStripe ? " has-stripe" : ""}`}
			style={style}
		>
			<div className="vf-table-header-track">
				<table
					className="vf-table vf-table-header-table"
					style={{ tableLayout: "fixed" }}
				>
					{colgroup}
					<thead>
						<tr className="vf-table-header-row" ref={headerRowRef}>
							<th className="vf-table-th vf-table-th-open" aria-hidden />
							{columns.map((column) => (
								<TableHeaderCell
									key={column}
									column={column}
									tableSort={tableSort}
									onClick={handleHeaderClick}
									reorder={isMandatory(column) ? undefined : reorder}
									width={widthFor(column)}
									onResize={(next) =>
										setLiveWidths((widths) => ({ ...widths, [column]: next }))
									}
									onResizeEnd={(next) => commitWidth(column, next)}
								/>
							))}
						</tr>
					</thead>
				</table>
			</div>
			<div className="vf-table-scroll-x" ref={scrollXRef}>
				<table className="vf-table" style={{ tableLayout: "fixed" }}>
					{colgroup}
					<tbody>
						{groups.map((group) => (
							<Fragment key={group.key}>
								{grouped && group.label && (
									<tr className="vf-table-group-row">
										<td colSpan={columns.length + 1}>
											<span className="vf-table-group-label">
												{group.color && (
													<span
														className="vf-status-dot"
														style={{ backgroundColor: group.color }}
													/>
												)}
												<span>{group.label}</span>
												<span className="vf-count">{group.tasks.length}</span>
											</span>
										</td>
									</tr>
								)}
								{!group.collapsed &&
									(group.tasks.length === 0 && emptyGroupLabel ? (
										<tr className="vf-table-empty-row">
											<td colSpan={columns.length + 1}>{emptyGroupLabel}</td>
										</tr>
									) : (
										group.tasks.map((task) => (
											<TaskTableRow
												key={task.path}
												task={task}
												groupKey={group.key}
												columns={columns}
												snapshot={snapshot}
												taxonomies={taxonomies}
												scope={scope}
												interaction={interaction}
												onOpenTask={onOpenTask}
												mutations={mutations}
												editingCell={editingCell}
												setEditingCell={setEditingCell}
												reorder={reorder}
											/>
										))
									))}
							</Fragment>
						))}
					</tbody>
				</table>
			</div>
			{reorder?.drag && (
				<ColumnDragPreview
					drag={reorder.drag}
					groups={groups}
					snapshot={snapshot}
					taxonomies={taxonomies}
					scope={scope}
					mutations={mutations}
				/>
			)}
		</div>
	);
}

/**
 * The dragged column's header label plus its real cells, re-rendered via
 * `TableCell` (the exact function the live table uses — see the
 * module-level doc above `TaskTable` on why this reuses the renderer rather
 * than cloning DOM) and stacked at their real vertical offsets, capped by
 * the column's own header so the whole thing reads as one detached strip —
 * not just a column of values with no idea which field they belong to. The
 * whole slab tracks `targetLeft` — the exact spot dropping right now would
 * place it — rather than the raw pointer position, so it moves toward
 * wherever the column is actually headed (left when dragging left, right
 * when dragging right) instead of gliding under the cursor pixel-for-pixel.
 * It never moves vertically, so it reads as "this column is sliding into
 * place," not "this column got picked up."
 */
function ColumnDragPreview({
	drag,
	groups,
	snapshot,
	taxonomies,
	scope,
	mutations,
}: {
	drag: ColumnDragState;
	groups: TaskListGroup[];
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	scope: HierarchyScope;
	mutations: Mutations;
}) {
	const [rows, setRows] = useState<
		{ task: Task; top: number; height: number }[]
	>([]);
	const [header, setHeader] = useState<{ top: number; height: number } | null>(
		null,
	);
	// Which side of the gap the drop-line anchors to — see the comment on
	// `dropLineLeft` below.
	const prevXRef = useRef(drag.x);
	const directionRef = useRef<"left" | "right">("right");
	// Measure vertical positions once, at mount (i.e. once per drag) — see
	// the "measured once" note above. Re-running this on every pointer move
	// would re-query the DOM for every visible row on every frame, and
	// vertical positions don't change just because columns reorder
	// horizontally. `left`, below, is the one measurement that's genuinely
	// live — see its own comment for why.
	useEffect(() => {
		const visibleTasks = groups.flatMap((g) => (g.collapsed ? [] : g.tasks));
		const found = visibleTasks.flatMap((task) => {
			const el = document.querySelector<HTMLElement>(
				`[data-task-path="${CSS.escape(task.path)}"]`,
			);
			if (!el) return [];
			const rect = el.getBoundingClientRect();
			if (rect.bottom <= 0 || rect.top >= window.innerHeight) return [];
			return [{ task, top: rect.top, height: rect.height }];
		});
		setRows(found);

		// The real header cell, so its label can cap the preview and its own
		// height sets where the row stack starts — the header is always
		// above the topmost visible row, so it's the natural top edge rather
		// than a second thing to reconcile against `rows`. Reuses the same
		// `[data-column-key]` attribute `resolveIndex` already relies on for
		// drop-target resolution, which only headers carry.
		const headerEl = document.querySelector<HTMLElement>(
			`[data-column-key="${CSS.escape(drag.column)}"]`,
		);
		const headerRect = headerEl?.getBoundingClientRect() ?? null;
		setHeader(
			headerRect ? { top: headerRect.top, height: headerRect.height } : null,
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- measure once per drag (on mount), not on every re-render
	}, []);

	// `targetLeft` is where the drag would actually land right now — read
	// directly off the same `[data-column-key]` header elements
	// `resolveIndex` (in `useColumnDrag.ts`) uses to decide `targetIndex` in
	// the first place, rather than computed from a hand-summed total. Both
	// the sliding preview and the framing box below anchor to this one
	// value, so the ghost always sits exactly where dropping now would
	// place it — moving toward wherever the column is headed, not glued to
	// the raw pointer position — and the box can never disagree with it.
	const headers = [
		...document.querySelectorAll<HTMLElement>("[data-column-key]"),
	].filter((el) => el.dataset.columnKey !== drag.column);

	// Which side of the gap to read the boundary from: the trailing edge of
	// the column just settled coming from (dragging right) or the leading
	// edge of the one just settled going to (dragging left). The two land
	// on the same pixel in a contiguous table, but anchoring to whichever
	// column the drag is currently approaching means `targetLeft` always
	// matches a column that's actually finished settling.
	if (drag.x > prevXRef.current) directionRef.current = "right";
	else if (drag.x < prevXRef.current) directionRef.current = "left";
	prevXRef.current = drag.x;

	let targetLeft = 0;
	if (headers.length > 0) {
		if (drag.targetIndex <= 0) {
			targetLeft = headers[0].getBoundingClientRect().left;
		} else if (drag.targetIndex >= headers.length) {
			targetLeft = headers[headers.length - 1].getBoundingClientRect().right;
		} else if (directionRef.current === "right") {
			targetLeft = headers[drag.targetIndex].getBoundingClientRect().left;
		} else {
			targetLeft = headers[drag.targetIndex - 1].getBoundingClientRect().right;
		}
	}

	if (rows.length === 0) return null;

	// The header (when found) is always above every row, so it — not
	// `Math.min` over `rows` — is the preview's top edge; falling back to the
	// rows' own top keeps this from disappearing entirely in the unlikely
	// case the header element isn't found.
	const top = header ? header.top : Math.min(...rows.map((r) => r.top));
	const bottom = Math.max(...rows.map((r) => r.top + r.height));

	return createPortal(
		<>
			<div className="vf-drag-layer" aria-hidden>
				<div
					className="vf-column-drag-preview"
					style={{
						top,
						left: targetLeft,
						width: drag.width,
						height: bottom - top,
					}}
				>
					{header && (
						<div
							className="vf-column-drag-preview-header"
							style={{ top: header.top - top, height: header.height }}
						>
							{COLUMN_LABEL[drag.column]}
						</div>
					)}
					{rows.map(({ task, top: rowTop, height }) => (
						<div
							key={task.path}
							className="vf-column-drag-preview-cell"
							style={{ top: rowTop - top, height }}
						>
							<TableCell
								column={drag.column}
								task={task}
								snapshot={snapshot}
								taxonomies={taxonomies}
								scope={scope}
								mutations={mutations}
								projected={task.projected === true}
								editing={false}
								onStartEdit={() => {}}
								onDoneEditing={() => {}}
							/>
						</div>
					))}
				</div>
			</div>
			<div
				className="vf-column-drop-box"
				style={{
					top,
					left: targetLeft,
					width: drag.width,
					height: bottom - top,
				}}
				aria-hidden
			/>
		</>,
		document.body,
	);
}

function TableHeaderCell({
	column,
	tableSort,
	onClick,
	reorder,
	width,
	onResize,
	onResizeEnd,
}: {
	column: Column;
	tableSort: TableSortKey[];
	onClick: (field: SortField, event: React.MouseEvent) => void;
	/** Present only for a reorderable (non-mandatory) column. */
	reorder?: TableColumnReorder;
	width: number;
	onResize: (next: number) => void;
	onResizeEnd: (next: number) => void;
}) {
	const field = COLUMN_SORT_FIELD[column];
	const label = COLUMN_LABEL[column];
	const dragging = reorder?.isDragging(column as TaskField) ?? false;
	const className = [
		"vf-table-th",
		`vf-table-th-${column}`,
		dragging ? "is-dragging" : "",
	]
		.filter(Boolean)
		.join(" ");

	// Decorative only — the whole header cell is the drag target (see the
	// button's own `onPointerDown` below). This marks *which* columns move,
	// which is the one thing a whole-cell gesture can't communicate on its own.
	const handle = reorder && (
		<span className="vf-table-th-grip" aria-hidden>
			<GripVertical size={6} />
		</span>
	);

	const resizeHandle = (
		<ResizeHandle
			axis="x"
			value={width}
			min={MIN_WIDTH[column]}
			computeMax={() => NO_MAX_WIDTH}
			onResize={onResize}
			onResizeEnd={onResizeEnd}
			resetTo={DEFAULT_WIDTH[column]}
			className="vf-table-th-resize"
			title="Drag to resize — double-click to reset"
		/>
	);

	const index = tableSort.findIndex((key) => key.field === field);
	const active = index !== -1;
	const direction = active ? tableSort[index].direction : null;
	const ariaLabel = column === "status" ? "Status" : label;

	return (
		<th className={className} data-column-key={reorder ? column : undefined}>
			<div className="vf-table-th-inner">
				{handle}
				<button
					type="button"
					className={`vf-table-th-btn${active ? " is-active" : ""}`}
					aria-label={ariaLabel}
					title={reorder ? "Click to sort · drag to reorder" : "Click to sort"}
					onPointerDown={
						reorder
							? (event) => reorder.onPointerDown(event, column as TaskField)
							: undefined
					}
					onClick={(event) => {
						if (reorder?.consumeDragClick()) return;
						onClick(field, event);
					}}
				>
					{label && <span className="vf-table-th-label">{label}</span>}
					{active && (
						<span className="vf-table-th-sort" aria-hidden>
							{direction === "asc" ? (
								<ArrowUp size={11} />
							) : (
								<ArrowDown size={11} />
							)}
							{tableSort.length > 1 && (
								<span className="vf-table-th-rank">{index + 1}</span>
							)}
						</span>
					)}
				</button>
			</div>
			{resizeHandle}
		</th>
	);
}

function TaskTableRow({
	task,
	groupKey,
	columns,
	snapshot,
	taxonomies,
	scope,
	interaction,
	onOpenTask,
	mutations,
	editingCell,
	setEditingCell,
	reorder,
}: {
	task: Task;
	groupKey: string;
	columns: Column[];
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	scope: HierarchyScope;
	interaction?: TaskListInteraction;
	onOpenTask?: (path: string) => void;
	mutations: Mutations;
	editingCell: EditingCell | null;
	setEditingCell: (next: EditingCell | null) => void;
	reorder?: TableColumnReorder;
}) {
	const projected = task.projected === true;
	const openTarget = projected ? (task.recurringFrom ?? task.path) : task.path;

	const className = [
		"vf-table-row",
		!projected && interaction?.isFocused?.(task) ? "is-focused" : "",
		!projected && interaction?.isSelected?.(task) ? "is-selected" : "",
		task.archived ? "is-archived" : "",
		projected ? "is-projected" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<tr
			className={className}
			data-task-path={projected ? undefined : task.path}
			onPointerDown={
				projected
					? undefined
					: (event) => interaction?.onRowPointerDown?.(event, task, groupKey)
			}
			onClick={projected ? () => onOpenTask?.(openTarget) : undefined}
		>
			<td className="vf-table-td vf-table-td-open">
				{!projected && (
					<button
						type="button"
						className="vf-icon-button vf-table-open-btn"
						title={`Open "${displayTitle(task)}"`}
						aria-label={`Open "${displayTitle(task)}"`}
						onClick={(event) => {
							event.stopPropagation();
							interaction?.onRowClick
								? interaction.onRowClick(event, task)
								: onOpenTask?.(task.path);
						}}
					>
						<SquareArrowOutUpRight size={13} />
					</button>
				)}
			</td>
			{columns.map((column) => {
				const dragging = reorder?.isDragging(column as TaskField) ?? false;
				return (
					<td
						key={column}
						className={`vf-table-td vf-table-td-${column}${dragging ? " is-dragging" : ""}`}
					>
						<TableCell
							column={column}
							task={task}
							snapshot={snapshot}
							taxonomies={taxonomies}
							scope={scope}
							mutations={mutations}
							projected={projected}
							editing={
								!projected &&
								editingCell?.path === task.path &&
								editingCell.column === column
							}
							onStartEdit={() => {
								if (!projected) setEditingCell({ path: task.path, column });
							}}
							onDoneEditing={() => setEditingCell(null)}
						/>
					</td>
				);
			})}
		</tr>
	);
}

/**
 * Local edit-buffer state for one of the four simple fields, with a
 * cancel-safe commit: Escape marks the pending commit cancelled so a stray
 * `blur` fired while the input unmounts doesn't write anyway, and a
 * successful commit (blur or Enter) marks itself resolved too, so a trailing
 * blur after an Enter-commit can't double-write.
 *
 * The hook instance is mounted for the entire life of the row's cell (every
 * `TableCell` render calls it, editing or not), so `resolvedRef`/`value`
 * must reset at the start of each new edit session — otherwise the
 * first-commit guard leaks forever and every later commit is a no-op.
 */
function useCellEditor<T>(
	editing: boolean,
	initialValue: T,
	commitValue: (value: T) => void,
	onDone: () => void,
): {
	value: T;
	setValue: (value: T) => void;
	commitAndClose: () => void;
	cancel: () => void;
} {
	const [value, setValue] = useState(initialValue);
	const resolvedRef = useRef(false);

	useEffect(() => {
		if (editing) {
			resolvedRef.current = false;
			setValue(initialValue);
		}
	}, [editing]);

	const commitAndClose = () => {
		if (resolvedRef.current) return;
		resolvedRef.current = true;
		commitValue(value);
		onDone();
	};

	const cancel = () => {
		resolvedRef.current = true;
		onDone();
	};

	return { value, setValue, commitAndClose, cancel };
}

/**
 * The shell every simple-field cell shares: static display text (a button,
 * so it's keyboard-reachable) until clicked, then the field's own editor.
 */
function EditableCell({
	editing,
	onStartEdit,
	display,
	editor,
}: {
	editing: boolean;
	onStartEdit: () => void;
	display: ReactNode;
	editor: ReactNode;
}) {
	if (editing) return <>{editor}</>;
	return (
		<button
			type="button"
			className="vf-table-cell-edit-trigger"
			onClick={onStartEdit}
		>
			{display ?? <span className="vf-table-cell-empty">—</span>}
		</button>
	);
}

interface CellEditProps {
	editing: boolean;
	onStartEdit: () => void;
	onDoneEditing: () => void;
}

function TableTitleCell({
	task,
	mutations,
	editing,
	onStartEdit,
	onDoneEditing,
}: { task: Task; mutations: Mutations } & CellEditProps) {
	const editor = useCellEditor(
		editing,
		task.title,
		(next) => void mutations.updateTask(task, { title: next.trim() }),
		onDoneEditing,
	);

	return (
		<EditableCell
			editing={editing}
			onStartEdit={onStartEdit}
			display={
				<span className="vf-row-title">
					{task.parent && (
						<span className="vf-subtask-marker" title="Sub-task">
							↳
						</span>
					)}
					<TaskTitle task={task} />
				</span>
			}
			editor={
				<input
					autoFocus
					className="vf-input"
					value={editor.value}
					onChange={(event) => editor.setValue(event.target.value)}
					onBlur={editor.commitAndClose}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							editor.commitAndClose();
						} else if (event.key === "Escape") {
							event.preventDefault();
							editor.cancel();
						}
					}}
				/>
			}
		/>
	);
}

function TableEstimateCell({
	task,
	unitLabel,
	mutations,
	editing,
	onStartEdit,
	onDoneEditing,
}: {
	task: Task;
	unitLabel?: string | null;
	mutations: Mutations;
} & CellEditProps) {
	const editor = useCellEditor(
		editing,
		task.estimate,
		(next) => void mutations.updateTask(task, { estimate: next }),
		onDoneEditing,
	);
	const suffix = unitLabel?.trim();

	return (
		<EditableCell
			editing={editing}
			onStartEdit={onStartEdit}
			display={
				task.estimate == null ? null : (
					<span
						className="vf-table-cell-text"
						title={`Estimate: ${task.estimate}${suffix ? ` ${suffix}` : ""}`}
					>
						{task.estimate}
						{suffix ? ` ${suffix}` : ""}
					</span>
				)
			}
			editor={
				<div
					onBlur={editor.commitAndClose}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							editor.commitAndClose();
						} else if (event.key === "Escape") {
							event.preventDefault();
							editor.cancel();
						}
					}}
				>
					<NumberField
						value={editor.value}
						onChange={editor.setValue}
						placeholder={unitLabel ?? "—"}
					/>
				</div>
			}
		/>
	);
}

function TableStartDateCell({
	task,
	mutations,
	editing,
	onStartEdit,
	onDoneEditing,
}: { task: Task; mutations: Mutations } & CellEditProps) {
	const editor = useCellEditor(
		editing,
		task.startDate,
		(next) => void mutations.updateTask(task, { startDate: next }),
		onDoneEditing,
	);

	return (
		<EditableCell
			editing={editing}
			onStartEdit={onStartEdit}
			display={
				!task.startDate ? null : (
					<span
						className="vf-table-cell-text"
						title={`Starts ${task.startDate}`}
					>
						{task.startDate}
					</span>
				)
			}
			editor={
				<div
					onBlur={editor.commitAndClose}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							editor.commitAndClose();
						} else if (event.key === "Escape") {
							event.preventDefault();
							editor.cancel();
						}
					}}
				>
					<DateField value={editor.value} onChange={editor.setValue} />
				</div>
			}
		/>
	);
}

/** Due-date today/overdue treatment matches `DueDate` — computed off the taxonomy, not `task.archived` alone. */
function dueDateIsOverdueOrToday(
	task: Task,
	statuses: WorkspaceTaxonomies["status"],
): { isToday: boolean; isOverdue: boolean } {
	if (!task.dueDate) return { isToday: false, isOverdue: false };
	const today = new Date().toISOString().slice(0, 10);
	const isOpen =
		!isCompleted(statuses, task.status) && !isCanceled(statuses, task.status);
	return {
		isToday: task.dueDate === today && isOpen,
		isOverdue: task.dueDate < today && isOpen,
	};
}

function TableDueDateCell({
	task,
	statuses,
	mutations,
	editing,
	onStartEdit,
	onDoneEditing,
}: {
	task: Task;
	statuses: WorkspaceTaxonomies["status"];
	mutations: Mutations;
} & CellEditProps) {
	const editor = useCellEditor(
		editing,
		task.dueDate,
		(next) => void mutations.updateTask(task, { dueDate: next }),
		onDoneEditing,
	);
	const { isToday, isOverdue } = dueDateIsOverdueOrToday(task, statuses);

	return (
		<EditableCell
			editing={editing}
			onStartEdit={onStartEdit}
			display={
				!task.dueDate ? null : (
					<span
						className={`vf-table-cell-text${isToday ? " is-today" : ""}${
							isOverdue ? " is-overdue" : ""
						}`}
					>
						{task.dueDate}
					</span>
				)
			}
			editor={
				<div
					onBlur={editor.commitAndClose}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							editor.commitAndClose();
						} else if (event.key === "Escape") {
							event.preventDefault();
							editor.cancel();
						}
					}}
				>
					<DateField value={editor.value} onChange={editor.setValue} />
				</div>
			}
		/>
	);
}

/** Plain-text sub-task rollup — computed, display-only, never an edit target. */
function TableProgressCell({
	progress,
}: {
	progress: ReturnType<typeof emptyProgress>;
}) {
	if (progress.total === 0) return null;
	return (
		<span className="vf-table-cell-text">
			{progress.completed}/{progress.total}
		</span>
	);
}

/**
 * The Relations cell: the existing read-only badge, plus a "+" that opens a
 * compact, portaled chooser for the three relation kinds — each row is the
 * exact `AddRelationTrigger` the task editor's Relations section uses,
 * cycle-guards and all.
 */
function TableRelationsCell({
	task,
	snapshot,
	taxonomies,
	mutations,
}: {
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	mutations: Mutations;
}) {
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const anchorRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const place = () => {
			const rect = anchorRef.current?.getBoundingClientRect();
			if (!rect) return;
			setPos({
				top: rect.bottom + 4,
				left: Math.min(rect.left, window.innerWidth - 220),
			});
		};
		place();
		const close = () => setOpen(false);
		const id = window.setTimeout(() => window.addEventListener("click", close));
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("click", close);
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open]);

	const others = snapshot.tasks.filter(
		(candidate) => candidate.path !== task.path,
	);

	// `addDependency` throws (after showing its own Notice) when the pick would
	// create a cycle — that's its cycle-guard's only signal, not a bug to
	// surface again here, so the rejection is swallowed rather than reimplementing
	// or bypassing the check.
	const onAddFor =
		(key: (typeof RELATION_KINDS)[number]["key"]) => (path: string) => {
			const target = snapshot.tasks.find((t) => t.path === path);
			if (!target) return;
			if (key === "blocks") {
				void mutations.addDependency(task, target).catch(() => {});
			} else if (key === "blockedBy") {
				void mutations.addDependency(target, task).catch(() => {});
			} else {
				void mutations.addRelated(task, target).catch(() => {});
			}
			setOpen(false);
		};

	return (
		<span className="vf-table-relations-cell">
			<RelationBadge task={task} />
			<button
				ref={anchorRef}
				type="button"
				className="vf-icon-button vf-table-relations-add"
				title="Add relation"
				aria-label="Add relation"
				onClick={(event) => {
					event.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				<Plus size={12} />
			</button>
			{open &&
				pos &&
				createPortal(
					<div
						className="vf-table-relations-menu"
						style={{ top: pos.top, left: pos.left }}
						onClick={(event) => event.stopPropagation()}
					>
						{RELATION_KINDS.map(({ key, label }) => {
							const current = task.relations?.[key] || [];
							return (
								<AddRelationTrigger
									key={key}
									label={label}
									candidates={others.filter(
										(candidate) => !current.includes(candidate.path),
									)}
									snapshot={snapshot}
									taxonomies={taxonomies}
									onAdd={onAddFor(key)}
								/>
							);
						})}
					</div>,
					document.body,
				)}
		</span>
	);
}

/**
 * The read-only face a projected (ghost) row shows for every column — the
 * same value-presentation each interactive cell already renders at rest
 * (status dot + name, priority glyph + name, the project's icon + title,
 * the assignee's avatar + name, label chips, `RelationBadge` alone), just
 * never wrapped in a picker, `SelectMenu`, or the "+" quick-add trigger. A
 * synthesized occurrence has no real note to write to, so nothing here is
 * clickable — see `TaskTableRow`'s own `projected` branch for the row-level
 * open action that replaces per-cell interaction entirely.
 */
function TableCellStatic({
	column,
	task,
	snapshot,
	taxonomies,
	scope,
}: {
	column: Column;
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	scope: HierarchyScope;
}): ReactNode {
	switch (column) {
		case "status": {
			const entry =
				taxonomies.status.values.find((v) => v.id === task.status) ?? null;
			return (
				<span className="vf-table-cell-static">
					<span
						className="vf-status-dot"
						style={entry?.color ? { background: entry.color } : undefined}
						aria-hidden
					/>
					<span className="vf-icon-select-name">{entry ? entry.name : "—"}</span>
				</span>
			);
		}
		case "id":
			return <span className="vf-id">{task.id}</span>;
		case "title":
			return (
				<span className="vf-row-title">
					{task.parent && (
						<span className="vf-subtask-marker" title="Sub-task">
							↳
						</span>
					)}
					<TaskTitle task={task} />
				</span>
			);
		case "type": {
			const entry =
				taxonomies.taskType.values.find((v) => v.id === task.taskType) ?? null;
			return entry ? (
				<LabelChip
					name={entry.name}
					color={entry.color}
					className="vf-label-chip--bordered"
				/>
			) : (
				<span className="vf-icon-select-name vf-prop-empty">None</span>
			);
		}
		case "project": {
			if (!task.project) {
				return (
					<span className="vf-icon-select-name vf-prop-empty">No project</span>
				);
			}
			const project = snapshot.projects.find((p) => p.path === task.project);
			return (
				<span className="vf-table-cell-static">
					<Icon id={project?.icon} fallback="folder" size={13} />
					<span className="vf-icon-select-name">
						{project?.title ?? task.project}
					</span>
				</span>
			);
		}
		case "priority": {
			const ordered = listValues(taxonomies.priority);
			const entry = task.priority
				? (ordered.find((v) => v.id === task.priority) ?? null)
				: null;
			const index = entry
				? ordered.findIndex((v) => v.id === entry.id)
				: -1;
			return (
				<span className="vf-table-cell-static">
					<PriorityIcon
						index={index}
						count={ordered.length}
						color={entry?.color}
						name={entry?.name}
					/>
					<span className="vf-icon-select-name">{entry?.name ?? "None"}</span>
				</span>
			);
		}
		case "assignee": {
			if (!task.assignee) {
				return (
					<span className="vf-icon-select-name vf-prop-empty">Unassigned</span>
				);
			}
			const person = snapshot.workspace.people.find(
				(p) => p.id === task.assignee,
			);
			return (
				<span className="vf-table-cell-static">
					<PersonAvatar name={person?.name ?? task.assignee} />
					<span className="vf-icon-select-name">
						{person?.name ?? task.assignee}
					</span>
				</span>
			);
		}
		case "labels": {
			if (task.labels.length === 0) return null;
			return (
				<span className="vf-labels">
					{task.labels.map((id) => {
						const v = taxonomies.label.values.find((x) => x.id === id);
						return v ? (
							<LabelChip key={id} name={v.name} color={v.color} />
						) : null;
					})}
				</span>
			);
		}
		case "estimate": {
			if (task.estimate == null) return null;
			const suffix = snapshot.workspace.estimateUnitLabel?.trim();
			return (
				<span
					className="vf-table-cell-text"
					title={`Estimate: ${task.estimate}${suffix ? ` ${suffix}` : ""}`}
				>
					{task.estimate}
					{suffix ? ` ${suffix}` : ""}
				</span>
			);
		}
		case "startDate":
			if (!task.startDate) return null;
			return (
				<span className="vf-table-cell-text" title={`Starts ${task.startDate}`}>
					{task.startDate}
				</span>
			);
		case "dueDate": {
			if (!task.dueDate) return null;
			const { isToday, isOverdue } = dueDateIsOverdueOrToday(
				task,
				taxonomies.status,
			);
			return (
				<span
					className={`vf-table-cell-text${isToday ? " is-today" : ""}${
						isOverdue ? " is-overdue" : ""
					}`}
				>
					{task.dueDate}
				</span>
			);
		}
		case "progress": {
			const progress = subtaskProgress(scope, task, taxonomies.status);
			return <TableProgressCell progress={progress} />;
		}
		case "relations":
			return <RelationBadge task={task} />;
	}
}

function TableCell({
	column,
	task,
	snapshot,
	taxonomies,
	scope,
	mutations,
	projected,
	editing,
	onStartEdit,
	onDoneEditing,
}: {
	column: Column;
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	scope: HierarchyScope;
	mutations: Mutations;
	projected: boolean;
	editing: boolean;
	onStartEdit: () => void;
	onDoneEditing: () => void;
}): ReactNode {
	if (projected) {
		return (
			<TableCellStatic
				column={column}
				task={task}
				snapshot={snapshot}
				taxonomies={taxonomies}
				scope={scope}
			/>
		);
	}

	switch (column) {
		case "status":
			return (
				<StatusSelect
					taxonomy={taxonomies.status}
					value={task.status}
					onChange={(status) =>
						status && void mutations.setStatus(task, status)
					}
				/>
			);
		case "id":
			return <span className="vf-id">{task.id}</span>;
		case "title":
			return (
				<TableTitleCell
					task={task}
					mutations={mutations}
					editing={editing}
					onStartEdit={onStartEdit}
					onDoneEditing={onDoneEditing}
				/>
			);
		case "type":
			return (
				<TypeSelect
					taxonomy={taxonomies.taskType}
					value={task.taskType}
					onChange={(taskType) => void mutations.updateTask(task, { taskType })}
				/>
			);
		case "project": {
			const options: Option[] = snapshot.projects
				.map((project) => ({
					value: project.path,
					label: project.title,
					icon: <Icon id={project.icon} fallback="folder" size={13} />,
				}))
				.sort((a, b) => a.label.localeCompare(b.label));
			return (
				<OptionSelect
					options={options}
					value={task.project}
					onChange={(project) => void mutations.setProject(task, project)}
					noneLabel="No project"
					searchPlaceholder="Search projects…"
				/>
			);
		}
		case "priority":
			return (
				<PrioritySelect
					taxonomy={taxonomies.priority}
					value={task.priority}
					onChange={(priority) => void mutations.setPriority(task, priority)}
				/>
			);
		case "assignee":
			return (
				<PersonSelect
					people={snapshot.workspace.people}
					value={task.assignee}
					onChange={(assignee) => void mutations.setAssignee(task, assignee)}
				/>
			);
		case "labels": {
			const rows: SelectRow[] = listValues(taxonomies.label).map((v) => ({
				value: v.id,
				node: <LabelChip name={v.name} color={v.color} />,
				search: v.name,
				className: task.labels.includes(v.id) ? "is-active" : undefined,
			}));
			return (
				<SelectMenu
					rows={rows}
					value={null}
					closeOnSelect={false}
					onChange={(id) => {
						if (!id) return;
						const next = task.labels.includes(id)
							? task.labels.filter((l) => l !== id)
							: [...task.labels, id];
						void mutations.setLabels(task, next);
					}}
					trigger={
						task.labels.length > 0 ? (
							<span className="vf-labels">
								{task.labels.map((id) => {
									const v = taxonomies.label.values.find((x) => x.id === id);
									return v ? (
										<LabelChip key={id} name={v.name} color={v.color} />
									) : null;
								})}
							</span>
						) : (
							<span className="vf-icon-select-name vf-prop-empty">None</span>
						)
					}
				/>
			);
		}
		case "estimate":
			return (
				<TableEstimateCell
					task={task}
					unitLabel={snapshot.workspace.estimateUnitLabel}
					mutations={mutations}
					editing={editing}
					onStartEdit={onStartEdit}
					onDoneEditing={onDoneEditing}
				/>
			);
		case "startDate":
			return (
				<TableStartDateCell
					task={task}
					mutations={mutations}
					editing={editing}
					onStartEdit={onStartEdit}
					onDoneEditing={onDoneEditing}
				/>
			);
		case "dueDate":
			return (
				<TableDueDateCell
					task={task}
					statuses={taxonomies.status}
					mutations={mutations}
					editing={editing}
					onStartEdit={onStartEdit}
					onDoneEditing={onDoneEditing}
				/>
			);
		case "progress": {
			const progress = subtaskProgress(scope, task, taxonomies.status);
			return <TableProgressCell progress={progress} />;
		}
		case "relations":
			return (
				<TableRelationsCell
					task={task}
					snapshot={snapshot}
					taxonomies={taxonomies}
					mutations={mutations}
				/>
			);
	}
}
