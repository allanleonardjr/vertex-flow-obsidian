import { useEffect, useMemo, useRef, useState } from "react";
import {
	parseFilterQuery,
	printFilters,
	queryContext,
} from "../../core/query";
import {
	applyFilters,
	canonicalizeFilters,
	filtersEqual,
	snapshotContext,
} from "../../core/views";
import type { ViewFilters, WorkspaceSnapshot } from "../../core/types";
import { resetAutoGrow } from "../components/autoGrow";
import { useMePersonId } from "../useMe";

const COMMIT_DELAY_MS = 200;
const MAX_COMMITS_PER_BURST = 5;

export function DashboardQueryBar({
	snapshot,
	filters,
	onChange,
}: {
	snapshot: WorkspaceSnapshot;
	filters: ViewFilters;
	onChange: (next: ViewFilters) => void;
}) {
	const mePersonId = useMePersonId(snapshot.workspace.root);
	const qctx = useMemo(
		() => queryContext(snapshot, mePersonId),
		[snapshot, mePersonId],
	);
	const viewCtx = useMemo(
		() => snapshotContext(snapshot, mePersonId),
		[snapshot, mePersonId],
	);

	const [text, setText] = useState(() => printFilters(filters, qctx));
	const [composing, setComposing] = useState(false);

	const lastAgreed = useRef(canonicalizeFilters(filters));
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const commitTimer = useRef<number | null>(null);
	const touched = useRef(false);
	const reverting = useRef(false);
	const commitsSinceInput = useRef(0);
	const blocked = useRef(false);

	const parsed = useMemo(() => parseFilterQuery(text, qctx), [text, qctx]);

	const cancelCommit = () => {
		if (commitTimer.current != null) {
			window.clearTimeout(commitTimer.current);
			commitTimer.current = null;
		}
	};

	const commit = (next: ViewFilters) => {
		commitsSinceInput.current += 1;
		if (commitsSinceInput.current > MAX_COMMITS_PER_BURST) {
			blocked.current = true;
			console.warn("[Vertex Flow] Dashboard query bar isn't settling.", next);
			return;
		}
		lastAgreed.current = next;
		onChange(next);
	};

	const flush = (): boolean => {
		cancelCommit();
		if (!parsed.ok) return false;
		if (filtersEqual(parsed.filters, lastAgreed.current)) return false;
		commit(parsed.filters);
		return true;
	};

	useEffect(() => {
		if (document.activeElement === inputRef.current) return;

		const desired = printFilters(filters, qctx);
		const fromUs = filtersEqual(filters, lastAgreed.current);
		if (fromUs && desired === text) return;

		cancelCommit();
		lastAgreed.current = canonicalizeFilters(filters);
		setText(desired);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- adopt effect derives from filters, not from deps
	}, [filters, qctx]);

	useEffect(() => {
		if (composing || blocked.current) return;
		if (!parsed.ok) return;
		if (filtersEqual(parsed.filters, lastAgreed.current)) return;
		if (text.trim() === "" && !touched.current) return;

		commitTimer.current = window.setTimeout(() => {
			commitTimer.current = null;
			commit(parsed.filters);
		}, COMMIT_DELAY_MS);
		return cancelCommit;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- commit effect keys off the parse result; parse() is the pipeline
	}, [parsed, composing]);

	useEffect(() => () => cancelCommit(), []);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		resetAutoGrow(el);
		el.style.height = `${el.scrollHeight}px`;
	}, [text]);

	useEffect(() => {
		const el = inputRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		let lastWidth = el.clientWidth;
		const observer = new ResizeObserver(() => {
			if (el.clientWidth === lastWidth) return;
			lastWidth = el.clientWidth;
			resetAutoGrow(el);
			el.style.height = `${el.scrollHeight}px`;
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const revert = () => {
		cancelCommit();
		reverting.current = true;
		setText(printFilters(filters, qctx));
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
		// See QueryBar.tsx's identical fix: compare against `lastAgreed`, not
		// `filters` fresh off the prop, so an external filter change can't
		// paint one frame of stale-vs-fresh mismatch before the adopt effect
		// resyncs `text`.
		if (filtersEqual(parsed.filters, lastAgreed.current)) return null;
		return applyFilters(snapshot.tasks, parsed.filters, viewCtx).length;
	}, [parsed, snapshot.tasks, viewCtx]);

	return (
		<div className="vf-query-row">
			<textarea
				ref={inputRef}
				rows={1}
				className="vf-input vf-query-input vf-auto-grow"
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
				autoComplete="off"
				placeholder="status:todo label:bug assignee:me"
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
						setText(printFilters(filters, qctx));
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
