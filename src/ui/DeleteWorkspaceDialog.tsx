/**
 * The confirmation for deleting an entire workspace.
 *
 * Heavier than the taxonomy/entity dialogs on purpose — this trashes a whole
 * folder tree, so it summarises what's inside, warns when links elsewhere in
 * the vault will be rewritten, and gates the action behind typing the
 * workspace's name (the `mod-warning` destructive-button pattern used by
 * `DeleteEntityDialog` / `ReplaceValueDialog`, plus a name match).
 *
 * The folder goes to Obsidian's trash, not a permanent delete — `NoteIO.trash`
 * honours the user's "deleted files" preference.
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { danglingRelationEditsForWorkspaceDeletion } from "../core/hierarchy";
import type { WorkspaceSnapshot } from "../core/types";
import { usePlugin, useWorkspaces } from "./context";

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function DeleteWorkspaceDialog({
	snapshot,
	onClose,
}: {
	snapshot: WorkspaceSnapshot;
	onClose: () => void;
}) {
	const plugin = usePlugin();
	const workspaces = useWorkspaces();
	const [typed, setTyped] = useState("");
	const [busy, setBusy] = useState(false);

	const name = snapshot.workspace.name;
	const root = snapshot.workspace.root;

	// Links in *other* workspaces that point into this one — those get rewritten
	// silently on delete, so the user should know before confirming.
	const crossLinks = useMemo(
		() => danglingRelationEditsForWorkspaceDeletion(workspaces, root),
		[workspaces, root],
	);

	const canDelete = typed.trim() === name && !busy;

	const remove = async () => {
		if (!canDelete) return;
		setBusy(true);
		try {
			await plugin.mutations.deleteWorkspace(snapshot);
			onClose();
		} finally {
			setBusy(false);
		}
	};

	const inside = [
		count(snapshot.tasks.length, "task"),
		count(snapshot.projects.length, "project"),
	].join(" and ");

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog"
				role="dialog"
				aria-modal="true"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>Delete workspace "{name}"?</h3>

				<p className="vf-dialog-lead">
					This moves the entire <code>{root}</code> folder — {inside} — to
					Obsidian's trash. It's recoverable from there; nothing is permanently
					deleted.
				</p>

				{crossLinks.length > 0 && (
					<p className="vf-dialog-lead">
						{count(crossLinks.length, "task")} in other workspaces link into
						this one (blocks, blocked by, related, or duplicate). Those links
						will be cleaned up automatically.
					</p>
				)}

				<label className="vf-field">
					<span>
						Type <strong>{name}</strong> to confirm
					</span>
					<input
						className="vf-input"
						type="text"
						value={typed}
						autoFocus
						onChange={(event) => setTyped(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && canDelete) void remove();
						}}
					/>
				</label>

				<div className="vf-dialog-actions">
					<button disabled={busy} onClick={onClose}>
						Cancel
					</button>
					<button
						className="mod-cta mod-warning"
						disabled={!canDelete}
						onClick={() => void remove()}
					>
						Delete and remove
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
