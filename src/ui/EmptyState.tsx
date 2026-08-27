/**
 * Onboarding (§13).
 *
 * Two explicit paths, not a forced wizard. Someone who knows what they want
 * shouldn't have to click through a tour, and someone who doesn't shouldn't
 * have to invent a workspace structure before seeing what this thing is.
 */

import { useState } from "react";
import { suggestPrefix } from "../core/ids";
import { usePlugin, useSettingsWriter } from "./context";

export function EmptyState() {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const [mode, setMode] = useState<"choose" | "create">("choose");
	const [name, setName] = useState("My Workspace");
	const [folder, setFolder] = useState(plugin.settings.defaultWorkspaceFolder);
	const [prefix, setPrefix] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const suggested = suggestPrefix(name, plugin.index.takenPrefixes());

	const run = async (work: () => Promise<string | void>) => {
		setBusy(true);
		setError(null);
		try {
			const root = await work();
			if (typeof root === "string") writeSettings({ activeWorkspaceRoot: root });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	if (mode === "choose") {
		return (
			<div className="vf-empty">
				<div className="vf-empty-card">
					<h1>Vertex Flow</h1>
					<p className="vf-empty-lead">
						Task management that lives in your vault as plain Markdown.
						Start from scratch, or look around a populated example first.
					</p>

					<div className="vf-empty-actions">
						<button
							className="mod-cta"
							disabled={busy}
							onClick={() => setMode("create")}
						>
							Create a workspace
						</button>
						<button
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const root = plugin.io.availablePath(
										`${plugin.settings.defaultWorkspaceFolder} Sample`,
									);
									await plugin.mutations.createSampleWorkspace(root);
									return root;
								})
							}
						>
							Try a sample workspace
						</button>
					</div>

					<p className="vf-empty-note">
						The sample creates real notes you can read, edit, and delete —
						an initiative, two projects, a cycle, and nine tasks showing
						sub-tasks, relations, labels, and comments.
					</p>

					{error && <p className="vf-error">{error}</p>}
				</div>
			</div>
		);
	}

	return (
		<div className="vf-empty">
			<div className="vf-empty-card">
				<h1>New workspace</h1>

				<label className="vf-field">
					<span>Name</span>
					<input
						type="text"
						value={name}
						autoFocus
						onChange={(event) => setName(event.target.value)}
					/>
				</label>

				<label className="vf-field">
					<span>Folder</span>
					<input
						type="text"
						value={folder}
						onChange={(event) => setFolder(event.target.value)}
					/>
				</label>

				<label className="vf-field">
					<span>Task ID prefix</span>
					<input
						type="text"
						value={prefix}
						placeholder={suggested}
						onChange={(event) => setPrefix(event.target.value.toUpperCase())}
					/>
					<small>
						Task files are named by ID — <code>{prefix || suggested}-0001.md</code>.
						Must be unique across the whole vault.
					</small>
				</label>

				<div className="vf-empty-actions">
					<button disabled={busy} onClick={() => setMode("choose")}>
						Back
					</button>
					<button
						className="mod-cta"
						disabled={busy || !name.trim() || !folder.trim()}
						onClick={() =>
							void run(async () => {
								const root = plugin.io.availablePath(folder.trim());
								await plugin.mutations.createWorkspace(
									name.trim(),
									root,
									prefix || suggested,
								);
								return root;
							})
						}
					>
						Create
					</button>
				</div>

				{error && <p className="vf-error">{error}</p>}
			</div>
		</div>
	);
}
