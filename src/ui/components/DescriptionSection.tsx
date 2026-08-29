/**
 * A collapsible "Description" section — shared by the Saved View and Project
 * headers so both read and behave the same.
 *
 * Controlled collapse: the parent owns the flag (and persists it), because the
 * Project editor also gates a resize handle on it. The editor itself is a
 * borderless Markdown field, so it reads like a plain note rather than a form
 * control.
 */

import type { ReactNode } from "react";
import { MarkdownField } from "./Markdown";
import { useDebouncedSave } from "./fields";

export function DescriptionSection({
	collapsed,
	onToggleCollapsed,
	value,
	onSave,
	sourcePath,
	editorKey,
}: {
	collapsed: boolean;
	onToggleCollapsed: () => void;
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

			{!collapsed &&
				(value === null ? (
					<div className="vf-editor-loading">Loading…</div>
				) : (
					<DescriptionEditor
						key={editorKey}
						value={value}
						onSave={onSave}
						sourcePath={sourcePath}
					/>
				))}
		</>
	);
}

function DescriptionEditor({
	value,
	onSave,
	sourcePath,
}: {
	value: string;
	onSave: (text: string) => void;
	sourcePath: string;
}) {
	const [text, setText] = useDebouncedSave(value, onSave);

	return (
		<MarkdownField
			className="vf-editor-description vf-description-plain"
			value={text}
			onChange={setText}
			sourcePath={sourcePath}
			placeholder="Add a description… [[wikilinks]], #tags and ![[embeds]] all work"
		/>
	);
}
