/**
 * A collapsible "Description" section — shared by the Saved View and Project
 * headers so both read and behave the same.
 *
 * Controlled collapse: the parent owns the flag (and persists it), because the
 * Project editor also gates a resize handle on it. The editor itself is a
 * borderless Markdown field, so it reads like a plain note rather than a form
 * control.
 *
 * Source mode is controlled the same way and for the same reason it's
 * plugin-global: Live Preview vs. raw Source is a way of working, not a
 * property of one task (see `descriptionSourceMode` in `settings/types.ts`).
 */

import { useState, type ReactNode } from "react";
import { Code2, Eye } from "lucide-react";
import { MarkdownField } from "./Markdown";
import { useDebouncedSave } from "./fields";
import { usePlugin } from "../context";

export function DescriptionSection({
	collapsed,
	onToggleCollapsed,
	sourceMode,
	onToggleSourceMode,
	value,
	onSave,
	sourcePath,
	editorKey,
}: {
	collapsed: boolean;
	onToggleCollapsed: () => void;
	/** Show raw Markdown source instead of Live Preview. */
	sourceMode: boolean;
	onToggleSourceMode: () => void;
	/** `null` while the text is still loading (Project bodies are read lazily). */
	value: string | null;
	onSave: (text: string) => void;
	/** Note the Markdown field resolves `[[links]]` against. */
	sourcePath: string;
	/** Remounts the editor when the entity changes, so the buffer reseeds. */
	editorKey: string;
}): ReactNode {
	return (
		<>
			<div className="vf-description-head">
				<button
					type="button"
					className="vf-rail-section-toggle vf-description-toggle"
					aria-expanded={!collapsed}
					onClick={onToggleCollapsed}
				>
					<span
						className={`vf-section-chevron${collapsed ? "" : " is-open"}`}
						aria-hidden
					>
						›
					</span>
					Description
				</button>

				{/* Only meaningful while there's an editor to switch — matches how
				    the editors' resize handles are gated on the expanded state. */}
				{!collapsed && (
					<button
						type="button"
						className={`vf-icon-button vf-description-source-toggle${
							sourceMode ? " is-on" : ""
						}`}
						aria-pressed={sourceMode}
						title={sourceMode ? "Show Live Preview" : "Show raw source"}
						aria-label={sourceMode ? "Show Live Preview" : "Show raw source"}
						onClick={onToggleSourceMode}
					>
						{sourceMode ? <Eye size={14} /> : <Code2 size={14} />}
					</button>
				)}
			</div>

			{!collapsed &&
				(value === null ? (
					<div className="vf-editor-loading">Loading…</div>
				) : (
					<DescriptionEditor
						key={editorKey}
						value={value}
						onSave={onSave}
						sourcePath={sourcePath}
						sourceMode={sourceMode}
					/>
				))}
		</>
	);
}

function DescriptionEditor({
	value,
	onSave,
	sourcePath,
	sourceMode,
}: {
	value: string;
	onSave: (text: string) => void;
	sourcePath: string;
	sourceMode: boolean;
}) {
	const [text, setText] = useDebouncedSave(value, onSave);

	return (
		<MarkdownField
			className="vf-editor-description vf-description-plain"
			value={text}
			onChange={setText}
			sourcePath={sourcePath}
			placeholder="Add a description… [[wikilinks]], #tags and ![[embeds]] all work"
			forceRawSource={sourceMode}
		/>
	);
}

/**
 * The same Markdown editor + source toggle as `DescriptionSection`, but fully
 * controlled for dialogs: nothing is written anywhere until the dialog's
 * Confirm runs, so the text lives in the caller's local state (via `onChange`)
 * instead of a debounced save. Source mode stays plugin-global the same way
 * the editing surfaces do — it's a way of working, not per-row state.
 */
export function DescriptionDialogField({
	value,
	onChange,
	sourcePath,
}: {
	value: string;
	onChange: (value: string) => void;
	sourcePath: string;
}): ReactNode {
	const plugin = usePlugin();
	const [sourceMode, setSourceMode] = useState(
		plugin.settings.descriptionSourceMode,
	);

	const toggleSourceMode = () => {
		const next = !sourceMode;
		setSourceMode(next);
		plugin.settings.descriptionSourceMode = next;
		void plugin.saveSettings();
	};

	return (
		<div className="vf-field vf-field-description">
			<div className="vf-description-head">
				<span className="vf-description-label">Description</span>
				<button
					type="button"
					className={`vf-icon-button vf-description-source-toggle${
						sourceMode ? " is-on" : ""
					}`}
					aria-pressed={sourceMode}
					title={sourceMode ? "Show Live Preview" : "Show raw source"}
					aria-label={sourceMode ? "Show Live Preview" : "Show raw source"}
					onClick={toggleSourceMode}
				>
					{sourceMode ? <Eye size={14} /> : <Code2 size={14} />}
				</button>
			</div>
			<MarkdownField
				className="vf-editor-description vf-description-dialog"
				value={value}
				onChange={onChange}
				sourcePath={sourcePath}
				placeholder="Add a description… [[wikilinks]], #tags and ![[embeds]] all work"
				forceRawSource={sourceMode}
			/>
		</div>
	);
}
