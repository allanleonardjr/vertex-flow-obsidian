/**
 * Unsaved edits to the dashboard you're looking at — the direct analogue of
 * `useViewDraft` for Saved Views.
 *
 * Editing the filter bar or moving / resizing / adding / removing widgets
 * applies immediately to what's on screen but is held here, not written to
 * `_dashboards`. `_dashboards` is shared across a synced vault, so the write is
 * explicit (Save / Save As). The dashboard's *name and icon* are identity, not
 * part of the draft — editing them (sidebar or the header title) writes
 * straight through, and Save preserves whatever is currently on disk.
 */

import { useCallback, useMemo } from "react";
import type { DashboardConfig, WorkspaceSnapshot } from "../../core/types";
import { canonicalizeFilters } from "../../core/views";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";

/** What "unsaved" is measured over: widgets + the canonicalised filter set. */
function definitionOf(dashboard: DashboardConfig): string {
	return JSON.stringify({
		widgets: dashboard.widgets,
		filters: canonicalizeFilters(dashboard.filters),
	});
}

export interface DashboardDraft {
	effective: DashboardConfig;
	dirty: boolean;
	/** Apply an edit (held, not persisted). */
	edit: (next: DashboardConfig) => void;
	/** Write the draft over the saved dashboard. */
	save: () => Promise<void>;
	/** Clone the current draft into a new dashboard; resolves to its id. */
	saveAs: (name: string, icon?: string) => Promise<string>;
	/** Throw the draft away. */
	reset: () => void;
}

export function useDashboardDraft(
	snapshot: WorkspaceSnapshot,
	dashboard: DashboardConfig,
	makeId: () => string,
): DashboardDraft {
	const plugin = usePlugin();
	const { getDashboardDraft, setDashboardDraft } = useTabs();

	// Keyed by `dashboard.id` in `TabsProvider`'s shared store, so the draft
	// outlives this component unmounting on a tab or workspace switch. The store
	// is already per-id, so no reset-on-id-change effect is needed.
	const draft = getDashboardDraft(dashboard.id);

	const effective = draft ?? dashboard;
	const dirty =
		draft != null && definitionOf(draft) !== definitionOf(dashboard);

	const live = useCallback(
		() => plugin.index.get(snapshot.workspace.root) ?? snapshot,
		[plugin, snapshot],
	);

	const edit = useCallback(
		(next: DashboardConfig) => setDashboardDraft(dashboard.id, next),
		[setDashboardDraft, dashboard.id],
	);
	const reset = useCallback(
		() => setDashboardDraft(dashboard.id, null),
		[setDashboardDraft, dashboard.id],
	);

	const save = useCallback(async () => {
		if (!draft) return;
		await plugin.mutations.updateDashboard(live(), {
			...draft,
			name: dashboard.name,
			icon: dashboard.icon,
		});
		setDashboardDraft(dashboard.id, null);
	}, [
		draft,
		plugin,
		live,
		dashboard.id,
		dashboard.name,
		dashboard.icon,
		setDashboardDraft,
	]);

	const saveAs = useCallback(
		async (name: string, icon?: string) => {
			const id = makeId();
			const clone: DashboardConfig = {
				...effective,
				id,
				name,
				icon: icon ?? effective.icon,
				widgets: effective.widgets.map((w) => ({ ...w })),
			};
			await plugin.mutations.addDashboard(live(), clone);
			setDashboardDraft(dashboard.id, null);
			return id;
		},
		[effective, plugin, live, makeId, setDashboardDraft, dashboard.id],
	);

	return useMemo(
		() => ({ effective, dirty, edit, save, saveAs, reset }),
		[effective, dirty, edit, save, saveAs, reset],
	);
}
