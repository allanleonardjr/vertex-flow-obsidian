/**
 * The keyboard-driven field editor (B2): `u <key>` on the focused task.
 *
 * One shell for every field a task has:
 *   - **Menu fields** (status, priority, type, label, assignee, parent,
 *     project) open a portaled list of options anchored to the focused row
 *     (found by `data-task-path`, the same attribute drag-and-drop and
 *     scroll-into-view already use), falling back to screen-centre. Arrow keys
 *     move the highlight, Enter picks, Esc / click-away closes. Set-and-close
 *     except Label, which toggles.
 *   - **Input fields** (estimate, dates) open a small field with a native
 *     input; Enter commits, Esc closes without changing.
 *
 * A `tasks` list enables batch mode: the anchor task drives the highlighted
 * row and initial values, but every mutation applies to the full selection via
 * `bulkUpdate`. Labels are additive across the batch — picking a label adds
 * it to tasks that don't carry it; re-picking removes it. The depth-nudge
 * nudge is skipped in batch mode (a deliberate multi-task edit already
 * implies intent).
 *
 * Labels support create-on-attach: the type-ahead input below the label list
 * calls `addLabel` (attach-or-create) before toggling — matching the rail's
 * LabelEditor behaviour.
 */

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
	depthUnder,
	descendantTasks,
	MAX_COMFORTABLE_DEPTH,
	scopeOf,
} from "../../core/hierarchy";
import { listValues, type WorkspaceTaxonomies } from "../../core/taxonomy";
import type { LinkTarget, Task, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { Icon } from "../components/Icon";
import { PersonAvatar, StatusDot } from "../components/TaskBits";

export type QuickPickerKind =
	| "status"
	| "priority"
	| "taskType"
	| "label"
	| "assignee"
	| "parent"
	| "project"
	| "estimate"
	| "startDate"
	| "dueDate";

/** Kinds whose body is a native input rather than an options list. */
const INPUT_KINDS: ReadonlySet<QuickPickerKind> = new Set([
	"estimate",
	"startDate",
	"dueDate",
]);

const TITLE: Record<QuickPickerKind, string> = {
	status: "Set status",
	priority: "Set priority",
	taskType: "Set type",
	label: "Toggle label",
	assignee: "Assign",
	parent: "Set parent",
	project: "Set project",
	estimate: "Set estimate",
	startDate: "Set start date",
	dueDate: "Set due date",
};

interface Row {
	id: string | null;
	name: string;
	/** Overrides the default status dot (avatar, project icon…). */
	leading?: ReactNode;
	/** Thin secondary line, e.g. a task's `TSK-0104` id. */
	detail?: ReactNode;
	color?: string;
}

export function QuickFieldPicker({
	task,
	tasks: tasksProp,
	kind,
	snapshot,
	taxonomies,
	onClose,
}: {
	task: Task;
	/** The selection targets to apply to — defaults to `[task]`. */
	tasks?: Task[];
	kind: QuickPickerKind;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	onClose: () => void;
}) {
	const plugin = usePlugin();
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const labelInputRef = useRef<HTMLInputElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

	const isInput = INPUT_KINDS.has(kind);
	const batch = tasksProp ?? [task];

	// Type-ahead for the label branch's create-on-attach.
	const [newLabelName, setNewLabelName] = useState("");

	const createAndAttach = useCallback(
		async (name: string) => {
			const id = await plugin.mutations.addLabel(snapshot, name);
			if (batch.length > 1) {
				await Promise.all(
					batch.map((t) => {
						const next = t.labels.includes(id)
							? t.labels
							: [...t.labels, id];
						return plugin.mutations.setLabels(t, next);
					}),
				);
			} else {
				const next = task.labels.includes(id)
					? task.labels
					: [...task.labels, id];
				await plugin.mutations.setLabels(task, next);
			}
			onClose();
		},
		[plugin, snapshot, batch, task, onClose],
	);

	// A parent picked past MAX_COMFORTABLE_DEPTH waits on a "move anyway?"
	// nudge. Kept in a ref so the window listeners stay stable while it's up.
	const [confirmParent, setConfirmParent] = useState<LinkTarget | null>(null);
	const confirmRef = useRef(confirmParent);
	confirmRef.current = confirmParent;

	const rows = useMemo<Row[]>(() => {
		if (kind === "status") {
			return listValues(taxonomies.status).map((v) => ({
				id: v.id,
				name: v.name,
				color: v.color,
			}));
		}
		if (kind === "priority" || kind === "taskType") {
			const values = listValues(taxonomies[kind]).map((v) => ({
				id: v.id as string | null,
				name: v.name,
				color: v.color,
			}));
			return [{ id: null, name: "None" }, ...values];
		}
		if (kind === "label") {
			return listValues(taxonomies.label).map((v) => ({
				id: v.id,
				name: v.name,
				color: v.color,
			}));
		}
		if (kind === "assignee") {
			const people = snapshot.workspace.people;
			const unknown =
				task.assignee && !people.some((p) => p.id === task.assignee)
					? [
							{
								id: task.assignee,
								name: task.assignee,
								leading: <PersonAvatar name={task.assignee} />,
							},
						]
					: [];
			return [
				{ id: null, name: "Unassigned" },
				...people.map((person) => ({
					id: person.id,
					name: person.name,
					leading: <PersonAvatar name={person.name} />,
				})),
				...unknown,
			];
		}
		if (kind === "parent") {
			const blocked = new Set(
				descendantTasks(scopeOf(snapshot), task.path).map((t) => t.path),
			);
			const candidates = snapshot.tasks.filter(
				(candidate) =>
					candidate.path !== task.path && !blocked.has(candidate.path),
			);
			return [
				{ id: null, name: "No parent" },
				...candidates.map((candidate) => ({
					id: candidate.path,
					name: candidate.title,
					leading: (
						<StatusDot taxonomies={taxonomies} status={candidate.status} />
					),
					detail: <span className="vf-id">{candidate.id}</span>,
				})),
			];
		}
		// project
		const options = snapshot.projects
			.map((project) => ({
				id: project.path,
				name: project.title,
				leading: (
					<Icon id={project.icon} fallback="folder" size={13} />
				),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		const unknown =
			task.project && !snapshot.projects.some((p) => p.path === task.project)
				? [{ id: task.project, name: task.project }]
				: [];
		return [{ id: null, name: "No project" }, ...options, ...unknown];
	}, [kind, snapshot, task, taxonomies]);

	const currentIds = useMemo<Set<string | null>>(() => {
		if (kind === "status") return new Set([task.status]);
		if (kind === "priority") return new Set([task.priority ?? null]);
		if (kind === "taskType") return new Set([task.taskType ?? null]);
		if (kind === "label") return new Set(task.labels);
		if (kind === "assignee") return new Set([task.assignee ?? null]);
		if (kind === "parent") return new Set([task.parent ?? null]);
		return new Set([task.project ?? null]);
	}, [kind, task]);

	const [active, setActive] = useState(() => {
		const at = rows.findIndex((r) => currentIds.has(r.id));
		return at === -1 ? 0 : at;
	});
	// Rows rebuild every snapshot, so re-seat the highlight — but only when the
	// current pick is missing rather than resetting to the top on every snap.
	useEffect(() => {
		setActive((prev) =>
			prev >= rows.length ? Math.max(rows.length - 1, 0) : prev,
		);
	}, [rows.length]);

	// Estimate / date field being edited.
	const [value, setValue] = useState(() => {
		if (kind === "estimate") return task.estimate?.toString() ?? "";
		if (kind === "startDate") return task.startDate?.slice(0, 10) ?? "";
		return task.dueDate?.slice(0, 10) ?? "";
	});

	const place = useCallback(() => {
		const row = document.querySelector<HTMLElement>(
			`[data-task-path="${CSS.escape(task.path)}"]`,
		);
		if (row) {
			const rect = row.getBoundingClientRect();
			setPos({
				top: Math.min(rect.bottom + 4, window.innerHeight - 300),
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
		const onScroll = () => place();
		window.addEventListener("resize", onScroll);
		window.addEventListener("scroll", onScroll, true);
		// Close on outside click, but never while the depth-nudge dialog is up —
		// reaching for "Move anyway" isn't leaving the picker.
		const onClick = () => {
			if (!confirmRef.current) onClose();
		};
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

	// The portal renders only once `pos` lands, so focus the field in a second
	// pass rather than on mount.
	useEffect(() => {
		if (pos && isInput) inputRef.current?.focus();
	}, [pos, isInput]);

	const choose = useCallback(
		(id: string | null) => {
			const m = plugin.mutations;
			const multi = batch.length > 1;

			if (kind === "status") {
				if (id) {
					if (multi) {
						void m.bulkUpdate(batch, { status: id });
					} else {
						void m.setStatus(task, id);
					}
				}
			} else if (kind === "priority") {
				if (multi) {
					void m.bulkUpdate(batch, { priority: id });
				} else {
					void m.setPriority(task, id);
				}
			} else if (kind === "taskType") {
				if (multi) {
					void m.bulkUpdate(batch, { taskType: id ?? null });
				} else {
					void m.updateTask(task, { taskType: id ?? null });
				}
			} else if (kind === "label") {
				const targetId = id as string;
				const added = task.labels.includes(targetId);
				if (multi) {
					// Additive toggle: flip the label across every target independently.
					void Promise.all(
						batch.map((t) => {
							const next = added
								? t.labels.filter((l) => l !== targetId)
								: [...t.labels, targetId];
							return m.setLabels(t, next);
						}),
					);
				} else {
					const next = added
						? task.labels.filter((l) => l !== targetId)
						: [...task.labels, targetId];
					void m.setLabels(task, next);
				}
			} else if (kind === "assignee") {
				if (multi) {
					void m.bulkUpdate(batch, { assignee: id });
				} else {
					void m.setAssignee(task, id);
				}
			} else if (kind === "parent") {
				if (!multi && id && depthUnder(scopeOf(snapshot), id) > MAX_COMFORTABLE_DEPTH) {
					setConfirmParent(id);
					return;
				}
				if (multi) {
					void m.bulkUpdate(batch, { parent: id });
				} else {
					void m.setParent(task, id);
				}
			} else if (kind === "project") {
				if (multi) {
					void m.bulkUpdate(batch, { project: id });
				} else {
					void m.setProject(task, id);
				}
			}
			onClose();
		},
		[plugin, kind, task, batch, snapshot, onClose],
	);

	const commit = useCallback(
		(next: string | null) => {
			const m = plugin.mutations;
			if (kind === "estimate") {
				const parsed = next ? Number.parseFloat(next) : NaN;
				const value = Number.isFinite(parsed) ? parsed : null;
				if (batch.length > 1) {
					void m.bulkUpdate(batch, { estimate: value });
				} else {
					void m.updateTask(task, { estimate: value });
				}
			} else if (kind === "startDate") {
				const value = next || null;
				if (batch.length > 1) {
					void m.bulkUpdate(batch, { startDate: value });
				} else {
					void m.updateTask(task, { startDate: value });
				}
			} else {
				const value = next || null;
				if (batch.length > 1) {
					void m.bulkUpdate(batch, { dueDate: value });
				} else {
					void m.updateTask(task, { dueDate: value });
				}
			}
			onClose();
		},
		[plugin, kind, task, batch, onClose],
	);

	// Own the keyboard while open — window capture so it doesn't depend on the
	// list keeping DOM focus, and beats the shell's tab-closing Escape handler.
	// Menu fields get arrow-nav; input fields get nothing here because the
	// focused native input already owns arrows/digits (Enter/Esc handled in
	// `onKeyDown`). While a depth-nudge is up, Enter goes to its focused
	// confirm button and Escape dismisses just the nudge.
	const activeRef = useRef(active);
	activeRef.current = active;
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (confirmRef.current) {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					setConfirmParent(null);
				}
				return;
			}
			if (isInput) return;
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
	}, [rows, choose, onClose, isInput]);

	useEffect(() => {
		if (!isInput) {
			listRef.current
				?.querySelector<HTMLElement>("[data-highlighted='true']")
				?.scrollIntoView({ block: "nearest" });
		}
	}, [active, isInput]);

	if (!pos) return null;

	const confirmDepth =
		confirmParent &&
		depthUnder(scopeOf(snapshot), confirmParent);

	return createPortal(
		<>
			<div
				className="vf-select-menu vf-quick-picker"
				style={{ top: pos.top, left: pos.left, width: 240, maxHeight: 300 }}
				onClick={(event) => event.stopPropagation()}
			>
				<div className="vf-quick-picker-title">{TITLE[kind]}</div>

				{isInput ? (
					<div className="vf-quick-picker-field">
						<input
							ref={inputRef}
							className="vf-input"
							type={kind === "estimate" ? "number" : "date"}
							min={0}
							placeholder={
								kind === "estimate" ? "0" : `${kind === "startDate" ? "start" : "due"} date…`
							}
							value={value}
							onChange={(event) => setValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									event.stopPropagation();
									commit(value);
								} else if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									onClose();
								} else if (
									kind === "estimate" &&
									(event.key === "ArrowUp" || event.key === "ArrowDown")
								) {
									event.preventDefault();
									event.stopPropagation();
									const current = Number.parseFloat(value) || 0;
									const next = Math.max(
										0,
										event.key === "ArrowUp" ? current + 1 : current - 1,
									);
									setValue(next.toString());
								}
							}}
						/>
						<span className="vf-quick-picker-hint">
							Enter to save · Esc to close
						</span>
					</div>
				) : (
					<>
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
								{row.leading ?? (
									<span
										className="vf-status-dot"
										style={
											row.color
												? { background: row.color }
												: undefined
										}
										aria-hidden
									/>
								)}
								{row.detail}
								<span className="vf-icon-select-name">{row.name}</span>
							</button>
						))}
					</div>

					{kind === "label" && (
						<div className="vf-quick-picker-create">
							<input
								ref={labelInputRef}
								className="vf-input"
								placeholder="Create label…"
								value={newLabelName}
								onChange={(event) => setNewLabelName(event.target.value)}
								onKeyDown={(event) => {
									const name = newLabelName.trim();
									if (event.key === "Enter" && name) {
										event.preventDefault();
										event.stopPropagation();
										void createAndAttach(name);
									} else if (event.key === "Escape") {
										event.preventDefault();
										event.stopPropagation();
										onClose();
									}
								}}
							/>
							<span className="vf-quick-picker-hint">
								Enter to create and attach · Esc to close
							</span>
						</div>
					)}
					</>
				)}
			</div>

			{confirmDepth && (
				<ConfirmDeleteDialog
					title={`Nest "${task.title}" ${confirmDepth} levels deep?`}
					body="Deeply nested sub-tasks get hard to scan. You can still move it."
					confirmLabel="Move anyway"
					onCancel={() => setConfirmParent(null)}
					onConfirm={() => {
						const parent = confirmParent;
						setConfirmParent(null);
						void plugin.mutations.setParent(task, parent);
						onClose();
					}}
				/>
			)}
		</>,
		document.body,
	);
}