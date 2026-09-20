/**
 * AI Chat: a zero-install, in-browser chat over the active workspace.
 *
 * Query-on-demand, not full injection: every message sends a small,
 * fixed-cost facts layer (`buildFactsSection` — counts + taxonomy legend +
 * people roster, bounded by workspace *configuration*, never by task count)
 * plus the conversation history. When a question needs specific task data,
 * the model emits a `searchTasks`/`countTasks` JSON action instead of prose;
 * that's parsed and validated (`parseQueryAction`), run against the exact
 * filtering engine that powers Saved Views (`executeQueryAction` →
 * `applyFilters`), and the result is fed back for a second, final model call.
 * A plain question that doesn't need data completes in one call — the second
 * call only happens when an action was actually issued. Capped at one query
 * round trip per message (see `send()`), so worst case is two model calls,
 * never an open-ended agent loop.
 *
 * History lives in `AiChatSessionProvider` (an ancestor that survives
 * switching tabs away and back) and is reset when the AI Chat tab is closed —
 * session-only, never persisted to disk (computed, never stored). Query
 * results are likewise never stored — recomputed fresh from the live
 * snapshot on every message, so a taxonomy rename shows up on the very next
 * question with no restart needed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { buildFactsSection } from "../../core/ai/snapshot";
import { matchHelpTopic } from "../../core/ai/help-retrieval";
import { resolveTaskIdFragments, type TaskIdFragmentMatch } from "../../core/ai/resolve-task-ids";
import {
	executeQueryAction,
	looksLikeJsonAttempt,
	parseQueryAction,
} from "../../core/ai/query-action";
import { HELP_TOPICS } from "../../core/help";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { ViewContext } from "../../core/views";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import {
	AI_MODEL_OPTIONS,
	aiModelInfo,
	AiEngineService,
	type AiChatMessage,
	type AiEngineState,
} from "../../ai/AiEngineService";
import { EmptyView } from "../components/EmptyView";
import { Icon } from "../components/Icon";
import { MarkdownContent } from "../components/Markdown";
import { TaskList } from "../components/TaskList";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";
import { type AiChatBubble, useAiChatSession } from "./ai-chat-session";

/**
 * A pseudo vault path for `MarkdownContent`'s `sourcePath` — there's no real
 * note behind a chat bubble, but a relative link/embed still needs something
 * to resolve against, the same role `HELP_SOURCE_PATH` plays for the Help pane
 * (see `HelpView.tsx`/`ShortcutsHelpDialog.tsx`).
 */
const AI_CHAT_SOURCE_PATH = "Vertex Flow AI Chat.md";

/** How long the Copy button shows its confirmation checkmark. */
const COPY_CONFIRM_MS = 1500;

/**
 * Shown instead of raw JSON when a second-call response still looks like JSON
 * (a query action or not — see the `looksLikeJsonAttempt` check after
 * `streamVisible` in `runTurn`). The second call has no structural guarantee of producing
 * final prose (unlike the buffered-and-checked first call), so this is the
 * deterministic backstop rather than a further model call.
 */
const QUERY_ACTION_FALLBACK = "I wasn't able to answer that — try asking in a different way.";

const INSTRUCTIONS = `You are an assistant embedded in the Vertex Flow task manager (an Obsidian plugin).

You're given a small facts section (counts, and this workspace's configured statuses/priorities/task types/labels/people — all fully user-configurable, so use these definitions, never generic assumptions or names from other tools).

You do NOT have the task list itself. When a question needs specific tasks — a filtered list, a count under some filter, or anything about individual task identities — respond with ONLY a JSON object on its own, nothing else, in this exact shape:
{"action": "searchTasks", "filters": {"status": ["In Progress"], "project": ["Launch"]}}
or, when only a number is needed:
{"action": "countTasks", "filters": {"assignee": ["Alice"], "openOnly": true}}
or, for anything about overdue work — never express "overdue" via the text filter, it only does a substring match and will never work for this:
{"action": "searchTasks", "filters": {"overdue": true, "project": ["Launch"]}}

Recognized filter keys: status, priority, taskType, labels, assignee, project, parent, mentions (all arrays of this workspace's display names), text (substring match — NOT for concepts like "overdue"), archived ("included" or "only"), openOnly, unscheduled, recurring, overdue (booleans). Use display names exactly as given in the facts section — never invent a field name. Omit filters you don't need; an empty/omitted filter matches everything. Only ever emit ONE such object, and nothing besides it, when you need data — no other text before or after it.

If a question is answerable from the facts section alone (totals, what statuses/priorities/task types/people exist), or needs no workspace data at all, just answer directly in plain language — never emit a JSON action for those. This includes self-referential questions about you, the assistant — "what can you do?", "help", "who are you?", "what is this?" — always answer those directly, in plain language, describing your own capabilities; a JSON action can never answer a question about yourself.

When a "## How Vertex Flow works" section is present below, it's real documentation for this exact app — answer questions about app behavior/features from it directly rather than guessing, and don't mix it up with the workspace's own data.`;

/**
 * Formats resolved bare task-ID number fragments (see `resolve-task-ids.ts`)
 * into the same single system message as the facts/help sections — never a
 * second message object, the exact mistake that caused `SystemMessageOrderError`
 * for the help-topic injection earlier. Rebuilt fresh per turn from the
 * current message only, so a resolution never lingers past the turn it was
 * found in.
 */
function formatTaskIdResolutionNote(fragmentMatches: TaskIdFragmentMatch[]): string {
	if (fragmentMatches.length === 0) return "";
	const lines = fragmentMatches.map(({ fragment, matches }) => {
		if (matches.length === 1) {
			const match = matches[0];
			return `"${fragment}" in the user's message refers to ${match.id} ("${match.title}").`;
		}
		const candidates = matches.map((match) => `${match.id} ("${match.title}")`).join(", ");
		return `"${fragment}" in the user's message could refer to more than one task: ${candidates}. Ask the user which one they mean rather than guessing.`;
	});
	return `\n\n## Task ID reference\n${lines.join("\n")}`;
}

interface RunTurnDeps {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
}

/**
 * Coalesces rapid updates (a streaming assistant message can append a token
 * every few milliseconds) down to at most one per animation frame, so
 * `MarkdownContent`'s full re-render (it clears and rebuilds the DOM via
 * Obsidian's `MarkdownRenderer` on every text change) doesn't run on every
 * single token. Always settles to the exact latest value — the last update
 * schedules one more frame, so nothing is ever left stale once streaming
 * stops.
 */
function useThrottledText(text: string): string {
	const [display, setDisplay] = useState(text);
	const latestRef = useRef(text);
	latestRef.current = text;
	const frameRef = useRef<number | null>(null);

	useEffect(() => {
		if (frameRef.current != null) return;
		frameRef.current = window.requestAnimationFrame(() => {
			frameRef.current = null;
			setDisplay(latestRef.current);
		});
	}, [text]);

	useEffect(
		() => () => {
			if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	return display;
}

/**
 * One mounted instance per message, so `useThrottledText`'s hook call is
 * stable regardless of how many messages are in the list. Also resolves a
 * resolved `searchTasks` action's `taskPaths` against the *current* snapshot
 * on every render — never freezing the `Task` objects matched at query time —
 * so a status change or deletion afterward shows up immediately rather than a
 * stale result from when the question was asked. A path that no longer
 * resolves (task deleted since) is silently dropped rather than shown broken;
 * if every path drops, no list renders at all.
 */
function AiChatBubbleContent({
	text,
	taskPaths,
	snapshot,
	taxonomies,
	onOpenTask,
}: {
	text: string;
	taskPaths?: string[];
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	onOpenTask: (path: string) => void;
}) {
	const display = useThrottledText(text);
	const resolvedTasks = useMemo(() => {
		if (!taskPaths || taskPaths.length === 0) return [];
		const byPath = new Map(snapshot.tasks.map((task) => [task.path, task]));
		return taskPaths
			.map((path) => byPath.get(path))
			.filter((task): task is Task => task != null);
	}, [taskPaths, snapshot]);

	return (
		<>
			<MarkdownContent text={display} sourcePath={AI_CHAT_SOURCE_PATH} />
			{resolvedTasks.length > 0 && (
				<TaskList
					className="vf-chat-task-list"
					groups={[{ key: "ai-results", tasks: resolvedTasks }]}
					snapshot={snapshot}
					taxonomies={taxonomies}
					onOpenTask={onOpenTask}
				/>
			)}
		</>
	);
}

/** Shown in place of an assistant bubble's content before the first token has streamed in. Pure CSS animation — no timers, no state. */
function ThinkingIndicator() {
	return (
		<span className="vf-chat-thinking" aria-label="Thinking…">
			<span className="vf-chat-thinking-dot" />
			<span className="vf-chat-thinking-dot" />
			<span className="vf-chat-thinking-dot" />
		</span>
	);
}

export function AiChatView({
	snapshot,
	taxonomies,
	context,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
}) {
	const plugin = usePlugin();
	const { openScreen, openTask } = useTabs();
	const supported = AiEngineService.supportsWebGPU();

	const [engineState, setEngineState] = useState<AiEngineState | "checking">("checking");
	// Real shard-loading progress for the "checking" state below — mirrors
	// `AiModelRow` in Settings' `{ pct, text }` shape exactly, same progress
	// callback `install()` already supports. `null` before the first progress
	// event fires (the brief `getState()` cache-check window, or a reactivation
	// fast enough that few/no events arrive) — the render falls back to a
	// generic message for that gap.
	const [loadingProgress, setLoadingProgress] = useState<{ pct: number; text: string } | null>(null);
	const { messages, setMessages, justSwitchedModel } = useAiChatSession();
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	// Set the instant `stop()` is clicked, purely so the button can reflect the
	// click immediately — `interrupt()`/the underlying call settling can lag
	// behind that (see the module doc's non-goal: this doesn't chase WebLLM's
	// own interrupt latency, only the UI's acknowledgment of it).
	const [stopping, setStopping] = useState(false);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const bodyRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	// Checked (not React state) after every `chat()` call settles — Stop needs
	// to flip this synchronously with the click, well before any state update
	// from that call's own `.then`/`.finally` would land.
	const stoppedRef = useRef(false);

	const selectedModelId = plugin.settings.selectedAiModelId;
	const selectedModelLabel =
		AI_MODEL_OPTIONS.find((option) => option.id === selectedModelId)?.label ?? selectedModelId;
	const selectedModelInfo = aiModelInfo(selectedModelId);

	// Re-runs whenever `selectedAiModelId` changes (a settings-screen switch
	// bumps `plugin.index.revision` via `useSettingsWriter`, which re-renders
	// this component even in another split pane) — activates whatever model is
	// now selected, loading it fresh on next open exactly as if this were a
	// brand-new mount.
	//
	// Skip the async cache/worker round trip entirely when the selected model
	// is already the one loaded in the worker (the common case of switching
	// away to another tab and back without changing models) — otherwise every
	// remount re-hides the intact message history behind a "Loading…" flash.
	useEffect(() => {
		if (plugin.aiEngine.activeModelId === selectedModelId) {
			setEngineState("installed");
			return;
		}
		let cancelled = false;
		setEngineState("checking");
		// Stale progress from a previous model/mount must never linger into this
		// one's loading state.
		setLoadingProgress(null);
		void plugin.aiEngine.getState(selectedModelId).then(async (state) => {
			if (cancelled) return;
			if (state !== "installed") {
				setEngineState(state);
				return;
			}
			// Cached model: this just loads/activates it in the worker, no
			// download — but genuinely reports progress while loading shards from
			// cache into GPU memory, not only during a fresh download.
			const loaded = await plugin.aiEngine.install(selectedModelId, (report) => {
				if (!cancelled) setLoadingProgress({ pct: Math.round(report.progress * 100), text: report.text });
			});
			if (!cancelled) setEngineState(loaded);
		});
		return () => {
			cancelled = true;
		};
	}, [plugin, selectedModelId]);

	useEffect(() => {
		bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
	}, [messages]);

	const appendToLastAssistant = (chunk: string) => {
		if (!chunk) return;
		setMessages((prev) => {
			const next = [...prev];
			const last = next[next.length - 1];
			if (last?.role === "assistant") last.content += chunk;
			return next;
		});
	};

	const setLastAssistant = (content: string) => {
		setMessages((prev) => {
			const next = [...prev];
			const last = next[next.length - 1];
			if (last?.role === "assistant") last.content = content;
			return next;
		});
	};

	/** Attaches a resolved `searchTasks` action's result paths to the last (just-answered) assistant message, for `AiChatBubbleContent` to render as a real task list. */
	const setLastAssistantTaskPaths = (taskPaths: string[]) => {
		setMessages((prev) => {
			const next = [...prev];
			const last = next[next.length - 1];
			if (last?.role === "assistant") last.taskPaths = taskPaths;
			return next;
		});
	};

	/**
	 * Always streams live into the visible bubble — only ever called for a
	 * response the user should watch appear. Returns the full streamed text so
	 * callers can run a post-hoc check on it (see the `looksLikeJsonAttempt`
	 * safety net in `runTurn`) — the bubble's own state updates asynchronously
	 * via `appendToLastAssistant`, so this tracks the same text locally rather
	 * than reading it back out of `messages`.
	 */
	const streamVisible = async (request: AiChatMessage[]): Promise<string> => {
		setLastAssistant("");
		let full = "";
		const onToken = (chunk: string) => {
			full += chunk;
			appendToLastAssistant(chunk);
		};
		try {
			await plugin.aiEngine.chat(request, onToken);
		} catch (error) {
			if (!stoppedRef.current) throw error;
			// Interrupted mid-stream — WebLLM may throw or may just end the
			// iteration early; either way, leave whatever streamed in place
			// rather than losing it, and fall through to mark it stopped below.
		}
		if (stoppedRef.current) {
			appendToLastAssistant(" [stopped]");
			full += " [stopped]";
		}
		return full;
	};

	const runTurn = async (history: AiChatMessage[], deps: RunTurnDeps) => {
		const facts = buildFactsSection(deps.snapshot, deps.taxonomies);

		// Retrieval over the bundled Help docs, independent of the workspace
		// facts/data layer above — at most one topic, kept as its own clearly
		// labeled section so either can be reasoned about (or omitted) on its
		// own. Matched against the latest user message only, not the whole
		// history. WebLLM only accepts a single system message and requires it
		// at index 0 (throws `SystemMessageOrderError` otherwise), so this has
		// to be folded into the one system message rather than added as its own —
		// unlike the facts section, it's genuinely optional, so it's only
		// appended when there's a match.
		const latestUserMessage = [...history].reverse().find((message) => message.role === "user");
		const helpTopic = latestUserMessage ? matchHelpTopic(latestUserMessage.content, HELP_TOPICS) : null;
		const helpSection = helpTopic
			? `\n\n## How Vertex Flow works: ${helpTopic.title}\n${helpTopic.content ?? ""}`
			: "";

		// A small local model isn't reliable at matching a bare number ("task
		// 40") against padded/unpadded IDs buried in the facts table — resolved
		// deterministically here instead, same principle as query-action's
		// filter-value resolution. Same single-system-message constraint as the
		// help section above.
		const idSection = formatTaskIdResolutionNote(
			latestUserMessage ? resolveTaskIdFragments(latestUserMessage.content, deps.snapshot.tasks) : [],
		);

		const baseRequest: AiChatMessage[] = [
			{ role: "system", content: `${INSTRUCTIONS}\n\n## Facts\n${facts}${helpSection}${idSection}` },
			...history,
		];

		// The first call is never shown directly — there's no way to know
		// whether it's a JSON query action or the final answer until it's
		// fully generated, so it's buffered silently rather than streamed.
		let firstResponse: string;
		try {
			firstResponse = await plugin.aiEngine.chat(baseRequest, () => {});
		} catch (error) {
			if (!stoppedRef.current) throw error;
			setLastAssistant("Stopped.");
			return;
		}

		if (stoppedRef.current) {
			// Interrupted mid-first-call: cancel the turn outright — never fire
			// a second call on a response the user asked to stop. `firstResponse`
			// is never shown here, complete or partial — it's an internal buffer
			// that may be raw/garbled JSON mid-emission (`{ [stopped]`), never
			// something meant to reach the user unfiltered, unlike a genuinely
			// streamed-and-visible second-call response.
			setLastAssistant("Stopped before responding.");
			return;
		}

		const action = parseQueryAction(firstResponse);

		if (action) {
			const queryResult = executeQueryAction(action, deps.snapshot, deps.context);
			const secondRequest: AiChatMessage[] = [
				...baseRequest,
				{ role: "assistant", content: firstResponse },
				{
					role: "user",
					content: `Query result:\n${queryResult.text}\n\nAnswer the original question using this — don't mention the query mechanism itself.`,
				},
			];
			const secondResponse = await streamVisible(secondRequest);
			// The second call has no structural check on it the way the first
			// call's buffered response does (`parseQueryAction` runs before
			// anything is shown) — this is the deterministic backstop for the
			// rare case it still emits JSON instead of prose (a valid-shaped
			// action, or off-schema JSON like `{"labels": [...]}` naming neither
			// action — `looksLikeJsonAttempt` catches both). The JSON will have
			// flashed on screen briefly as it streamed in; that's an accepted
			// tradeoff against buffering every second call and losing live
			// streaming for the common, correct case.
			if (!stoppedRef.current && looksLikeJsonAttempt(secondResponse)) {
				setLastAssistant(QUERY_ACTION_FALLBACK);
			} else if (queryResult.tasks && queryResult.tasks.length > 0) {
				// `searchTasks` only — `countTasks` never sets `tasks` (nothing to
				// list). Paths only, not the `Task` objects themselves: resolved
				// against the live snapshot at render time (see
				// `AiChatBubbleContent`), so a later status change or deletion is
				// reflected instead of frozen at query time.
				setLastAssistantTaskPaths(queryResult.tasks.map((task) => task.path));
			}
			return;
		}

		if (looksLikeJsonAttempt(firstResponse)) {
			// Attempted an action but it didn't validate (unrecognized filter
			// keys, wrong value types, an off-schema shape naming no `action` at
			// all like `{"labels": ["Community/Discord"]}`, …) — spend the one
			// retry budget on a corrective nudge rather than surfacing raw JSON to
			// the user. Broader than `looksLikeQueryAction` deliberately: any
			// JSON-shaped output that didn't already resolve as a real action
			// above belongs here, not in the plain-text branch below.
			const retryRequest: AiChatMessage[] = [
				...baseRequest,
				{ role: "assistant", content: firstResponse },
				{
					role: "user",
					content:
						"That query action wasn't valid — it used an unrecognized filter or field. " +
						"Answer directly from what you already know instead.",
				},
			];
			const retryResponse = await streamVisible(retryRequest);
			// Same safety net as the successful-query path above — this call is
			// meant to produce a corrective plain-language answer, but nothing
			// stops the model from emitting another (still invalid, or still
			// off-schema) JSON attempt.
			if (!stoppedRef.current && looksLikeJsonAttempt(retryResponse)) {
				setLastAssistant(QUERY_ACTION_FALLBACK);
			}
			return;
		}

		// Ordinary text: the already-buffered first-call response IS the final
		// answer — show it in one shot rather than re-generating with a second
		// call, which is what keeps a plain question to a single model call.
		setLastAssistant(firstResponse);
	};

	/** Shared by `send()` and `retry()`: appends the fresh assistant placeholder, flips `sending`, and runs the turn. `history` should already end with the user message the response is for. */
	const beginTurn = (history: AiChatBubble[]) => {
		stoppedRef.current = false;
		setStopping(false);
		setMessages([...history, { id: crypto.randomUUID(), role: "assistant", content: "" }]);
		setSending(true);

		void runTurn(history, { snapshot, taxonomies, context })
			.catch((error: unknown) => {
				if (stoppedRef.current) return;
				console.error("Vertex Flow: AI chat failed", error);
				setLastAssistant("Something went wrong generating a response.");
			})
			.finally(() => setSending(false));
	};

	const send = () => {
		const text = input.trim();
		if (!text || sending) return;

		const history = [...messages, { id: crypto.randomUUID(), role: "user" as const, content: text }];
		setInput("");
		beginTurn(history);
	};

	/** Drops the last assistant message and asks the same preceding question again — no duplicate user message. */
	const retry = () => {
		if (sending) return;
		const lastAssistantIndex = messages.reduce(
			(found, message, index) => (message.role === "assistant" ? index : found),
			-1,
		);
		if (lastAssistantIndex === -1) return;
		beginTurn(messages.slice(0, lastAssistantIndex));
	};

	/** Drops this user message and everything after it, loading its exact text back into the input for review/resend — never auto-resubmitted. */
	const editMessage = (index: number) => {
		if (sending) return;
		const target = messages[index];
		if (!target || target.role !== "user") return;
		setMessages(messages.slice(0, index));
		setInput(target.content);
		inputRef.current?.focus();
	};

	const copyMessage = (message: AiChatBubble) => {
		void navigator.clipboard.writeText(message.content).then(() => {
			setCopiedId(message.id);
			window.setTimeout(
				() => setCopiedId((current) => (current === message.id ? null : current)),
				COPY_CONFIRM_MS,
			);
		});
	};

	const stop = () => {
		stoppedRef.current = true;
		setStopping(true);
		plugin.aiEngine.interrupt();
	};

	if (!supported || engineState === "unsupported") {
		return (
			<EmptyView
				icon="bot"
				iconFallback="bot"
				title="AI Chat isn't available here"
				note="This device/browser doesn't support WebGPU, which the in-browser model needs."
			/>
		);
	}

	if (engineState === "not-installed") {
		const sizeNote =
			selectedModelInfo.vramMB != null
				? ` (~${(selectedModelInfo.vramMB / 1024).toFixed(1)} GB)`
				: "";
		return (
			<EmptyView
				icon="bot"
				iconFallback="bot"
				title={`Install "${selectedModelLabel}" to start chatting`}
				note={`It's a one-time download${sizeNote} that runs entirely in this browser.`}
				action={{
					label: "Open Settings",
					onClick: () => openScreen("settings", "vf-settings-ai-chat"),
				}}
			/>
		);
	}

	if (engineState === "checking") {
		return (
			<EmptyView
				icon="bot"
				iconFallback="bot"
				title="Loading the model…"
				note={
					<>
						{loadingProgress?.text ?? "Warming up…"}
						{/* No bar during the brief pre-progress window (the initial
						    `getState()` cache check) — a bar stuck at 0% would read as
						    broken rather than simply "hasn't started reporting yet". */}
						{loadingProgress && (
							<div className="vf-ai-progress">
								<div className="vf-ai-progress-fill" style={{ width: `${loadingProgress.pct}%` }} />
							</div>
						)}
					</>
				}
				className="vf-ai-chat-loading"
			/>
		);
	}

	// Retry only ever shows on this one — the single most recent assistant
	// message, never an earlier one.
	const lastAssistantIndex = messages.reduce(
		(found, message, index) => (message.role === "assistant" ? index : found),
		-1,
	);

	return (
		<div className="vf-settings">
			<header className="vf-toolbar">
				<div className="vf-toolbar-title">
					<h2>AI Chat - {snapshot.workspace.name}</h2>
				</div>
			</header>

			<div className="vf-chat-body" ref={bodyRef}>
				{messages.length === 0 ? (
					<p className="vf-empty-note">
						{justSwitchedModel
							? `Switched to "${selectedModelLabel}" — starting a new conversation.`
							: `Ask about ${snapshot.workspace.name} — e.g. "what's overdue?"`}
					</p>
				) : (
					messages.map((message, index) => (
						<div key={message.id} className={`vf-chat-message vf-chat-message-${message.role}`}>
							{message.content ? (
								<div className={`vf-chat-bubble vf-chat-bubble-${message.role}`}>
									<AiChatBubbleContent
										text={message.content}
										taskPaths={message.taskPaths}
										snapshot={snapshot}
										taxonomies={taxonomies}
										onOpenTask={openTask}
									/>
								</div>
							) : (
								// No `.vf-chat-bubble` at all while there's nothing to show yet —
								// the thinking indicator gets no bubble chrome/background; only
								// once real content streams in does the bubble appear.
								sending && index === messages.length - 1 && <ThinkingIndicator />
							)}
							<div className="vf-chat-actions">
								{message.role === "assistant" && message.content && (
									<button
										type="button"
										className="vf-icon-button"
										title="Copy"
										aria-label="Copy message"
										disabled={sending}
										onClick={() => copyMessage(message)}
									>
										<Icon id={copiedId === message.id ? "check" : "copy"} size={13} />
									</button>
								)}
								{message.role === "assistant" && message.content && index === lastAssistantIndex && !sending && (
									<button
										type="button"
										className="vf-icon-button"
										title="Retry"
										aria-label="Retry this response"
										onClick={retry}
									>
										<Icon id="rotate-ccw" size={13} />
									</button>
								)}
								{message.role === "user" && (
									<button
										type="button"
										className="vf-icon-button"
										title="Copy"
										aria-label="Copy message"
										disabled={sending}
										onClick={() => copyMessage(message)}
									>
										<Icon id={copiedId === message.id ? "check" : "copy"} size={13} />
									</button>
								)}
								{message.role === "user" && (
									<button
										type="button"
										className="vf-icon-button"
										title="Edit"
										aria-label="Edit message"
										disabled={sending}
										onClick={() => editMessage(index)}
									>
										<Icon id="pencil" size={13} />
									</button>
								)}
							</div>
						</div>
					))
				)}
			</div>

			<div className="vf-chat-input-row">
				<textarea
					ref={inputRef}
					className="vf-chat-input"
					value={input}
					placeholder="Ask about this workspace…"
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							send();
						}
					}}
				/>
				{sending ? (
					<button type="button" className="mod-warning" disabled={stopping} onClick={stop}>
						{stopping ? "Stopping…" : "Stop"}
					</button>
				) : (
					<button type="button" className="mod-cta" disabled={!input.trim()} onClick={send}>
						Send
					</button>
				)}
			</div>
		</div>
	);
}
