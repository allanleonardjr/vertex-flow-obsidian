/**
 * Unsaved edits to the dashboard you're looking at — the direct analogue of
 * `useViewDraft` for Saved Views.
 *
 * Editing the filter bar or moving / resizing / adding / removing widgets
 * applies immediately to what's on screen but is held here, not written to
 * `_dashboards`. `_dashboards` is shared across a synced vault, so the write is
 * explicit (Save / Save As). The dashboard's *name* is identity, not part of
 * the draft — renaming from the sidebar writes straight through.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardConfig, WorkspaceSnapshot } from "../../core/types";
import { canonicalizeFilters } from "../../core/views";
import { usePlugin } from "../context";

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
	const [draft, setDraft] = useState<DashboardConfig | null>(null);

	useEffect(
		() => setDraft(null),
		[dashboard.id, snapshot.workspace.root],
	);

	const effective = draft ?? dashboard;
	const dirty =
		draft != null && definitionOf(draft) !== definitionOf(dashboard);

	const live = useCallback(
		() => plugin.index.get(snapshot.workspace.root) ?? snapshot,
		[plugin, snapshot],
	);

	const edit = useCallback((next: DashboardConfig) => setDraft(next), []);
	const reset = useCallback(() => setDraft(null), []);

	const save = useCallback(async () => {
		if (!draft) return;
		await plugin.mutations.updateDashboard(live(), { ...draft, name: dashboard.name });
		setDraft(null);
	}, [draft, plugin, live, dashboard.name]);

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
			setDraft(null);
			return id;
		},
		[effective, plugin, live, makeId],
	);

	return useMemo(
		() => ({ effective, dirty, edit, save, saveAs, reset }),
		[effective, dirty, edit, save, saveAs, reset],
	);
}
