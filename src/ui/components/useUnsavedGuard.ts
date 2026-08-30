/**
 * Wire a draft's dirty state into the tab strip's close guard.
 *
 * `useViewDraft` / `useDashboardDraft` now hold edits in the shared draft store
 * on `TabsProvider`, which survives tab and workspace switches — so navigation
 * never loses a draft and never prompts. The one case still worth a prompt is
 * *closing* the specific tab holding the draft: this hook, used by whichever
 * component owns the active draft, registers a check that `tabs-context` runs
 * on that close — it pops an `<UnsavedChangesDialog>` and resolves based on the
 * button pressed.
 *
 * Returns the dialog element to render (or `null`).
 */

import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { useTabs } from "../tabs-context";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

export function useUnsavedGuard(opts: {
	dirty: boolean;
	/** False when the draft's target can't be overwritten (Save is hidden). */
	canSave: boolean;
	/** Noun for the dialog copy, e.g. `"dashboard"` / `"view"`. */
	what: string;
	/** Its title, when known — disambiguates which one the prompt is about. */
	name?: string;
	/** Stable per tab — re-registers the guard when the tab identity changes. */
	guardKey: string;
	/** Persist the draft. Awaited before the navigation proceeds. */
	save: () => Promise<void>;
	/** Discard the draft. */
	reset: () => void;
}): ReactNode {
	const { setUnsavedGuard } = useTabs();
	const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null);

	// The guard promise is created once per navigation attempt; the button
	// handlers must call the *current* save/reset, so read them through a ref.
	const optsRef = useRef(opts);
	optsRef.current = opts;

	useEffect(() => {
		if (!opts.dirty) {
			setUnsavedGuard(null);
			return;
		}
		setUnsavedGuard(
			() => new Promise<boolean>((resolve) => setResolver(() => resolve)),
		);
		return () => setUnsavedGuard(null);
	}, [opts.dirty, opts.guardKey, setUnsavedGuard]);

	if (!resolver) return null;

	const finish = (ok: boolean) => {
		resolver(ok);
		setResolver(null);
	};

	return createElement(UnsavedChangesDialog, {
		what: opts.what,
		name: opts.name,
		canSave: opts.canSave,
		onSave: async () => {
			await optsRef.current.save();
			finish(true);
		},
		onDiscard: () => {
			optsRef.current.reset();
			finish(true);
		},
		onCancel: () => finish(false),
	});
}
