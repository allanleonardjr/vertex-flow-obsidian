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

import { useEffect } from "react";
import { workspaceTaxonomies } from "../core/taxonomy";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { TaskDetailPanel } from "./TaskDetailPanel";

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

	if (!owner || !task) return null;

	return (
		<TaskDetailPanel
			key={task.path}
			task={task}
			snapshot={owner}
			taxonomies={workspaceTaxonomies(owner.workspace)}
			onOpenTask={openTask}
			onClose={closeActive}
			onCloseAllTasks={closeAllTasks}
		/>
	);
}
