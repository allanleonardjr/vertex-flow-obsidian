/**
 * Workspace identity. Name is editable; the ID prefix and folder are shown
 * but not — the prefix is baked into every existing task filename, and
 * changing the folder is a file move the plugin doesn't perform from here.
 */

import { useState } from "react";
import type { WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";
import { IconField } from "../components/Icon";

export function GeneralSection({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const [name, setName] = useState(snapshot.workspace.name);
	const [icon, setIcon] = useState(snapshot.workspace.icon);

	const save = (nextName: string, nextIcon: string | undefined) => {
		const trimmed = nextName.trim();
		if (trimmed && (trimmed !== snapshot.workspace.name || nextIcon !== snapshot.workspace.icon)) {
			void plugin.mutations.saveWorkspaceConfig({
				...snapshot.workspace,
				name: trimmed,
				icon: nextIcon,
			});
		} else {
			setName(snapshot.workspace.name);
			setIcon(snapshot.workspace.icon);
		}
	};

	return (
		<section className="vf-settings-section">
			<h3>General</h3>

			<div className="vf-icon-name-row">
				<div className="vf-field vf-field-icon">
					<span>Icon</span>
					<IconField
						value={icon}
						fallback="layers"
						onChange={(nextIcon) => {
							setIcon(nextIcon);
							save(name, nextIcon);
						}}
					/>
				</div>
				<label className="vf-field vf-field-name">
					<span>Name</span>
					<input
						type="text"
						value={name}
						onChange={(event) => setName(event.target.value)}
						onBlur={() => save(name, icon)}
					/>
				</label>
			</div>

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
