/**
 * The `?` shortcuts overlay (§9.1 / B5).
 *
 * A dismissible modal over the current tab — deliberately *not* a jump to the
 * Help tab, so the user can glance at it and immediately resume what they were
 * doing. Renders the authored keyboard-shortcuts help content through the same
 * `MarkdownContent` pipeline the Help pane uses.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { findHelpTopic, HELP_TOPICS } from "../../core/help";
import { MarkdownContent } from "../components/Markdown";

const HELP_SOURCE_PATH = "Vertex Flow Help.md";

export function ShortcutsHelpDialog({ onClose }: { onClose: () => void }) {
	// Esc closes the overlay (and nothing else — capture so it beats the shell's
	// tab-closing Escape handler).
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	const topic = findHelpTopic(HELP_TOPICS, "keyboard-shortcuts");

	return createPortal(
		<div className="vf-editor-backdrop" onClick={onClose}>
			<div
				className="vf-dialog vf-shortcuts-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Keyboard shortcuts"
				onClick={(event) => event.stopPropagation()}
			>
				{topic?.content ? (
					<MarkdownContent
						className="vf-shortcuts-dialog-body"
						text={topic.content}
						sourcePath={HELP_SOURCE_PATH}
					/>
				) : (
					<p>Shortcut reference unavailable.</p>
				)}
				<div className="vf-dialog-actions">
					<button className="mod-cta" autoFocus onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
