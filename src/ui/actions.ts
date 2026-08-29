/**
 * Actions that span the plugin and the editor.
 */

import { useCallback } from "react";
import { Notice } from "obsidian";
import { withoutExtension } from "../obsidian/note-io";
import type { NewTaskInput } from "../obsidian/mutations";
import type { WorkspaceSnapshot } from "../core/types";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";

/** Title given to a freshly created task, selected on open so it's replaceable. */
export const NEW_TASK_TITLE = "New task";

/**
 * Create a task and open it in its own internal tab.
 *
 * The note is created first, then edited — rather than filling in a form and
 * creating at the end. That way the editor is always editing something real:
 * one code path for new and existing tasks, no half-built task living only in
 * component state, and nothing lost if the tab is closed mid-edit.
 */
export function useCreateTask(): (
	snapshot: WorkspaceSnapshot,
	input?: Partial<NewTaskInput>,
) => Promise<void> {
	const plugin = usePlugin();
	const tabs = useTabs();

	return useCallback(
		async (snapshot, input = {}) => {
			try {
				const file = await plugin.mutations.createTask(snapshot, {
					// A placeholder rather than an empty title: an untitled task
					// falls back to displaying its ID, which reads as a bug in
					// the list. The editor selects this text on open so typing
					// replaces it.
					title: NEW_TASK_TITLE,
					...input,
				});
				tabs.openTask(withoutExtension(file.path));
			} catch (cause) {
				new Notice(
					`Could not create task: ${
						cause instanceof Error ? cause.message : String(cause)
					}`,
				);
			}
		},
		[plugin, tabs],
	);
}

/** Title given to a freshly created project, mirroring `NEW_TASK_TITLE`. */
export const NEW_PROJECT_TITLE = "New project";

/**
 * Create a project and open it in its own internal tab — the Vertex Flow
 * Project editor, not the raw Obsidian note (the same shift Tasks made). Same
 * create-first-then-edit shape as `useCreateTask`: there's a real note the
 * moment you click "New", never a form that only becomes one on submit.
 */
export function useCreateProject(): (snapshot: WorkspaceSnapshot) => Promise<void> {
	const plugin = usePlugin();
	const tabs = useTabs();

	return useCallback(
		async (snapshot) => {
			try {
				const file = await plugin.mutations.createProject(
					snapshot,
					NEW_PROJECT_TITLE,
				);
				tabs.openProject(withoutExtension(file.path));
			} catch (cause) {
				new Notice(
					`Could not create project: ${
						cause instanceof Error ? cause.message : String(cause)
					}`,
				);
			}
		},
		[plugin, tabs],
	);
}
