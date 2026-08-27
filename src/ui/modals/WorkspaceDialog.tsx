/**
 * Create a workspace, or generate the sample one (§13).
 *
 * Both paths ask where the folder should go. A workspace is a real folder full
 * of real notes in the user's vault — dropping one at a guessed location and
 * telling them afterwards is the kind of thing that makes people distrust a
 * plugin.
 */

import { TFolder } from "obsidian";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { suggestPrefix } from "../../core/ids";
import { usePlugin, useSettingsWriter } from "../context";
import { FolderSuggestModal } from "./FolderSuggestModal";

export type WorkspaceDialogMode = "create" | "sample";

export function WorkspaceDialog({
	mode,
	onClose,
}: {
	mode: WorkspaceDialogMode;
	onClose: () => void;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();

	const [name, setName] = useState(
		mode === "sample" ? "Sample Workspace" : "My Workspace",
	);
	const [folder, setFolder] = useState(
		mode === "sample"
			? `${plugin.settings.defaultWorkspaceFolder} Sample`
			: plugin.settings.defaultWorkspaceFolder,
	);
	const [prefix, setPrefix] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const suggested = suggestPrefix(name, plugin.index.takenPrefixes());

	// Existing folders, offered as completions rather than a picker — typing a
	// new path has to stay just as easy as choosing an existing one.
	const folders = useMemo(
		() =>
			plugin.app.vault
				.getAllLoadedFiles()
				.filter((file): file is TFolder => file instanceof TFolder)
				.map((file) => file.path)
				.filter((path) => path !== "/")
				.sort(),
		[plugin],
	);

	const taken = folder.trim()
		? plugin.app.vault.getAbstractFileByPath(folder.trim()) != null
		: false;

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			// `availablePath` keeps us off an existing folder, so an accidental
			// collision never merges two workspaces into one directory.
			const root = plugin.io.availablePath(folder.trim());
			if (mode === "sample") {
				await plugin.mutations.createSampleWorkspace(root);
			} else {
				await plugin.mutations.createWorkspace(
					name.trim(),
					root,
					prefix || suggested,
				);
			}
			writeSettings({ activeWorkspaceRoot: root });
			onClose();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setBusy(false);
		}
	};

	const valid = folder.trim().length > 0 && (mode === "sample" || name.trim().length > 0);

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog"
				role="dialog"
				onClick={(event) => event.stopPropagation()}
			>
				<h3>{mode === "sample" ? "Try a sample workspace" : "New workspace"}</h3>

				{mode === "sample" && (
					<p className="vf-dialog-lead">
						Creates real notes you can read, edit, and delete — an initiative,
						two projects, a cycle, and nine tasks showing sub-tasks,
						relations, labels, and comments.
					</p>
				)}

				{mode === "create" && (
					<label className="vf-field">
						<span>Name</span>
						<input
							type="text"
							value={name}
							autoFocus
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
				)}

				<label className="vf-field">
					<span>Folder</span>
					<div className="vf-folder-field">
						<input
							type="text"
							list="vf-folder-options"
							value={folder}
							autoFocus={mode === "sample"}
							placeholder="Where should this workspace live?"
							onChange={(event) => setFolder(event.target.value)}
						/>
						<button
							type="button"
							title="Browse for a folder"
							onClick={() =>
								new FolderSuggestModal(plugin.app, (chosen) =>
									setFolder(chosen.isRoot() ? "" : chosen.path),
								).open()
							}
						>
							Browse…
						</button>
					</div>
					{/* Typing still works — a workspace can live in a folder that
					    doesn't exist yet, which the picker alone can't offer. */}
					<datalist id="vf-folder-options">
						{folders.map((path) => (
							<option key={path} value={path} />
						))}
					</datalist>
					{taken && (
						<small>
							<code>{folder.trim()}</code> already exists — a numbered folder
							will be created next to it.
						</small>
					)}
				</label>

				{mode === "create" && (
					<label className="vf-field">
						<span>Task ID prefix</span>
						<input
							type="text"
							value={prefix}
							placeholder={suggested}
							onChange={(event) => setPrefix(event.target.value.toUpperCase())}
						/>
						<small>
							Task files are named by ID —{" "}
							<code>{prefix || suggested}-0001.md</code>. Must be unique
							across the whole vault.
						</small>
					</label>
				)}

				{error && <p className="vf-error">{error}</p>}

				<div className="vf-dialog-actions">
					<button disabled={busy} onClick={onClose}>
						Cancel
					</button>
					<button
						className="mod-cta"
						disabled={busy || !valid}
						onClick={() => void submit()}
					>
						{busy ? "Creating…" : "Create"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
