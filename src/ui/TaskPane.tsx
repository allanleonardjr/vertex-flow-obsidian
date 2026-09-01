/**
 * Renders one task's tab content.
 *
 * Resolves the task and its own owning workspace/taxonomies fresh via
 * `plugin.index` on every render — never through whichever workspace
 * `App.tsx` currently considers "active." A task tab can legitimately outlive
 * a workspace switch (open a task in workspace A, then one in workspace B —
 * A's tab is still sitting there), and the *active* tab itself can briefly be
 * for a workspace that `App.tsx`'s own state hasn't caught up to yet, right
 * after `openTask()` flips it. Scoping the lookup to a passed-down snapshot
 * prop made both of those render a permanently blank pane.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workspaceTaxonomies } from "../core/taxonomy";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { TaskDetailPanel } from "./TaskDetailPanel";
import {
	QuickFieldPicker,
	type QuickPickerKind,
} from "./shortcuts/QuickFieldPicker";

/** How long a lone `u` waits for its second key before lapsing. */
const CHORD_TIMEOUT_MS = 1000;

export function TaskPane({ path }: { path: string }) {
	const plugin = usePlugin();
	const { openTask, close, closeActive, closeAllTasks } = useTabs();

	const owner = plugin.index.workspaceFor(path);
	const task = owner?.tasks.find((candidate) => candidate.path === path) ?? null;

	// Genuinely unresolvable (deleted since the last index rebuild — the tab
	// strip's own prune effect normally catches this first). Closing has to
	// happen in an effect, not inline during render: calling a state setter
	// while this component is still rendering is unsafe in React.
	useEffect(() => {
		if (!task) close(path);
	}, [task, close, path]);

	// The `u` chord for the single-task editor, mirroring TaskViewport's:
	// a bare `u` arms a one-second chord; the next key resolves it to a field
	// picker (`u s`/`u p`/`u l`/`u t`/`u a`/`u r`/`u m`/`u e`/`u b`/`u d`),
	// `u u` re-arms, and anything else cancels. Bound to his tab's task — never
	// the selection, which the editor doesn't participate in.
	const uPickerKey: Record<string, QuickPickerKind> = useMemo(
		() => ({
			s: "status",
			p: "priority",
			t: "taskType",
			l: "label",
			a: "assignee",
			r: "parent",
			m: "project",
			e: "estimate",
			b: "startDate",
			d: "dueDate",
		}),
		[],
	);

	// The field picker this tab is showing, or null.
	const [quickPicker, setQuickPicker] = useState<{
		kind: QuickPickerKind;
	} | null>(null);

	const pendingU = useRef(false);
	const uTimer = useRef<number | null>(null);
	const clearPendingU = useCallback(() => {
		pendingU.current = false;
		if (uTimer.current != null) {
			window.clearTimeout(uTimer.current);
			uTimer.current = null;
		}
	}, []);
	const armU = useCallback(() => {
		pendingU.current = true;
		if (uTimer.current != null) window.clearTimeout(uTimer.current);
		uTimer.current = window.setTimeout(clearPendingU, CHORD_TIMEOUT_MS);
	}, [clearPendingU]);

	useEffect(() => {
		if (!task) return;
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.isContentEditable ||
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement
			) {
				clearPendingU();
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey) {
				clearPendingU();
				return;
			}

			if (event.key === "u") {
				armU();
				return;
			}
			if (!pendingU.current) return;

			const key = event.key.toLowerCase();
			if (key === "u") {
				armU();
				return;
			}
			clearPendingU();

			const kind = uPickerKey[key];
			if (kind) {
				event.preventDefault();
				event.stopPropagation();
				setQuickPicker({ kind });
			}
			// Any other key cancels the chord and falls through.
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [task, clearPendingU, armU, uPickerKey]);

	if (!owner || !task) return null;

	const snapshot = owner;

	return (
		<>
			<TaskDetailPanel
				key={task.path}
				task={task}
				snapshot={snapshot}
				taxonomies={workspaceTaxonomies(owner.workspace)}
				onOpenTask={openTask}
				onClose={closeActive}
				onCloseAllTasks={closeAllTasks}
			/>

			{quickPicker && task && (
				<QuickFieldPicker
					key={`${task.path}:${quickPicker.kind}`}
					task={task}
					kind={quickPicker.kind}
					snapshot={snapshot}
					taxonomies={workspaceTaxonomies(owner.workspace)}
					onClose={() => setQuickPicker(null)}
				/>
			)}
		</>
	);
}
