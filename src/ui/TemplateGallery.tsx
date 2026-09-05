/**
 * Workspace creation.
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
import { useEffect, useMemo, useRef, useState } from "react";
import {
	WORKSPACE_TEMPLATES,
	type TemplateSetting,
	type WorkspaceTemplate,
} from "../core/templates";
import { joinPath, sanitizeFileName } from "../core/links";
import { suggestPrefix } from "../core/ids";
import { SYSTEM_VIEW_ALL_TASKS_ID } from "../core/views";
import { Icon, IconField } from "./components/Icon";
import { usePlugin, useSetActiveWorkspace } from "./context";
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

function scrollCardIntoView(card: HTMLElement) {
	card.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * Column count of the template grid, derived from the live render: the number
 * of cards on the first row. `auto-fill/minmax` means the width is fluid, so
 * this is the only reliable way to know how wide a row is.
 */
function gridColumns(grid: HTMLElement): number {
	const cards = Array.from(
		grid.querySelectorAll<HTMLElement>("[data-template]"),
	);
	if (cards.length <= 1) return 1;
	const top = cards[0].offsetTop;
	return cards.findIndex((card) => card.offsetTop !== top);
}

function Gallery({
	onPick,
	onClose,
}: {
	onPick: (template: WorkspaceTemplate) => void;
	onClose?: () => void;
}) {
	const gridRef = useRef<HTMLDivElement>(null);

	// Give "Getting Started" initial focus (not selection) so a self-directed
	// user can jump in immediately, while Blank leads the visual order. Keyboard
	// focus starts here rather than on the very first card because most users
	// pick the guided template — but nothing is opened until Enter/Space or a click.
	useEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;
		const card = grid.querySelector<HTMLElement>(
			'[data-template="getting-started"]',
		);
		if (card) {
			card.focus();
			scrollCardIntoView(card);
		}
	}, []);

	// Keyboard navigation between the cards (vim j/k plus the arrows). The
	// gallery is an onboarding pane with no TaskViewport mounted, so the normal
	// j/k/arrow bindings are absent — this window handler brings them back,
	// moving DOM focus card-to-card so the existing Enter/Space handlers do
	// the rest.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (
				target?.isContentEditable ||
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement
			) {
				return;
			}
			const grid = gridRef.current;
			if (!grid) return;
			const cards = Array.from(
				grid.querySelectorAll<HTMLElement>("[data-template]"),
			);
			if (cards.length === 0) return;

			const active = document.activeElement;
			const index =
				active instanceof HTMLElement
					? cards.indexOf(active)
					: -1;

			// If nothing is focused yet, start from the first card.
			const from = index >= 0 ? index : 0;
			const cols = gridColumns(grid);
			const total = cards.length;
			const rowOf = (i: number) => Math.floor(i / cols);
			const clamp = (i: number) =>
				Math.max(0, Math.min(total - 1, i));

			const moveTo = (target: number) => {
				event.preventDefault();
				event.stopPropagation();
				const next = clamp(target);
				cards[next].focus();
				scrollCardIntoView(cards[next]);
			};

			// j/↓ move to the next row, k/↑ to the previous row, staying in
			// the same visual column. ←/→ (and vim h/l) move within the row.
			if (event.key === "ArrowDown" || event.key === "j")
				moveTo(from + cols);
			else if (event.key === "ArrowUp" || event.key === "k")
				moveTo(from - cols);
			else if (
				event.key === "ArrowRight" ||
				event.key === "l"
			)
				moveTo(rowOf(from) === rowOf(from + 1) ? from + 1 : from);
			else if (event.key === "ArrowLeft" || event.key === "h")
				moveTo(rowOf(from) === rowOf(from - 1) ? from - 1 : from);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);

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

			<div className="vf-template-grid" ref={gridRef}>
				{WORKSPACE_TEMPLATES.map((template) => (
					<div
						key={template.id}
						data-template={template.id}
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
	const setActiveWorkspace = useSetActiveWorkspace();

	const [name, setName] = useState(template.name);
	const [icon, setIcon] = useState(template.icon);
	const [location, setLocation] = useState(plugin.settings.defaultWorkspaceFolder);
	// The prefix tracks the name until the user types their own — then it sticks.
	// Clearing the field re-links it to the name.
	const [prefixOverride, setPrefixOverride] = useState<string | null>(null);
	const [selfName, setSelfName] = useState("");
	const [populate, setPopulate] = useState(false);
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

	const takenPrefixes = useMemo(
		() =>
			new Set(
				plugin.index.takenPrefixes().map((p) => p.trim().toUpperCase()),
			),
		[plugin],
	);

	const suggestedPrefix = useMemo(() => {
		// Derived live from the name until the user types their own prefix.
		if (!name.trim()) return "";
		return suggestPrefix(name, plugin.index.takenPrefixes());
	}, [name, plugin]);
	const prefix = prefixOverride ?? suggestedPrefix;

	// Only a hand-typed prefix can collide — the derived one is already
	// disambiguated by `suggestPrefix`.
	const prefixTaken =
		prefix.trim().length > 0 &&
		takenPrefixes.has(prefix.trim().toUpperCase());

	// The selected folder is the *parent* — the workspace folder itself is
	// named from the workspace and created inside it.
	const parent = location.trim();
	const folderName = sanitizeFileName(name);
	const targetPath = joinPath(parent, folderName);
	const taken =
		targetPath.length > 0 &&
		plugin.app.vault.getAbstractFileByPath(targetPath) != null;
	const parentMissing =
		parent.length > 0 &&
		plugin.app.vault.getAbstractFileByPath(parent) == null;

	const valid = name.trim().length > 0 && !prefixTaken;

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			const root = plugin.io.availableFolderPath(targetPath);
			await plugin.mutations.createWorkspaceFromTemplate({
				template,
				name: name.trim(),
				root,
				idPrefix: prefix.trim() || undefined,
				icon,
				includeExampleContent:
					template.supportsExampleContent !== false && populate,
				selfPersonName: selfName.trim() || undefined,
			});
			// Nothing keeps a tab open on a new workspace's behalf — open All
			// Tasks explicitly (it always has the most to show). The tab strip
			// picks this up on its next mount / workspace switch.
			plugin.pendingOpenView = SYSTEM_VIEW_ALL_TASKS_ID;
			setActiveWorkspace(root);
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

			<div className="vf-icon-name-row">
				<div className="vf-field vf-field-icon">
					<span>Icon</span>
					<IconField
						value={icon}
						fallback="layers"
						onChange={setIcon}
					/>
				</div>
				<label className="vf-field vf-field-name">
					<span>Name</span>
					<input
						type="text"
						value={name}
						autoFocus
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
			</div>
			<p className="vf-template-sub">{template.description}</p>

			<label className="vf-field">
				<span>Location</span>
				<div className="vf-folder-field">
					<input
						type="text"
						list="vf-template-folder-options"
						value={location}
						placeholder="Vault root"
						onChange={(event) => setLocation(event.target.value)}
					/>
					<button
						type="button"
						title="Browse for a folder"
						onClick={() =>
							new FolderSuggestModal(plugin.app, (chosen) =>
								setLocation(chosen.isRoot() ? "" : chosen.path),
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
				<small>
					Creates <code>{targetPath || folderName}/</code>.
					{taken
						? " A folder is already there, so a numbered one will be created instead."
						: parentMissing
							? " This location doesn't exist yet and will be created."
							: ""}
				</small>
			</label>

			<label className="vf-field">
				<span>Task ID prefix</span>
				<input
					type="text"
					value={prefix}
					placeholder="Optional — derived from the name"
					aria-invalid={prefixTaken}
					onChange={(event) => {
						const next = event.target.value.toUpperCase();
						setPrefixOverride(next === "" ? null : next);
					}}
				/>
				{prefixTaken ? (
					<small className="vf-field-error">
						<code>{prefix.trim().toUpperCase()}</code> is already used by
						another workspace — pick a different prefix.
					</small>
				) : (
					<small>
						Task files are named by ID —{" "}
						<code>{prefix.trim() || "TSK"}-0001.md</code>. Must be unique
						across the whole vault.
					</small>
				)}
			</label>

			<label className="vf-field">
				<span>Your name (optional)</span>
				<input
					type="text"
					value={selfName}
					placeholder="How your name appears on tasks and in comments"
					onChange={(event) => setSelfName(event.target.value)}
				/>
				<small>
					Adds you to the People register as “me”, so “Assigned to Me” and
					“Mentions Me” work right away. You can change this later in Settings.
				</small>
			</label>

			{template.supportsExampleContent !== false && (
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
			)}

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
