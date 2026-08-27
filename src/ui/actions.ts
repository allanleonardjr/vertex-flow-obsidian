/**
 * Actions that span the plugin and the editor.
 */

import { useCallback } from "react";
import { Notice, type TFile } from "obsidian";
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

/**
 * Create-then-open for Initiatives, Projects, and Cycles.
 *
 * These have no custom in-plugin editor — only Tasks get one (§4.2–4.4 are
 * plain notes meant to be written in by hand, prose and all). So "open" here
 * means the real Obsidian note editor, not a Vertex Flow panel. The
 * create-first-then-edit shape still applies: there's a real note the moment
 * you click "New", never a form that only becomes one on submit.
 */
function useCreateEntity(
	create: (
		plugin: ReturnType<typeof usePlugin>,
		snapshot: WorkspaceSnapshot,
	) => Promise<TFile>,
	label: string,
): (snapshot: WorkspaceSnapshot) => Promise<void> {
	const plugin = usePlugin();
	return useCallback(
		async (snapshot) => {
			try {
				const file = await create(plugin, snapshot);
				await plugin.mutations.open(withoutExtension(file.path));
			} catch (cause) {
				new Notice(
					`Could not create ${label}: ${
						cause instanceof Error ? cause.message : String(cause)
					}`,
				);
			}
		},
		[plugin, create, label],
	);
}

export function useCreateInitiative(): (snapshot: WorkspaceSnapshot) => Promise<void> {
	return useCreateEntity(
		(plugin, snapshot) => plugin.mutations.createInitiative(snapshot, "New initiative"),
		"initiative",
	);
}

export function useCreateProject(): (snapshot: WorkspaceSnapshot) => Promise<void> {
	return useCreateEntity(
		(plugin, snapshot) => plugin.mutations.createProject(snapshot, "New project"),
		"project",
	);
}

export function useCreateCycle(): (snapshot: WorkspaceSnapshot) => Promise<void> {
	return useCreateEntity((plugin, snapshot) => {
		// A quick 2-week default (§7.5's own example preset) — free-form once
		// the note is open, since cycles have no fixed duration.
		const start = new Date();
		const end = new Date(start.getTime() + 13 * 24 * 60 * 60 * 1000);
		const iso = (date: Date) => date.toISOString().slice(0, 10);
		return plugin.mutations.createCycle(snapshot, "New cycle", iso(start), iso(end));
	}, "cycle");
}
