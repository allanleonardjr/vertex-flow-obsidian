/**
 * The "you haven't said who you are in this workspace" nudge.
 *
 * Rendered in two places — the sidebar's People section and Workspace Settings
 * → People. It only appears while "me" is unset for the active workspace on
 * this device, and a viewer can dismiss it (per workspace, stored in
 * `me-storage`) without setting an identity. `setMePersonId` resets the
 * dismissal on any change, so a stale dismissal can't permanently hide a
 * genuinely-unset workspace.
 *
 * This is the dismissible *nudge*. The always-visible, always-accurate status
 * copy in the settings section is separate (see `PeopleSection`).
 */

import { type ReactNode } from "react";
import type { Person, WorkspaceConfig } from "../../core/types";
import {
	getMePersonId,
	isMeBannerDismissed,
	setMeBannerDismissed,
} from "../../obsidian/me-storage";
import { useMeRevision } from "../useMe";

/** The roster person this device treats as "me" here, or `null` when unset or
 *  the stored id no longer resolves (e.g. a raw folder-sync roster edit). */
export function resolveMePerson(workspace: WorkspaceConfig): Person | null {
	const id = getMePersonId(workspace.root);
	if (!id) return null;
	return workspace.people.find((person) => person.id === id) ?? null;
}

export function MeIdentityBanner({
	workspace,
	onOpenSettings,
}: {
	workspace: WorkspaceConfig;
	/** When set, renders a link to where the pick-or-add controls live — used
	 *  by the sidebar instance, which doesn't show them itself. */
	onOpenSettings?: () => void;
}): ReactNode {
	// Re-render on any me-storage write (pick "me", clear it, dismiss/undismiss).
	useMeRevision();

	if (isMeBannerDismissed(workspace.root) || resolveMePerson(workspace)) {
		return null;
	}

	return (
		<div className="vf-me-banner" role="note">
			<div className="vf-me-banner-body">
				<strong>Who are you in this workspace?</strong>
				<span>
					Pick yourself in the People list so "Assigned to Me" and
					@mentions of you work. Stored on this device only.
				</span>
				{onOpenSettings && (
					<button
						type="button"
						className="vf-link-button"
						onClick={onOpenSettings}
					>
						Open People settings
					</button>
				)}
			</div>
			<button
				type="button"
				className="vf-icon-button vf-me-banner-dismiss"
				aria-label="Dismiss"
				title="Dismiss"
				onClick={() => setMeBannerDismissed(workspace.root, true)}
			>
				✕
			</button>
		</div>
	);
}
