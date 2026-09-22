/**
 * AI Chat against a local, OpenAI-compatible model server (LM Studio / Bionic,
 * Ollama, Jan, llama.cpp server, or a custom URL) — the "local-server"
 * provider. Unlike the built-in WebLLM chat's hand-rolled JSON actions, the
 * model here calls the MCP tool surface natively: each turn streams a
 * `/chat/completions` round, runs any tool calls in-process through the
 * conversation's private MCP bridge (`ensureBridge`, see
 * `ai-chat-session.tsx`), feeds the results back, and repeats until the model
 * answers — capped at `MAX_TOOL_ROUNDS` rounds per message.
 *
 * The chat keeps its own workspace (`chatWorkspaceRoot`), seeded from the
 * pane's and changed by the header picker or by the model's own
 * `set_active_workspace` call. It only ever retitles this view — the pane and
 * sidebar stay on whatever workspace they were showing.
 *
 * History is client-side: every round resends the whole conversation, each
 * earlier turn's tool exchange replayed from its bubble's `wire`
 * (`bubblesToWireMessages`). Task/project rows are stored as paths and
 * resolved against the live index at render time — computed, never stored.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LocalServerAbortError,
  listModels,
  streamChatCompletion,
} from "../../ai/local-server-client";
import {
  bubblesToWireMessages,
  buildLocalChatSystemPrompt,
  describeLocalServerError,
  extractResultRows,
  MAX_TOOL_ROUNDS,
  mcpToolsToOpenAiTools,
  parseToolArguments,
  pickModelId,
  toLocalServerErrorLike,
  truncateToolResult,
  workspaceFromSetActiveResult,
  type LocalChatWireMessage,
} from "../../core/ai/local-server";
import { localTodayIso } from "../../core/date";
import { workspaceTaxonomies } from "../../core/taxonomy";
import type { Project, Task, WorkspaceSnapshot } from "../../core/types";
import { getLocalServerKey } from "../../obsidian/local-server-key";
import { EmptyView } from "../components/EmptyView";
import { Icon } from "../components/Icon";
import { usePlugin, useSettingsWriter } from "../context";
import { useTabs } from "../tabs-context";
import { type AiChatBubble, useAiChatSession } from "./ai-chat-session";
import {
  AiChatProjectList,
  ChatMarkdown,
  ChatMessageActions,
  ChatTaskList,
  ThinkingIndicator,
} from "./chat-parts";
import { Select } from "../components/Select";

/** How long the Copy button shows its confirmation checkmark. */
const COPY_CONFIRM_MS = 1500;

/** How close to the bottom (px) still counts as "at the bottom" for auto-scroll purposes. */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** Rows shown under an answer before "Load more". */
const INITIAL_RESULT_ROWS = 10;

const TOOL_CAP_NOTE = `Stopped after ${MAX_TOOL_ROUNDS} tool rounds. Try a more specific question.`;

type ModelsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; ids: string[]; refreshing: boolean };

/**
 * The rows a turn's last row-producing tool call returned, resolved against
 * that result's own workspace (which may not be the pane's) at render time.
 * A path that no longer resolves is silently dropped; a workspace that no
 * longer exists renders nothing.
 */
function ToolResultRowsList({
  rows,
  onOpenTask,
  onOpenProject,
  onLoadMore,
}: {
  rows: NonNullable<AiChatBubble["resultRows"]>;
  onOpenTask: (path: string) => void;
  onOpenProject: (path: string) => void;
  onLoadMore: () => void;
}) {
  const plugin = usePlugin();
  const target = plugin.index.get(rows.workspaceRoot);
  const taxonomies = useMemo(
    () => (target ? workspaceTaxonomies(target.workspace) : null),
    [target],
  );
  const resolvedTasks = useMemo(() => {
    if (!target || rows.kind !== "tasks") return [];
    const byPath = new Map(target.tasks.map((task) => [task.path, task]));
    return rows.paths
      .map((path) => byPath.get(path))
      .filter((task): task is Task => task != null);
  }, [rows, target]);
  const resolvedProjects = useMemo(() => {
    if (!target || rows.kind !== "projects") return [];
    const byPath = new Map(target.projects.map((project) => [project.path, project]));
    return rows.paths
      .map((path) => byPath.get(path))
      .filter((project): project is Project => project != null);
  }, [rows, target]);

  if (!target || !taxonomies) return null;
  const total = rows.kind === "tasks" ? resolvedTasks.length : resolvedProjects.length;
  if (total === 0) return null;
  const remaining = Math.max(0, total - rows.shown);

  return (
    <>
      {rows.kind === "tasks" ? (
        <ChatTaskList
          tasks={resolvedTasks.slice(0, rows.shown)}
          snapshot={target}
          taxonomies={taxonomies}
          onOpenTask={onOpenTask}
        />
      ) : (
        <AiChatProjectList
          projects={resolvedProjects.slice(0, rows.shown)}
          taxonomies={taxonomies}
          onOpenProject={onOpenProject}
        />
      )}
      {remaining > 0 && (
        <button type="button" className="vf-chat-load-more" onClick={onLoadMore}>
          Load more ({remaining} more)
        </button>
      )}
    </>
  );
}

/** The collapsed "Used: …" note under an answer — each distinct tool once in the summary, every call in order inside. */
function ToolsUsed({ calls }: { calls: NonNullable<AiChatBubble["toolCalls"]> }) {
  const names = [...new Set(calls.map((call) => call.name || "unknown tool"))];
  const failed = new Set(calls.filter((call) => call.isError).map((call) => call.name || "unknown tool"));
  return (
    <details className="vf-chat-tools-used">
      <summary>
        Used: {names.map((name) => (failed.has(name) ? `${name} (error)` : name)).join(", ")}
      </summary>
      <ol>
        {calls.map((call, index) => (
          <li key={index} className={call.isError ? "is-error" : undefined}>
            {call.name || "unknown tool"}
            {call.isError ? " (error)" : ""}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function LocalServerChatView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const { openScreen, openTask, openProject } = useTabs();
  const writeSettings = useSettingsWriter();
  const {
    messages,
    setMessages,
    chatWorkspaceRoot,
    setChatWorkspaceRoot,
    ensureBridge,
  } = useAiChatSession();

  const aiChatEnabled = plugin.settings.aiChatEnabled;
  const baseUrl = plugin.settings.localServerBaseUrl;

  const [models, setModels] = useState<ModelsState>({ status: "loading" });
  // Bumped by Retry / the refresh button to re-run the model list fetch.
  const [modelsRequest, setModelsRequest] = useState(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottomRef = useRef(true);
  // The in-flight turn's controller — Stop aborts it, which destroys the
  // HTTP request mid-stream and keeps any pending tool calls from running.
  const abortRef = useRef<AbortController | null>(null);

  // The chat's own workspace starts as the pane's. A workspace deleted since
  // falls back to the pane's for display rather than showing nothing.
  useEffect(() => {
    if (chatWorkspaceRoot == null) setChatWorkspaceRoot(snapshot.workspace.root);
  }, [chatWorkspaceRoot, setChatWorkspaceRoot, snapshot.workspace.root]);
  const chatRoot = chatWorkspaceRoot ?? snapshot.workspace.root;
  const chatSnapshot = plugin.index.get(chatRoot) ?? snapshot;
  const chatName = chatSnapshot.workspace.name;
  const workspaces = plugin.index.list();

  useEffect(() => {
    if (!aiChatEnabled) return;
    let cancelled = false;
    // A refresh keeps the current list on screen instead of flashing back to
    // the full-screen "Connecting…" state.
    setModels((prev) =>
      prev.status === "ready" ? { ...prev, refreshing: true } : { status: "loading" },
    );
    listModels(baseUrl, getLocalServerKey()).then(
      (ids) => {
        if (!cancelled) setModels({ status: "ready", ids, refreshing: false });
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error("Vertex Flow: local model server unreachable", error);
        setModels({
          status: "error",
          message: describeLocalServerError(toLocalServerErrorLike(error), baseUrl),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [aiChatEnabled, baseUrl, modelsRequest]);

  // Leaving the tab mid-answer stops the request rather than letting it
  // stream into a view nobody can see.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  const modelId =
    models.status === "ready" ? pickModelId(plugin.settings.localServerModelId, models.ids) : null;

  // Every updater builds a fresh object — React may replay an updater, and a
  // mutated `prev` would double-append streamed text (see the built-in view).
  const updateLastAssistant = (patch: (bubble: AiChatBubble) => AiChatBubble) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== "assistant") return prev;
      return [...prev.slice(0, -1), patch(last)];
    });
  };

  const appendToLastAssistant = (chunk: string) => {
    if (!chunk) return;
    updateLastAssistant((bubble) => ({ ...bubble, content: bubble.content + chunk }));
  };

  const runTurn = async (history: AiChatBubble[], model: string, signal: AbortSignal) => {
    const bridge = await ensureBridge(chatRoot);
    const tools = mcpToolsToOpenAiTools(await bridge.listTools());
    const baseMessages = bubblesToWireMessages(
      history,
      buildLocalChatSystemPrompt({ workspaceName: chatName, today: localTodayIso() }),
    );
    // This turn's completed tool exchanges. A round's assistant message and
    // its tool results are only added once every call in it has run — a
    // half-answered `tool_calls` message would make the next request invalid.
    const wire: LocalChatWireMessage[] = [];
    const toolCalls: { name: string; isError: boolean }[] = [];
    let resultRows: AiChatBubble["resultRows"];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      updateLastAssistant((bubble) => ({ ...bubble, content: "" }));
      const result = await streamChatCompletion({
        baseUrl,
        apiKey: getLocalServerKey(),
        body: {
          model,
          messages: [...baseMessages, ...wire],
          tools,
          tool_choice: "auto",
        },
        onContentDelta: appendToLastAssistant,
        signal,
      });
      const tokens = result.usage?.total_tokens;
      if (typeof tokens === "number") {
        updateLastAssistant((bubble) => ({ ...bubble, tokens }));
      }

      if (result.toolCalls.length === 0) {
        const content = result.content.trim()
          ? result.content
          : "The model returned an empty response.";
        updateLastAssistant((bubble) => ({ ...bubble, content }));
        return;
      }

      const toolMessages: LocalChatWireMessage[] = [];
      for (const call of result.toolCalls) {
        if (signal.aborted) throw new LocalServerAbortError();
        const parsed = parseToolArguments(call.name, call.arguments);
        if ("error" in parsed) {
          toolMessages.push({ role: "tool", tool_call_id: call.id, content: parsed.error });
          toolCalls.push({ name: call.name, isError: true });
        } else {
          const outcome = await bridge.callTool(call.name, parsed.args);
          if (signal.aborted) throw new LocalServerAbortError();
          toolMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: truncateToolResult(outcome.text),
          });
          toolCalls.push({ name: call.name, isError: outcome.isError });
          if (!outcome.isError) {
            // Rows come from the full text — only the model's copy is truncated.
            const rows = extractResultRows(call.name, outcome.text);
            if (rows) resultRows = { ...rows, shown: INITIAL_RESULT_ROWS };
            if (call.name === "set_active_workspace") {
              const root = workspaceFromSetActiveResult(outcome.text);
              if (root != null) setChatWorkspaceRoot(root);
            }
          }
        }
        updateLastAssistant((bubble) => ({ ...bubble, toolCalls: [...toolCalls], resultRows }));
      }

      wire.push(
        {
          role: "assistant",
          content: result.content || null,
          tool_calls: result.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        },
        ...toolMessages,
      );
      updateLastAssistant((bubble) => ({ ...bubble, wire: [...wire] }));
    }

    updateLastAssistant((bubble) => ({
      ...bubble,
      content: bubble.content ? `${bubble.content}\n\n${TOOL_CAP_NOTE}` : TOOL_CAP_NOTE,
    }));
  };

  /** Shared by `send()` and `retry()`: `history` already ends with the user message being answered. */
  const beginTurn = (history: AiChatBubble[]) => {
    if (!modelId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStopping(false);
    nearBottomRef.current = true;
    setMessages([...history, { id: crypto.randomUUID(), role: "assistant", content: "" }]);
    setSending(true);

    void runTurn(history, modelId, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof LocalServerAbortError) {
          // Keep whatever streamed, marked the same way the built-in chat
          // marks a stopped reply.
          updateLastAssistant((bubble) => ({
            ...bubble,
            content: bubble.content ? `${bubble.content} [stopped]` : "Stopped before responding.",
          }));
          return;
        }
        console.error("Vertex Flow: local model server chat failed", error);
        updateLastAssistant((bubble) => ({
          ...bubble,
          content: describeLocalServerError(toLocalServerErrorLike(error), baseUrl),
          error: true,
        }));
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        setSending(false);
      });
  };

  const send = () => {
    const text = input.trim();
    if (!text || sending || !modelId) return;
    setInput("");
    beginTurn([...messages, { id: crypto.randomUUID(), role: "user", content: text }]);
  };

  const retry = () => {
    if (sending) return;
    const lastAssistantIndex = messages.reduce(
      (found, message, index) => (message.role === "assistant" ? index : found),
      -1,
    );
    if (lastAssistantIndex === -1) return;
    beginTurn(messages.slice(0, lastAssistantIndex));
  };

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
    setStopping(true);
    abortRef.current?.abort();
  };

  const loadMoreRows = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && message.resultRows
          ? { ...message, resultRows: { ...message.resultRows, shown: message.resultRows.shown * 2 } }
          : message,
      ),
    );
  };

  const changeWorkspace = (root: string) => {
    setChatWorkspaceRoot(root);
    // Applied to the bridge now; `runTurn` re-checks it before every turn too.
    void ensureBridge(root).catch(() => undefined);
  };

  const openSettings = () => openScreen("settings", "vf-settings-ai-chat");

  if (!aiChatEnabled) {
    return (
      <EmptyView
        icon="bot"
        iconFallback="bot"
        title="AI Chat is turned off"
        note="Enable it in Settings to start chatting."
        action={{ label: "Open Settings", onClick: openSettings }}
      />
    );
  }

  if (models.status === "loading") {
    return (
      <EmptyView
        icon="bot"
        iconFallback="bot"
        title="Connecting to the local model server…"
        note={baseUrl}
        className="vf-ai-chat-loading"
      />
    );
  }

  if (models.status === "error" || models.ids.length === 0) {
    return (
      <EmptyView
        icon="bot"
        iconFallback="bot"
        title={
          models.status === "error"
            ? "Couldn't reach the local model server"
            : "No models available"
        }
        note={
          models.status === "error"
            ? models.message
            : "The server is running but lists no models. Download or load one in your server app."
        }
        action={{ label: "Retry", onClick: () => setModelsRequest((n) => n + 1) }}
        secondaryAction={{ label: "Open Settings", onClick: openSettings }}
      />
    );
  }

  const lastAssistantIndex = messages.reduce(
    (found, message, index) => (message.role === "assistant" ? index : found),
    -1,
  );
  const lastTokens = [...messages].reverse().find((message) => message.role === "assistant")?.tokens;

  return (
    <div className="vf-settings">
      <header className="vf-toolbar">
        <div className="vf-toolbar-title">
          <h2>AI Chat - {chatName}</h2>
        </div>
        <div className="vf-chat-header-controls">
          <Select
            className="vf-select"
            aria-label="Chat workspace"
            value={chatSnapshot.workspace.root}
            disabled={sending}
            onChange={(event) => changeWorkspace(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.workspace.root} value={workspace.workspace.root}>
                {workspace.workspace.name}
              </option>
            ))}
          </Select>
          <Select
            className="vf-select"
            aria-label="Model"
            value={modelId ?? ""}
            disabled={sending}
            onChange={(event) => writeSettings({ localServerModelId: event.target.value })}
          >
            {models.ids.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="vf-icon-button"
            title="Refresh the model list"
            aria-label="Refresh the model list"
            disabled={sending || models.refreshing}
            onClick={() => setModelsRequest((n) => n + 1)}
          >
            <Icon id="refresh-cw" size={13} />
          </button>
        </div>
      </header>

      <div
        className="vf-chat-body"
        ref={bodyRef}
        onScroll={() => {
          const el = bodyRef.current;
          if (!el) return;
          nearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
        }}
      >
        {messages.length === 0 ? (
          <p className="vf-empty-note">
            {`Ask about ${chatName}, or any workspace. e.g. "what's overdue?"`}
          </p>
        ) : (
          messages.map((message, index) => {
            const isStreamingPlaceholder =
              sending && index === messages.length - 1 && !message.content;
            return (
              <div
                key={message.id}
                className={`vf-chat-message vf-chat-message-${message.role}`}
              >
                {message.content ? (
                  <div
                    className={`vf-chat-bubble vf-chat-bubble-${message.role}${
                      message.error ? " is-error" : ""
                    }`}
                  >
                    <ChatMarkdown text={message.content} />
                    {message.resultRows && (
                      <ToolResultRowsList
                        rows={message.resultRows}
                        onOpenTask={openTask}
                        onOpenProject={openProject}
                        onLoadMore={() => loadMoreRows(message.id)}
                      />
                    )}
                  </div>
                ) : (
                  isStreamingPlaceholder && <ThinkingIndicator />
                )}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <ToolsUsed calls={message.toolCalls} />
                )}
                <ChatMessageActions
                  message={message}
                  isLastAssistant={index === lastAssistantIndex}
                  sending={sending}
                  copied={copiedId === message.id}
                  onCopy={() => copyMessage(message)}
                  onRetry={retry}
                  onEdit={() => editMessage(index)}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="vf-chat-input-row">
        <textarea
          ref={inputRef}
          className="vf-chat-input"
          value={input}
          placeholder={`Ask about ${chatName}…`}
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
          <button
            type="button"
            className="mod-cta"
            disabled={!input.trim() || !modelId}
            onClick={send}
          >
            Send
          </button>
        )}
      </div>

      {typeof lastTokens === "number" && (
        <div className="vf-chat-model-row">
          <span
            className="vf-chat-token-usage"
            title="Tokens the server reported for the last response"
          >
            ~{lastTokens.toLocaleString()} tokens
          </span>
        </div>
      )}
    </div>
  );
}
