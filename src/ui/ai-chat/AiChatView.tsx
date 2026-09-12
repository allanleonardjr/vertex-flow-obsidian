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

import { useEffect, useRef, useState } from "react";
import { buildFactsSection } from "../../core/ai/snapshot";
import {
	executeQueryAction,
	looksLikeQueryAction,
	parseQueryAction,
} from "../../core/ai/query-action";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { ViewContext } from "../../core/views";
import type { WorkspaceSnapshot } from "../../core/types";
import {
	AI_MODEL_OPTIONS,
	aiModelInfo,
	AiEngineService,
	type AiChatMessage,
	type AiEngineState,
} from "../../ai/AiEngineService";
import { EmptyView } from "../components/EmptyView";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";
import { useAiChatSession } from "./ai-chat-session";

const INSTRUCTIONS = `You are an assistant embedded in the Vertex Flow task manager (an Obsidian plugin).

You're given a small facts section (counts, and this workspace's configured statuses/priorities/task types/labels/people — all fully user-configurable, so use these definitions, never generic assumptions or names from other tools).

You do NOT have the task list itself. When a question needs specific tasks — a filtered list, a count under some filter, or anything about individual task identities — respond with ONLY a JSON object on its own, nothing else, in this exact shape:
{"action": "searchTasks", "filters": {"status": ["In Progress"], "project": ["Launch"]}}
or, when only a number is needed:
{"action": "countTasks", "filters": {"assignee": ["Alice"], "openOnly": true}}
or, for anything about overdue work — never express "overdue" via the text filter, it only does a substring match and will never work for this:
{"action": "searchTasks", "filters": {"overdue": true, "project": ["Launch"]}}

Recognized filter keys: status, priority, taskType, labels, assignee, project, parent, mentions (all arrays of this workspace's display names), text (substring match — NOT for concepts like "overdue"), archived ("included" or "only"), openOnly, unscheduled, recurring, overdue (booleans). Use display names exactly as given in the facts section — never invent a field name. Omit filters you don't need; an empty/omitted filter matches everything. Only ever emit ONE such object, and nothing besides it, when you need data — no other text before or after it.

If a question is answerable from the facts section alone (totals, what statuses/priorities/task types/people exist), or needs no workspace data at all, just answer directly in plain language — never emit a JSON action for those.`;

interface RunTurnDeps {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
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
	const { openScreen } = useTabs();
	const supported = AiEngineService.supportsWebGPU();

	const [engineState, setEngineState] = useState<AiEngineState | "checking">("checking");
	const { messages, setMessages, justSwitchedModel } = useAiChatSession();
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const bodyRef = useRef<HTMLDivElement | null>(null);
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
	useEffect(() => {
		let cancelled = false;
		setEngineState("checking");
		void plugin.aiEngine.getState(selectedModelId).then(async (state) => {
			if (cancelled) return;
			if (state !== "installed") {
				setEngineState(state);
				return;
			}
			// Cached model: this just loads/activates it in the worker, no download.
			const loaded = await plugin.aiEngine.install(selectedModelId);
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

	/** Always streams live into the visible bubble — only ever called for a response the user should watch appear. */
	const streamVisible = async (request: AiChatMessage[]) => {
		setLastAssistant("");
		try {
			await plugin.aiEngine.chat(request, appendToLastAssistant);
		} catch (error) {
			if (!stoppedRef.current) throw error;
			// Interrupted mid-stream — WebLLM may throw or may just end the
			// iteration early; either way, leave whatever streamed in place
			// rather than losing it, and fall through to mark it stopped below.
		}
		if (stoppedRef.current) appendToLastAssistant(" [stopped]");
	};

	const runTurn = async (history: AiChatMessage[], deps: RunTurnDeps) => {
		const facts = buildFactsSection(deps.snapshot, deps.taxonomies);
		const baseRequest: AiChatMessage[] = [
			{ role: "system", content: `${INSTRUCTIONS}\n\n## Facts\n${facts}` },
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
			// a second call on a response the user asked to stop.
			setLastAssistant(firstResponse.trim() ? `${firstResponse} [stopped]` : "Stopped before responding.");
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
					content: `Query result:\n${queryResult}\n\nAnswer the original question using this — don't mention the query mechanism itself.`,
				},
			];
			await streamVisible(secondRequest);
			return;
		}

		if (looksLikeQueryAction(firstResponse)) {
			// Attempted an action but it didn't validate (unrecognized filter
			// keys, wrong value types, …) — spend the one retry budget on a
			// corrective nudge rather than surfacing raw JSON to the user.
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
			await streamVisible(retryRequest);
			return;
		}

		// Ordinary text: the already-buffered first-call response IS the final
		// answer — show it in one shot rather than re-generating with a second
		// call, which is what keeps a plain question to a single model call.
		setLastAssistant(firstResponse);
	};

	const send = () => {
		const text = input.trim();
		if (!text || sending) return;

		stoppedRef.current = false;
		const history = [...messages, { role: "user" as const, content: text }];
		setMessages([...history, { role: "assistant", content: "" }]);
		setInput("");
		setSending(true);

		void runTurn(history, { snapshot, taxonomies, context })
			.catch((error: unknown) => {
				if (stoppedRef.current) return;
				console.error("Vertex Flow: AI chat failed", error);
				setLastAssistant("Something went wrong generating a response.");
			})
			.finally(() => setSending(false));
	};

	const stop = () => {
		stoppedRef.current = true;
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
			<EmptyView icon="bot" iconFallback="bot" title="Loading the model…" />
		);
	}

	return (
		<div className="vf-settings">
			<header className="vf-toolbar">
				<div className="vf-toolbar-title">
					<h2>AI Chat</h2>
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
						<div key={index} className={`vf-chat-bubble vf-chat-bubble-${message.role}`}>
							{message.content || (sending && index === messages.length - 1 ? "…" : "")}
						</div>
					))
				)}
			</div>

			<div className="vf-chat-input-row">
				<textarea
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
					<button type="button" className="mod-warning" onClick={stop}>
						Stop
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
