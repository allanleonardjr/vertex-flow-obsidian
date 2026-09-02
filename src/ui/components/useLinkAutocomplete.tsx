/**
 * `[[wikilink]]` autocomplete for plain `<textarea>` Markdown fields.
 *
 * Obsidian's own link suggester only attaches to its real CodeMirror editor
 * instances, which a plain textarea isn't — so referencing a file correctly
 * (the whole point of this: "so they get intellisense for links... otherwise
 * they may not add the link correctly") needs its own small suggester here.
 * It matches the real one's basics: type `[[`, see matching notes, arrow keys
 * to move, Enter/Tab to insert, Escape to dismiss.
 */

import { TFile } from "obsidian";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { usePlugin } from "../context";
import { getCaretCoordinates } from "./caretPosition";

interface Suggestion {
	/** What gets inserted between the brackets. */
	insert: string;
	/** What the row shows. */
	label: string;
	sublabel?: string;
}

interface OpenState {
	/** Index into `value` where the triggering `[[` starts. */
	triggerStart: number;
	query: string;
	top: number;
	left: number;
}

const MAX_RESULTS = 20;
/** An open `[[` not yet closed by `]]` or interrupted by a newline. */
const TRIGGER_RE = /\[\[([^[\]\n]*)$/;

export interface LinkAutocompleteApi {
	/** Rendered as a sibling of the textarea; positioned absolutely. */
	node: React.ReactNode;
	onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
	/** Call after every value change and on caret movement (click, arrows). */
	sync: (textarea: HTMLTextAreaElement) => void;
	close: () => void;
}

export function useLinkAutocomplete(
	value: string,
	onChange: (value: string) => void,
): LinkAutocompleteApi {
	const plugin = usePlugin();
	const [state, setState] = useState<OpenState | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const elRef = useRef<HTMLTextAreaElement | null>(null);

	const candidates = useMemo(() => buildCandidates(plugin.app.vault.getMarkdownFiles(), plugin), [plugin]);

	const suggestions = useMemo(
		() => (state ? rank(candidates, state.query) : []),
		[candidates, state],
	);

	const close = useCallback(() => setState(null), []);

	const sync = useCallback((textarea: HTMLTextAreaElement) => {
		elRef.current = textarea;
		const caret = textarea.selectionStart;
		const before = textarea.value.slice(0, caret);
		const match = TRIGGER_RE.exec(before);

		if (!match) {
			setState(null);
			return;
		}

		const coords = getCaretCoordinates(textarea, caret);
		const rect = textarea.getBoundingClientRect();
		setActiveIndex(0);
		setState({
			triggerStart: caret - match[0].length,
			query: match[1],
			top: rect.top + coords.top + coords.height,
			left: rect.left + coords.left,
		});
	}, []);

	// Re-close if the vault's files change underneath an open popup (rare, but
	// a rename mid-type shouldn't leave stale suggestions selectable).
	useEffect(() => {
		if (state && suggestions.length === 0) setState(null);
	}, [state, suggestions.length]);

	const insert = useCallback(
		(suggestion: Suggestion) => {
			const textarea = elRef.current;
			if (!textarea || !state) return;

			const caret = textarea.selectionStart;
			const before = value.slice(0, state.triggerStart);
			const after = value.slice(caret);
			// Only append the closing brackets if they aren't already sitting
			// right there — typing `[[Foo` with an existing `]]` after the cursor
			// (from auto-inserted brackets) shouldn't double them up.
			const closer = after.startsWith("]]") ? "" : "]]";
			const next = `${before}[[${suggestion.insert}${closer}${after}`;
			onChange(next);
			close();

			// The result always has `]]` immediately after `insert` — either the
			// pair we just appended, or the pre-existing one left in `after` — so
			// the cursor lands the same distance past it either way.
			const cursor = before.length + 2 + suggestion.insert.length + 2;
			window.requestAnimationFrame(() => {
				textarea.focus();
				textarea.setSelectionRange(cursor, cursor);
			});
		},
		[state, value, onChange, close],
	);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
			if (!state || suggestions.length === 0) return;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActiveIndex((i) => (i + 1) % suggestions.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
			} else if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				insert(suggestions[activeIndex]);
			} else if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
			}
		},
		[state, suggestions, activeIndex, insert, close],
	);

	// Portaled to `document.body`, matching the board's drag preview: this is a
	// `position: fixed` popup positioned in viewport coordinates, and rendering
	// it inside the editor's own scrolling panes would risk a future ancestor
	// gaining a transform (which creates a new containing block for `fixed`
	// descendants and would silently reposition it).
	const node =
		state && suggestions.length > 0
			? createPortal(
					<div
						className="vf-autocomplete"
						style={{ top: state.top, left: state.left }}
						// Mousedown, not click: fires before the textarea's blur, so
						// focus (and the selection range `insert` needs) never leaves it.
						onMouseDown={(event) => event.preventDefault()}
					>
						{suggestions.map((suggestion, index) => (
							<div
								key={suggestion.insert + suggestion.label}
								className={`vf-autocomplete-item${
									index === activeIndex ? " is-active" : ""
								}`}
								onMouseEnter={() => setActiveIndex(index)}
								onMouseDown={() => insert(suggestion)}
							>
								<span className="vf-autocomplete-label">{suggestion.label}</span>
								{suggestion.sublabel && (
									<span className="vf-autocomplete-sublabel">
										{suggestion.sublabel}
									</span>
								)}
							</div>
						))}
					</div>,
					document.body,
				)
			: null;

	return { node, onKeyDown, sync, close };
}

interface Candidate {
	path: string;
	basename: string;
	aliases: string[];
}

function buildCandidates(
	files: TFile[],
	plugin: ReturnType<typeof usePlugin>,
): Candidate[] {
	return files.map((file) => {
		const cache = plugin.app.metadataCache.getFileCache(file);
		// `frontmatter` is `Record<string, any>` in Obsidian's typings; treat
		// the aliases value as `unknown` and narrow before mapping.
		const frontmatter = cache?.frontmatter;
		const aliases: unknown = frontmatter?.aliases;
		return {
			path: file.path.replace(/\.md$/i, ""),
			basename: file.basename,
			aliases: Array.isArray(aliases) ? aliases.map(String) : [],
		};
	});
}

/** Simple, fast ranking — prefix match beats substring, basename beats path. */
function rank(candidates: Candidate[], query: string): Suggestion[] {
	const needle = query.toLowerCase();
	const scored: { score: number; suggestion: Suggestion }[] = [];

	for (const candidate of candidates) {
		const basename = candidate.basename.toLowerCase();
		let score = -1;
		let via: string | null = null;

		if (!needle) {
			score = 0;
		} else if (basename.startsWith(needle)) {
			score = 3;
		} else if (basename.includes(needle)) {
			score = 2;
		} else if (candidate.path.toLowerCase().includes(needle)) {
			score = 1;
		} else {
			const alias = candidate.aliases.find((a) => a.toLowerCase().includes(needle));
			if (alias) {
				score = 1.5;
				via = alias;
			}
		}

		if (score >= 0) {
			scored.push({
				score,
				suggestion: via
					? { insert: `${candidate.path}|${via}`, label: via, sublabel: candidate.path }
					: { insert: candidate.path, label: candidate.basename, sublabel: candidate.path },
			});
		}
	}

	scored.sort((a, b) => b.score - a.score || a.suggestion.label.localeCompare(b.suggestion.label));
	return scored.slice(0, MAX_RESULTS).map((entry) => entry.suggestion);
}
