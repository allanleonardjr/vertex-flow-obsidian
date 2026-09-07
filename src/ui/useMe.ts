/**
 * React bindings for the per-device, per-workspace "me" identity held in
 * `src/obsidian/me-storage.ts`.
 *
 * `localStorage` isn't reactive, so a bare `getMePersonId(root)` in a component
 * won't repaint when the value changes in another pane (or the same one). These
 * hooks subscribe to the store's change token via `useSyncExternalStore` — the
 * same pattern `useWorkspaces` uses for the vault index — so picking "me" in
 * Settings updates the sidebar's "You" badge immediately.
 */

import { useSyncExternalStore } from "react";
import {
	getMePersonId,
	meStoreRevision,
	subscribeMe,
} from "../obsidian/me-storage";

/** This device's "me" `Person.id` for a workspace, re-rendering on change. */
export function useMePersonId(workspaceRoot: string): string | null {
	return useSyncExternalStore(subscribeMe, () => getMePersonId(workspaceRoot));
}

/** Subscribe to any "me" change (personId map or a banner dismissal) without
 *  binding to one value — read the specific `me-storage` getters in render. */
export function useMeRevision(): number {
	return useSyncExternalStore(subscribeMe, meStoreRevision);
}
