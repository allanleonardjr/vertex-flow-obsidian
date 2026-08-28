/**
 * Workspace creation (§13).
 *
 * A template gallery is the *only* way to make a workspace — there is no
 * separate "blank" path, the plainest template ("Getting Started") is just the
 * first card. Picking a card opens a short config step (name / folder / ID
 * prefix / "populate with example content?") before anything is written.
 *
 * Always rendered as a full pane — inline in the empty state, or in its own
 * tab when opened from the sidebar (`onClose` closes that tab).
 */

import { TFolder } from "obsidian";
import { useMemo, useState } from "react";
import {
	WORKSPACE_TEMPLATES,
	type TemplateSetting,
	type WorkspaceTemplate,
} from "../core/templates";
import { Icon } from "./components/Icon";
import { usePlugin, useSettingsWriter } from "./context";
import { FolderSuggestModal } from "./modals/FolderSuggestModal";

export function TemplateGallery({ onClose }: { onClose?: () => void }) {
	const [selected, setSelected] = useState<WorkspaceTemplate | null>(null);

	return (
		<div className="vf-template-pane">
			{selected ? (
				<ConfigStep
					template={selected}
					onBack={() => setSelected(null)}
					onDone={() => onClose?.()}
				/>
			) : (
				<Gallery onPick={setSelected} onClose={onClose} />
			)}
		</div>
	);
}

function Gallery({
	onPick,
	onClose,
}: {
	onPick: (template: WorkspaceTemplate) => void;
	onClose?: () => void;
}) {
	return (
		<div className="vf-template-gallery">
			<header className="vf-template-head">
				<div>
					<h1>New workspace</h1>
					<p className="vf-template-sub">
						Pick a starting point. Statuses, labels and views are all editable
						afterwards.
					</p>
				</div>
				{onClose && (
					<button type="button" onClick={onClose}>
						Cancel
					</button>
				)}
			</header>

			<div className="vf-template-grid">
				{WORKSPACE_TEMPLATES.map((template) => (
					<div
						key={template.id}
						className="vf-template-card"
						role="button"
						tabIndex={0}
						onClick={() => onPick(template)}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								onPick(template);
							}
						}}
					>
						<div className="vf-template-card-head">
							<Icon id={template.icon} fallback="layers" size={17} />
							<span className="vf-template-card-title">{template.name}</span>
						</div>
						<p className="vf-template-card-desc">{template.description}</p>
						<dl className="vf-template-settings">
							{template.settings.map((setting) => (
								<SettingRow key={setting.label} setting={setting} />
							))}
						</dl>
						<span className="vf-template-card-cta">Use this template →</span>
					</div>
				))}
			</div>
		</div>
	);
}

function SettingRow({ setting }: { setting: TemplateSetting }) {
	return (
		<div className="vf-template-setting">
			<dt className="vf-template-setting-label">{setting.label}</dt>
			<dd className="vf-template-setting-values">
				{setting.values.length === 0 ? (
					<span className="vf-template-val is-muted">None</span>
				) : (
					setting.values.map((value) => (
						<span key={value.name} className="vf-template-val">
							{value.color && (
								<span
									className="vf-template-dot"
									style={{ background: value.color }}
								/>
							)}
							{value.name}
						</span>
					))
				)}
			</dd>
		</div>
	);
}

function ConfigStep({
	template,
	onBack,
	onDone,
}: {
	template: WorkspaceTemplate;
	onBack: () => void;
	onDone: () => void;
}) {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();

	const [name, setName] = useState(template.name);
	const [folder, setFolder] = useState(plugin.settings.defaultWorkspaceFolder);
	const [prefix, setPrefix] = useState("");
	const [populate, setPopulate] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

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

	const valid = folder.trim().length > 0 && name.trim().length > 0;

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			const root = plugin.io.availablePath(folder.trim());
			await plugin.mutations.createWorkspaceFromTemplate({
				template,
				name: name.trim(),
				root,
				idPrefix: prefix.trim() || undefined,
				icon: template.icon,
				includeExampleContent: populate,
			});
			writeSettings({ activeWorkspaceRoot: root });
			onDone();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setBusy(false);
		}
	};

	return (
		<div className="vf-template-config">
			<button type="button" className="vf-template-back" onClick={onBack}>
				← All templates
			</button>

			<header className="vf-template-config-head">
				<Icon id={template.icon} fallback="layers" size={18} />
				<h1>{template.name}</h1>
			</header>
			<p className="vf-template-sub">{template.description}</p>

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
				<div className="vf-folder-field">
					<input
						type="text"
						list="vf-template-folder-options"
						value={folder}
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
				<datalist id="vf-template-folder-options">
					{folders.map((path) => (
						<option key={path} value={path} />
					))}
				</datalist>
				{taken && (
					<small>
						<code>{folder.trim()}</code> already exists — a numbered folder will
						be created next to it.
					</small>
				)}
			</label>

			<label className="vf-field">
				<span>Task ID prefix</span>
				<input
					type="text"
					value={prefix}
					placeholder={template.defaultIdPrefix}
					onChange={(event) => setPrefix(event.target.value.toUpperCase())}
				/>
				<small>
					Task files are named by ID —{" "}
					<code>{prefix.trim() || template.defaultIdPrefix}-0001.md</code>. Must
					be unique across the whole vault.
				</small>
			</label>

			<label className="vf-template-toggle">
				<input
					type="checkbox"
					checked={populate}
					onChange={(event) => setPopulate(event.target.checked)}
				/>
				<span>
					Populate with example content
					<small>
						Adds sample Projects and Tasks you can explore, edit, or delete.
					</small>
				</span>
			</label>

			{error && <p className="vf-error">{error}</p>}

			<div className="vf-template-config-actions">
				<button
					type="button"
					className="mod-cta"
					disabled={busy || !valid}
					onClick={() => void submit()}
				>
					{busy ? "Creating…" : "Create workspace"}
				</button>
			</div>
		</div>
	);
}
