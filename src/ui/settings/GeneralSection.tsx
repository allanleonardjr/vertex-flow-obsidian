/**
 * Workspace identity. Name is editable; the ID prefix and folder are shown
 * but not — the prefix is baked into every existing task filename, and
 * changing the folder is a file move the plugin doesn't perform from here.
 */

import { useState } from "react";
import type { WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";

export function GeneralSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const [name, setName] = useState(snapshot.workspace.name);

	return (
		<section className="vf-settings-section">
			<h3>General</h3>

			<label className="vf-field">
				<span>Name</span>
				<input
					type="text"
					value={name}
					onChange={(event) => setName(event.target.value)}
					onBlur={() => {
						const trimmed = name.trim();
						if (trimmed && trimmed !== snapshot.workspace.name) {
							void plugin.mutations.saveWorkspaceConfig({
								...snapshot.workspace,
								name: trimmed,
							});
						} else {
							setName(snapshot.workspace.name);
						}
					}}
				/>
			</label>

			<label className="vf-field">
				<span>Task ID prefix</span>
				<input type="text" value={snapshot.workspace.idPrefix} disabled />
				<small>
					Baked into every task filename already created — changing it here
					would orphan them.
				</small>
			</label>

			<label className="vf-field">
				<span>Folder</span>
				<input type="text" value={snapshot.workspace.root || "/"} disabled />
			</label>
		</section>
	);
}
