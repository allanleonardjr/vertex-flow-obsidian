/**
 * The text query row: a one-line editor for the whole view definition, kept in
 * two-way sync with the chip bar above it.
 *
 * The sync is the delicate part. The input keeps its own text buffer so a
 * half-typed query is never rewritten under the cursor, but it must re-derive
 * from the view when the change came from *outside* — a chip click, a view
 * switch, Reset. The single source of "who changed it?" is `lastAgreed`: the
 * definition both sides last concurred on. Comparing definitions rather than
 * strings is essential — committing `status:Todo` yields a definition that
 * prints as `status:todo`, and a string compare would fight the cursor.
 *
 * Termination rests on `parse(print(d))` deep-equalling `canonicalize(d)`
 * (Invariant A in `core/query`): after an adopt, the commit effect re-parses
 * exactly what was printed and lands back on `lastAgreed`, so it stops. The
 * `commitsSinceInput` counter is a backstop that names a printer bug rather
 * than letting it spin.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	parseQuery,
	printQuery,
	queryContext,
	type ParsedQuery,
} from "../../core/query";
import {
	applyFilters,
	canonicalizeDefinition,
	definitionsEqual,
	snapshotContext,
	viewDefinition,
} from "../../core/views";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";

const COMMIT_DELAY_MS = 200;
const MAX_COMMITS_PER_BURST = 5;

export function QueryBar({
	snapshot,
	view,
	onChange,
}: {
	snapshot: WorkspaceSnapshot;
	view: SavedView;
	onChange: (next: SavedView) => void;
}) {
	const qctx = useMemo(() => queryContext(snapshot), [snapshot]);
	const viewCtx = useMemo(() => snapshotContext(snapshot), [snapshot]);

	const [text, setText] = useState(() =>
		printQuery(viewDefinition(view), qctx),
	);
	const [composing, setComposing] = useState(false);

	const lastAgreed = useRef(canonicalizeDefinition(viewDefinition(view)));
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const commitTimer = useRef<number | null>(null);
	const touched = useRef(false);
	const reverting = useRef(false);
	const commitsSinceInput = useRef(0);
	/** Tripped by the settle backstop; cleared on the next keystroke. */
	const blocked = useRef(false);

	const parsed = useMemo<ParsedQuery>(
		() => parseQuery(text, qctx),
		[text, qctx],
	);

	const cancelCommit = () => {
		if (commitTimer.current != null) {
			window.clearTimeout(commitTimer.current);
			commitTimer.current = null;
		}
	};

	const commit = (definition: ParsedQuery["definition"]) => {
		commitsSinceInput.current += 1;
		if (commitsSinceInput.current > MAX_COMMITS_PER_BURST) {
			// Should be unreachable given Invariant A. Stop trying until the next
			// keystroke rather than spinning, and name the offending definition.
			blocked.current = true;
			console.warn("[Vertex Flow] Query bar isn't settling.", definition);
			return;
		}
		lastAgreed.current = definition; // pre-arm the adopt guard
		onChange({ ...view, ...definition });
	};

	/** Push the current text to the view now. Returns whether anything changed. */
	const flush = (): boolean => {
		cancelCommit();
		if (!parsed.ok) return false;
		if (definitionsEqual(parsed.definition, lastAgreed.current)) return false;
		commit(parsed.definition);
		return true;
	};

	/* -- adopt: view → text (external changes only, never under the cursor) -- */
	useEffect(() => {
		if (document.activeElement === inputRef.current) return; // defer to blur

		const incoming = viewDefinition(view);
		const desired = printQuery(incoming, qctx);
		const fromUs = definitionsEqual(incoming, lastAgreed.current);
		if (fromUs && desired === text) return;

		cancelCommit();
		lastAgreed.current = canonicalizeDefinition(incoming);
		setText(desired);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [view, qctx]);

	/* -- commit: text → view (debounced; Enter and blur flush) -------------- */
	useEffect(() => {
		if (composing || blocked.current) return;
		if (!parsed.ok) return;
		if (definitionsEqual(parsed.definition, lastAgreed.current)) return;
		if (text.trim() === "" && !touched.current) return; // stale box on mount

		commitTimer.current = window.setTimeout(() => {
			commitTimer.current = null;
			commit(parsed.definition);
		}, COMMIT_DELAY_MS);
		return cancelCommit;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [parsed, composing]);

	useEffect(() => () => cancelCommit(), []);

	// Grow the box to fit its content so a long query wraps into view rather than
	// scrolling out of sight on a narrow pane. Runs on every text change —
	// keystrokes and external adopts alike. `max-height` in CSS caps it.
	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [text]);

	const revert = () => {
		cancelCommit();
		reverting.current = true;
		setText(printQuery(viewDefinition(view), qctx));
		inputRef.current?.blur();
	};

	const replaceSpan = (start: number, end: number, replacement: string) => {
		touched.current = true;
		commitsSinceInput.current = 0;
		blocked.current = false;
		setText(text.slice(0, start) + replacement + text.slice(end));
		inputRef.current?.focus();
	};

	const errors = parsed.issues.filter((i) => i.severity === "error");
	const issue = errors[0] ?? parsed.issues[0];
	const issueQuote = issue
		? text.slice(issue.span.start, issue.span.end).trim()
		: "";

	const matchCount = useMemo(() => {
		if (!parsed.ok) return null;
		if (definitionsEqual(parsed.definition, viewDefinition(view))) return null;
		return applyFilters(snapshot.tasks, parsed.definition.filters, viewCtx)
			.length;
	}, [parsed, view, snapshot.tasks, viewCtx]);

	return (
		<div className="vf-query-row">
			<textarea
				ref={inputRef}
				rows={1}
				className="vf-input vf-query-input"
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
				autoComplete="off"
				placeholder="status:todo label:bug assignee:me group:status"
				value={text}
				aria-invalid={errors.length > 0}
				onChange={(event) => {
					touched.current = true;
					commitsSinceInput.current = 0;
					blocked.current = false;
					setText(event.target.value);
				}}
				onCompositionStart={() => setComposing(true)}
				onCompositionEnd={() => setComposing(false)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						flush();
					} else if (event.key === "Escape") {
						event.preventDefault();
						revert();
					}
				}}
				onBlur={() => {
					if (reverting.current) {
						reverting.current = false;
						return;
					}
					const committed = flush();
					if (!committed) {
						// Normalise the display and pick up anything that changed
						// elsewhere while the box was focused.
						setText(printQuery(viewDefinition(view), qctx));
					}
				}}
			/>

			{issue && (
				<p
					className={`vf-query-issue${
						issue.severity === "error" ? " vf-error" : ""
					}`}
				>
					{issueQuote && <code>{issueQuote}</code>} {issue.message}
					{issue.suggestion && (
						<>
							{" — "}
							<button
								type="button"
								className="vf-query-fix"
								onMouseDown={(event) => event.preventDefault()}
								onClick={() =>
									replaceSpan(
										issue.span.start,
										issue.span.end,
										issue.suggestion as string,
									)
								}
							>
								{issue.suggestion}
							</button>
						</>
					)}
				</p>
			)}

			{matchCount != null && (
				<p className="vf-query-issue vf-query-count">
					→ {matchCount} {matchCount === 1 ? "task" : "tasks"}
				</p>
			)}
		</div>
	);
}
