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
 *
 * Switching the selected model mid-conversation does *not* reset history —
 * every call above resends the full transcript regardless of which model is
 * loaded, so a freshly-switched model sees exactly what the previous one
 * would have on its own next turn. The one real risk is a smaller-context
 * model no longer fitting the accumulated history; `beginTurn`'s catch block
 * detects that specific failure (`ContextWindowSizeExceededError`) and shows
 * a clear explanation instead of a silent console error.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "obsidian";
import { buildFactsSection, estimateTokens, isOverdueTask } from "../../core/ai/snapshot";
import { matchHelpTopic } from "../../core/ai/help-retrieval";
import {
  resolveTaskIdFragments,
  type TaskIdFragmentMatch,
} from "../../core/ai/resolve-task-ids";
import {
  executeProjectQueryAction,
  executeQueryAction,
  looksLikeAttemptedAction,
  parseProjectQueryAction,
  parseQueryAction,
} from "../../core/ai/query-action";
import { HELP_TOPICS } from "../../core/help";
import { applyFilters, applyProjectFilters } from "../../core/views/filter";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { ViewContext } from "../../core/views";
import type { Project, Task, WorkspaceSnapshot } from "../../core/types";
import {
  AI_MODEL_OPTIONS,
  aiModelInfo,
  AiEngineService,
  AiInstallCancelledError,
  type AiChatMessage,
  type AiEngineState,
} from "../../ai/AiEngineService";
import { useAiEngineStatus } from "./useAiEngineStatus";
import { effectiveAiProvider } from "../../core/ai/local-server";
import { LocalServerChatView } from "./LocalServerChatView";
import { EmptyView } from "../components/EmptyView";
import {
  AiChatProjectList,
  ChatMarkdown,
  ChatMessageActions,
  ChatTaskList,
  ThinkingIndicator,
} from "./chat-parts";
import { usePlugin, useSettingsWriter } from "../context";
import { useTabs } from "../tabs-context";
import {
  type AiChatBubble,
  type AiChatProjectQueryMeta,
  type AiChatQueryMeta,
  useAiChatSession,
} from "./ai-chat-session";
import { Select } from "../components/Select";
import { Icon } from "../components/Icon";

/** How long the Copy button shows its confirmation checkmark. */
const COPY_CONFIRM_MS = 1500;

/** How long the "Switched to X" confirmation stays up before fading on its own. An error notice is left up until the next switch replaces it — never auto-dismissed. */
const SWITCH_NOTICE_MS = 3000;

/** How close to the bottom (px) still counts as "at the bottom" for auto-scroll purposes. */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

/**
 * Shown instead of raw JSON when a second-call response still looks like a
 * structured-output attempt (a query action, malformed JSON, or even
 * unparseable garbled/concatenated JSON — see the `looksLikeAttemptedAction`
 * check after `streamVisible` in `runTurn`). The second call has no
 * structural guarantee of producing final prose (unlike the
 * buffered-and-checked first call), so this is the deterministic backstop
 * rather than a further model call.
 */
const QUERY_ACTION_FALLBACK =
  "I wasn't able to answer that — try asking in a different way.";

/** Shown when a turn fails specifically because the accumulated history no longer fits the selected model's context window — see `isContextWindowOverflow`. */
const CONTEXT_OVERFLOW_MESSAGE =
  "This conversation is too long for the currently selected model's context window. Try starting a new conversation, or switch to a model with a larger context window.";

/**
 * WebLLM runs in a Web Worker (`AiEngineService`'s `load()` always uses
 * `CreateWebWorkerMLCEngine`) — its message-passing layer serializes a thrown
 * error with a plain `err.toString()` and rejects the caller's promise with
 * that *string*, not an `Error` object, so `.name`/`instanceof` checks never
 * see the real `ContextWindowSizeExceededError` class on this side of the
 * worker boundary. Matching on the stringified name is what actually works
 * here, and still degrades safely (returns `false`) for a real `Error` or any
 * other shape a future WebLLM version might throw instead.
 */
function isContextWindowOverflow(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.includes("ContextWindowSizeExceededError");
}

const INSTRUCTIONS = `You are an assistant embedded in the Vertex Flow task manager (an Obsidian plugin).

You're given a small facts section (counts, and this workspace's configured statuses/priorities/task types/labels/people — all fully user-configurable, so use these definitions, never generic assumptions or names from other tools).

You do NOT have the task list itself. When a question needs specific tasks — a filtered list, a count under some filter, or anything about individual task identities — respond with ONLY a JSON object on its own, nothing else, in this exact shape:
{"action": "searchTasks", "filters": {"status": ["In Progress"], "project": ["Launch"]}}
or, when only a number is needed:
{"action": "countTasks", "filters": {"assignee": ["Alice"], "openOnly": true}}
or, for anything about overdue work — never express "overdue" via the text filter, it only does a substring match and will never work for this:
{"action": "searchTasks", "filters": {"overdue": true, "project": ["Launch"]}}

Recognized task filter keys: status, priority, taskType, labels, assignee, project, parent, mentions (all arrays of this workspace's display names), text (substring match — NOT for concepts like "overdue"), archived ("included" or "only"), openOnly, unscheduled, recurring, overdue (booleans). Use display names exactly as given in the facts section — never invent a field name. Omit filters you don't need; an empty/omitted filter matches everything.

You also do NOT have the project list itself. A question about tasks *within* a named project (e.g. "what's overdue in Launch") still uses searchTasks/countTasks above with a project filter — never the actions below for that. But when a question is about projects themselves — which projects exist, their status/priority/labels/owner, or a count of projects under some filter — respond with ONLY a JSON object on its own, in this exact shape:
{"action": "searchProjects", "filters": {"status": ["Active"], "priority": ["High"]}}
or, when only a number is needed:
{"action": "countProjects", "filters": {"archived": "only"}}

Recognized project filter keys: status, priority, labels, owner (arrays of this workspace's display names), text (substring match on the project title), archived ("included" or "only"). Same display-name rule as task filters — use names exactly as given in the facts section, never invent one.

Only ever emit ONE such object (from either set), and nothing besides it, when you need data — no other text before or after it.

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
function formatTaskIdResolutionNote(
  fragmentMatches: TaskIdFragmentMatch[],
): string {
  if (fragmentMatches.length === 0) return "";
  const lines = fragmentMatches.map(({ fragment, matches }) => {
    if (matches.length === 1) {
      const match = matches[0];
      return `"${fragment}" in the user's message refers to ${match.id} ("${match.title}").`;
    }
    const candidates = matches
      .map((match) => `${match.id} ("${match.title}")`)
      .join(", ");
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
  queryMeta,
  projectPaths,
  projectQueryMeta,
  snapshot,
  taxonomies,
  onOpenTask,
  onOpenProject,
  onLoadMore,
  onLoadMoreProjects,
}: {
  text: string;
  taskPaths?: string[];
  queryMeta?: AiChatQueryMeta;
  projectPaths?: string[];
  projectQueryMeta?: AiChatProjectQueryMeta;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onOpenTask: (path: string) => void;
  onOpenProject: (path: string) => void;
  onLoadMore: () => void;
  onLoadMoreProjects: () => void;
}) {
  const resolvedTasks = useMemo(() => {
    if (!taskPaths || taskPaths.length === 0) return [];
    const byPath = new Map(snapshot.tasks.map((task) => [task.path, task]));
    return taskPaths
      .map((path) => byPath.get(path))
      .filter((task): task is Task => task != null);
  }, [taskPaths, snapshot]);
  const resolvedProjects = useMemo(() => {
    if (!projectPaths || projectPaths.length === 0) return [];
    const byPath = new Map(snapshot.projects.map((project) => [project.path, project]));
    return projectPaths
      .map((path) => byPath.get(path))
      .filter((project): project is Project => project != null);
  }, [projectPaths, snapshot]);

  // "Load more" only appears while there are genuinely more matches than are
  // currently shown — once every match is on screen it disappears on its
  // own, no separate "all loaded" state to track.
  const hasMore = queryMeta != null && (taskPaths?.length ?? 0) < queryMeta.totalMatches;
  const hasMoreProjects =
    projectQueryMeta != null && (projectPaths?.length ?? 0) < projectQueryMeta.totalMatches;

  return (
    <>
      <ChatMarkdown text={text} />
      {resolvedTasks.length > 0 && (
        <ChatTaskList
          tasks={resolvedTasks}
          snapshot={snapshot}
          taxonomies={taxonomies}
          onOpenTask={onOpenTask}
        />
      )}
      {hasMore && (
        <button type="button" className="vf-chat-load-more" onClick={onLoadMore}>
          Load more ({queryMeta.totalMatches - (taskPaths?.length ?? 0)} more)
        </button>
      )}
      {resolvedProjects.length > 0 && (
        <AiChatProjectList
          projects={resolvedProjects}
          taxonomies={taxonomies}
          onOpenProject={onOpenProject}
        />
      )}
      {hasMoreProjects && (
        <button type="button" className="vf-chat-load-more" onClick={onLoadMoreProjects}>
          Load more ({projectQueryMeta.totalMatches - (projectPaths?.length ?? 0)} more)
        </button>
      )}
    </>
  );
}

/**
 * The built-in (in-browser WebLLM) chat — everything this module's header
 * describes. Only ever mounted when the effective provider is `"builtin"`
 * (see `AiChatView` below), so none of its model install/load effects run in
 * local model server mode.
 */
function BuiltinAiChatView({
  snapshot,
  taxonomies,
  context,
}: {
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  context: ViewContext;
}) {
  const plugin = usePlugin();
  const { openScreen, openTask, openProject } = useTabs();
  const writeSettings = useSettingsWriter();
  const supported = AiEngineService.supportsWebGPU();
  const aiChatEnabled = plugin.settings.aiChatEnabled;

  // "error": the selected model's last load failed this session — shown as
  // its own state rather than silently retried on every mount.
  const [engineState, setEngineState] = useState<
    AiEngineState | "checking" | "error"
  >("checking");
  // Real shard-loading progress for the loading/switching states below —
  // the service's shared status, so it matches Settings' row exactly and
  // survives either screen remounting. `null` before a load starts (the
  // brief `getState()` cache-check window) — the render falls back to a
  // generic message for that gap.
  const { inFlight, getLoadError } = useAiEngineStatus();
  // Bumped after a failed or cancelled in-chat switch: that tears down the
  // worker, taking the previously active model with it, so the load effect
  // below re-runs to bring the still-selected model back.
  const [reloadToken, setReloadToken] = useState(0);
  // The model label an in-chat `switchModel()` call is actively switching to
  // — set for the duration of the switch, so the inline "Switching to…"
  // status (shown instead of the full-screen loading takeover once a
  // conversation already exists) knows which model to name. `null` outside
  // of an active switch.
  const [switchTargetLabel, setSwitchTargetLabel] = useState<string | null>(
    null,
  );
  // A brief post-switch confirmation ("Switched to X") or failure note,
  // shown near the input once a switch settles. Success fades on its own;
  // an error is left visible until the next switch attempt replaces it, so
  // it isn't missed.
  const [switchNotice, setSwitchNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  // Whether the user has explicitly switched models at all in this tab
  // session — distinct from `messages.length`, which only tells you whether
  // anything's been said, not whether a switch has happened. Once true, every
  // subsequent engine-state hiccup (including one caught on a still-empty
  // chat, e.g. switching models before sending a first message) uses the
  // inline "Switching to…" treatment instead of the full-screen one; only
  // this tab's very first automatic mount-time check — before the user has
  // touched the selector — still gets the full-screen experience. A ref, not
  // state: it only gates which render branch fires, so a render caused by
  // something else doesn't need to see it change.
  const hasSwitchedRef = useRef(false);
  const { messages, setMessages } = useAiChatSession();
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
  // Whether `.vf-chat-body` was scrolled near its bottom the last time the
  // user touched it — read (not reacted to) by the auto-scroll effect below,
  // so scrolling up to read earlier content mid-stream isn't fought on every
  // token. A ref, not state: updated on every scroll event, far too often to
  // justify a re-render, and nothing needs to render differently from its
  // value — only the next auto-scroll decision reads it.
  const nearBottomRef = useRef(true);
  // Checked (not React state) after every `chat()` call settles — Stop needs
  // to flip this synchronously with the click, well before any state update
  // from that call's own `.then`/`.finally` would land.
  const stoppedRef = useRef(false);

  const selectedModelId = plugin.settings.selectedAiModelId;
  const selectedModelLabel =
    AI_MODEL_OPTIONS.find((option) => option.id === selectedModelId)?.label ??
    selectedModelId;
  const selectedModelInfo = aiModelInfo(selectedModelId);
  const selectedLoadError = getLoadError(selectedModelId);

  /**
   * A live, always-visible estimate of how much of the selected model's
   * context window this conversation is using — so a long conversation gives
   * some warning before it actually hits `ContextWindowSizeExceededError`
   * (see `isContextWindowOverflow` above), rather than failing with none.
   *
   * Built from the same inputs `runTurn` actually sends — the system
   * message's static `INSTRUCTIONS` + `buildFactsSection` (always present)
   * plus every message in history — so it can't silently drift from what's
   * really transmitted. It does omit the *conditional* per-turn additions
   * (a matched Help topic, a resolved task-ID note): those depend on
   * whichever message is being sent right now, not knowable ahead of time
   * for a meter shown continuously, and are typically small next to the
   * facts/history total. `estimateTokens` is chars/4, a heuristic — this is
   * explicitly an approximation, never claimed as an exact count.
   */
  const contextUsage = useMemo(() => {
    const contextWindow = selectedModelInfo.contextWindow;
    if (!contextWindow) return null;

    const facts = buildFactsSection(snapshot, taxonomies);
    const systemTokens = estimateTokens(INSTRUCTIONS) + estimateTokens(facts);
    const historyTokens = messages.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0,
    );
    const usedTokens = systemTokens + historyTokens;

    return {
      usedTokens,
      contextWindow,
      pct: Math.min(100, Math.round((usedTokens / contextWindow) * 100)),
    };
  }, [messages, selectedModelInfo.contextWindow, snapshot, taxonomies]);

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
    // AI Chat turned off (§3c): never start an install/load — the view
    // renders the disabled empty state below instead, and re-enabling picks
    // this effect back up cleanly on the next render.
    if (!aiChatEnabled) return;
    if (plugin.aiEngine.activeModelId === selectedModelId) {
      setEngineState("installed");
      return;
    }
    // Failed already this session: show why, and leave retrying to the
    // user (Retry clears the error, which re-runs this effect) instead of
    // re-attempting the same failing load on every mount.
    if (selectedLoadError) {
      setEngineState("error");
      return;
    }
    let cancelled = false;
    setEngineState("checking");
    // A download of this model already running (e.g. started from Settings)
    // is joined directly — its partial cache would read as "not-installed".
    const alreadyLoading =
      plugin.aiEngine.getInFlight()?.modelId === selectedModelId;
    const cacheState: Promise<AiEngineState> = alreadyLoading
      ? Promise.resolve("installed")
      : plugin.aiEngine.getState(selectedModelId);
    void cacheState
      .then(async (state) => {
        if (cancelled) return;
        if (state !== "installed") {
          setEngineState(state);
          return;
        }
        // Cached model: this just loads/activates it in the worker, no
        // download — but genuinely reports progress while loading shards
        // from cache into GPU memory, not only during a fresh download.
        const loaded = await plugin.aiEngine.install(selectedModelId);
        if (!cancelled) setEngineState(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof AiInstallCancelledError) {
          setEngineState("not-installed");
          return;
        }
        console.error("Vertex Flow: AI model load failed", error);
        setEngineState(
          plugin.aiEngine.getLoadError(selectedModelId) ? "error" : "not-installed",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [plugin, selectedModelId, aiChatEnabled, selectedLoadError, reloadToken]);

  const handleBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
  };

  // Only follows new content when the user was already at (or near) the
  // bottom — scrolling up to read earlier messages, including mid-stream,
  // stays put instead of being yanked back down on every token. Scrolling
  // back to the bottom manually (via `handleBodyScroll` above) resumes
  // auto-follow for whatever comes next, in this response or a later one.
  useEffect(() => {
    if (!nearBottomRef.current) return;
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (switchNotice?.kind !== "success") return;
    const timer = window.setTimeout(
      () => setSwitchNotice(null),
      SWITCH_NOTICE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [switchNotice]);

  // All three updaters below are written to be *pure* (never mutating `prev`):
  // React 18 can invoke a setState updater more than once per update — the
  // eager evaluation in `dispatchSetState`, StrictMode's double render, and
  // concurrent replay of an interrupted render all re-run the updater body
  // against the same base state. Mutating the shared `prev` message there
  // (the old `last.content += chunk`) accumulated a token every time it was
  // replayed, doubling streamed words ("ThereThere"). Building a fresh object
  // makes every invocation idempotent, so replays are harmless.
  const appendToLastAssistant = (chunk: string) => {
    if (!chunk) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
    });
  };

  const setLastAssistant = (content: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, content }];
    });
  };

  /**
   * Attaches a resolved `searchTasks` action's result paths (and the query
   * metadata needed to re-run it for "Load more") to the last (just-answered)
   * assistant message, for `AiChatBubbleContent` to render as a real task
   * list.
   */
  const setLastAssistantQueryResult = (taskPaths: string[], queryMeta: AiChatQueryMeta) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, taskPaths, queryMeta }];
    });
  };

  /** The Project-scoped analogue of `setLastAssistantQueryResult`, for a resolved `searchProjects` action. */
  const setLastAssistantProjectQueryResult = (
    projectPaths: string[],
    projectQueryMeta: AiChatProjectQueryMeta,
  ) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== "assistant") return prev;
      return [...prev.slice(0, -1), { ...last, projectPaths, projectQueryMeta }];
    });
  };

  /**
   * Always streams live into the visible bubble — only ever called for a
   * response the user should watch appear. Returns the full streamed text so
   * callers can run a post-hoc check on it (see the `looksLikeAttemptedAction`
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
    // TODO: remove
    console.debug("Vertex Flow: AI response", full);
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
    const latestUserMessage = [...history]
      .reverse()
      .find((message) => message.role === "user");
    const helpTopic = latestUserMessage
      ? matchHelpTopic(latestUserMessage.content, HELP_TOPICS)
      : null;
    const helpSection = helpTopic
      ? `\n\n## How Vertex Flow works: ${helpTopic.title}\n${helpTopic.content ?? ""}`
      : "";

    // A small local model isn't reliable at matching a bare number ("task
    // 40") against padded/unpadded IDs buried in the facts table — resolved
    // deterministically here instead, same principle as query-action's
    // filter-value resolution. Same single-system-message constraint as the
    // help section above.
    const idSection = formatTaskIdResolutionNote(
      latestUserMessage
        ? resolveTaskIdFragments(latestUserMessage.content, deps.snapshot.tasks)
        : [],
    );

    const baseRequest: AiChatMessage[] = [
      {
        role: "system",
        content: `${INSTRUCTIONS}\n\n## Facts\n${facts}${helpSection}${idSection}`,
      },
      ...history,
    ];

    // The first call is never shown directly — there's no way to know
    // whether it's a JSON query action or the final answer until it's
    // fully generated, so it's buffered silently rather than streamed.
    let firstResponse: string;
    try {
      // TODO: remove
      console.debug("Vertex Flow: AI request (first call)", baseRequest);
      firstResponse = await plugin.aiEngine.chat(baseRequest, () => {});
      // TODO: remove
      console.debug("Vertex Flow: AI response (first call)", firstResponse);
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
    // Only attempted when the response isn't a valid task action — a model
    // never emits both, and this keeps the single-round-trip cap intact
    // (one action, one resolution, one final call).
    const projectAction = action ? null : parseProjectQueryAction(firstResponse);

    if (action) {
      // The same remaining-budget figure the context-usage meter computes
      // (system message + history already known at this point) — an
      // unfiltered query can flat-cap at up to 100 rows, and that many rows'
      // worth of formatted text alone can blow a smaller model's context
      // window well before the conversation itself gets anywhere near long.
      // `executeQueryAction` halves the row count until it fits.
      const availableTokens = contextUsage
        ? Math.max(0, contextUsage.contextWindow - contextUsage.usedTokens)
        : Number.POSITIVE_INFINITY;
      const queryResult = executeQueryAction(
        action,
        deps.snapshot,
        deps.context,
        undefined,
        availableTokens,
      );
      // Only for a `searchTasks` result that actually has rows: the matching
      // tasks render automatically as a real, clickable list right below this
      // reply (see `AiChatBubbleContent`), so enumerating them again in prose
      // is pure redundant token cost — a brief summary is all the words need
      // to add. Scoped to this one wrapper message rather than the shared
      // `INSTRUCTIONS`, since it's only ever relevant here; `countTasks` (no
      // `tasks` on the result) is unaffected, still just a number.
      const richListNote =
        queryResult.tasks && queryResult.tasks.length > 0
          ? " The matching tasks will be shown automatically as a clickable list right after your reply — give a brief one- or two-sentence summary (e.g. a count, a notable highlight) instead of listing them all again in prose."
          : "";
      const secondRequest: AiChatMessage[] = [
        ...baseRequest,
        { role: "assistant", content: firstResponse },
        {
          role: "user",
          content: `Query result:\n${queryResult.text}\n\nAnswer the original question using this — don't mention the query mechanism itself.${richListNote}`,
        },
      ];
      const secondResponse = await streamVisible(secondRequest);
      // The second call has no structural check on it the way the first
      // call's buffered response does (`parseQueryAction` runs before
      // anything is shown) — this is the deterministic backstop for the
      // rare case it still emits something structured-output-shaped instead
      // of prose (a valid-shaped action, off-schema JSON like
      // `{"labels": [...]}` naming neither action, or even a garbled/
      // unparseable attempt like two concatenated action objects —
      // `looksLikeAttemptedAction` catches all three, since it never
      // requires `JSON.parse` to succeed). The JSON will have flashed on
      // screen briefly as it streamed in; that's an accepted tradeoff
      // against buffering every second call and losing live streaming for
      // the common, correct case.
      if (!stoppedRef.current && looksLikeAttemptedAction(secondResponse)) {
        setLastAssistant(QUERY_ACTION_FALLBACK);
      } else if (queryResult.tasks && queryResult.tasks.length > 0 && queryResult.query) {
        // `searchTasks` only — `countTasks` never sets `tasks` (nothing to
        // list). Paths only, not the `Task` objects themselves: resolved
        // against the live snapshot at render time (see
        // `AiChatBubbleContent`), so a later status change or deletion is
        // reflected instead of frozen at query time. `query`/`totalMatches`
        // are stored alongside so "Load more" can re-run the same match set
        // later without a model call.
        setLastAssistantQueryResult(
          queryResult.tasks.map((task) => task.path),
          {
            filters: queryResult.query.filters,
            overdue: queryResult.query.overdue,
            totalMatches: queryResult.totalMatches ?? queryResult.tasks.length,
          },
        );
      }
      return;
    }

    if (projectAction) {
      const availableTokens = contextUsage
        ? Math.max(0, contextUsage.contextWindow - contextUsage.usedTokens)
        : Number.POSITIVE_INFINITY;
      const queryResult = executeProjectQueryAction(
        projectAction,
        deps.snapshot,
        deps.context,
        availableTokens,
      );
      // Same reasoning as the task version above: a resolved `searchProjects`
      // result with rows renders automatically as a clickable list, so the
      // model shouldn't re-enumerate it in prose.
      const richListNote =
        queryResult.projects && queryResult.projects.length > 0
          ? " The matching projects will be shown automatically as a clickable list right after your reply — give a brief one- or two-sentence summary (e.g. a count, a notable highlight) instead of listing them all again in prose."
          : "";
      const secondRequest: AiChatMessage[] = [
        ...baseRequest,
        { role: "assistant", content: firstResponse },
        {
          role: "user",
          content: `Query result:\n${queryResult.text}\n\nAnswer the original question using this — don't mention the query mechanism itself.${richListNote}`,
        },
      ];
      const secondResponse = await streamVisible(secondRequest);
      if (!stoppedRef.current && looksLikeAttemptedAction(secondResponse)) {
        setLastAssistant(QUERY_ACTION_FALLBACK);
      } else if (queryResult.projects && queryResult.projects.length > 0 && queryResult.query) {
        // `searchProjects` only — `countProjects` never sets `projects`.
        setLastAssistantProjectQueryResult(
          queryResult.projects.map((project) => project.path),
          {
            filters: queryResult.query.filters,
            totalMatches: queryResult.totalMatches ?? queryResult.projects.length,
          },
        );
      }
      return;
    }

    if (looksLikeAttemptedAction(firstResponse)) {
      // Attempted an action but it didn't validate (unrecognized filter
      // keys, wrong value types, an off-schema shape naming no `action` at
      // all like `{"labels": ["Community/Discord"]}`, or garbled/
      // concatenated JSON that doesn't even parse as one object, e.g.
      // `{"action":"countTasks",...}>{"action":"searchTasks",...}` —
      // spend the one retry budget on a corrective nudge rather than
      // surfacing raw JSON to the user. The broadest of the three checks
      // deliberately: anything that even looks like a structured-output
      // attempt belongs here, not in the plain-text branch below, whether
      // or not it happens to be valid JSON at all.
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
      // stops the model from emitting another (still invalid, off-schema,
      // or garbled/unparseable) structured-output attempt.
      if (!stoppedRef.current && looksLikeAttemptedAction(retryResponse)) {
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
    // A fresh send/retry always follows along, even if the user had scrolled
    // up to reread something earlier — same expectation as any other chat
    // UI. Streaming updates within *this* response then respect manual
    // scroll-up again from here, same as ever.
    nearBottomRef.current = true;
    setMessages([
      ...history,
      { id: crypto.randomUUID(), role: "assistant", content: "" },
    ]);
    setSending(true);

    void runTurn(history, { snapshot, taxonomies, context })
      .catch((error: unknown) => {
        if (stoppedRef.current) return;
        if (isContextWindowOverflow(error)) {
          console.error("Vertex Flow: AI chat context window exceeded", error);
          setLastAssistant(CONTEXT_OVERFLOW_MESSAGE);
          return;
        }
        console.error("Vertex Flow: AI chat failed", error);
        setLastAssistant("Something went wrong generating a response.");
      })
      .finally(() => setSending(false));
  };

  const send = () => {
    const text = input.trim();
    if (!text || sending || switchTargetLabel != null) return;

    const history = [
      ...messages,
      { id: crypto.randomUUID(), role: "user" as const, content: text },
    ];
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
        () =>
          setCopiedId((current) => (current === message.id ? null : current)),
        COPY_CONFIRM_MS,
      );
    });
  };

  /**
   * Expands a `searchTasks` bubble's shown `taskPaths` — pure client-side
   * re-run of `applyFilters` (+ the `overdue` post-filter) against the same
   * `queryMeta.filters` stored when the answer was first produced, no model
   * call involved. The model's own prose is untouched; only the list grows.
   * Doubles the shown count each click, capped at the real total.
   */
  const loadMoreTasks = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !message.queryMeta || !message.taskPaths) {
          return message;
        }
        const { filters, overdue, totalMatches } = message.queryMeta;
        const nextCount = Math.min(totalMatches, message.taskPaths.length * 2);
        let matched = applyFilters(snapshot.tasks, filters, context);
        if (overdue) {
          matched = matched.filter((task) =>
            isOverdueTask(task, taxonomies.status, new Date().toISOString().slice(0, 10)),
          );
        }
        return { ...message, taskPaths: matched.slice(0, nextCount).map((task) => task.path) };
      }),
    );
  };

  /** The Project-scoped analogue of `loadMoreTasks` — same client-side re-run, no `overdue` post-filter (Projects have no such concept). */
  const loadMoreProjects = (messageId: string) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !message.projectQueryMeta || !message.projectPaths) {
          return message;
        }
        const { filters, totalMatches } = message.projectQueryMeta;
        const nextCount = Math.min(totalMatches, message.projectPaths.length * 2);
        const matched = applyProjectFilters(snapshot.projects, filters, context);
        return {
          ...message,
          projectPaths: matched.slice(0, nextCount).map((project) => project.path),
        };
      }),
    );
  };

  const stop = () => {
    stoppedRef.current = true;
    setStopping(true);
    plugin.aiEngine.interrupt();
  };

  // Explicit switch from the model dropdown below the input — the one
  // user-initiated path that *does* kick off an install inline, unlike the
  // mount-time effect above (which never downloads): picking a not-yet-cached
  // model downloads it right here, reporting live progress through the same
  // shared `inFlight` status the loading screen already reads.
  //
  // The setting is written only AFTER the install succeeds. That ordering is
  // deliberate: `writeSettings` bumps `plugin.index.touch()` and re-renders,
  // which re-runs the load effect on the new `selectedModelId` — if we wrote
  // the setting first, that effect's `getState()` would resolve "not-installed"
  // mid-download and clobber our "checking" progress screen with the install
  // prompt. Installing first keeps `selectedModelId` stable for the whole
  // download, so only the fast path (already active) fires once it lands. A
  // failed or cancelled download leaves the prior model selected (and, since
  // either tears down the worker, reloads it via `reloadToken`).
  const switchModel = (modelId: string) => {
    hasSwitchedRef.current = true;
    if (modelId === selectedModelId) return;
    const label =
      AI_MODEL_OPTIONS.find((option) => option.id === modelId)?.label ??
      modelId;
    setSwitchNotice(null);

    if (plugin.aiEngine.activeModelId === modelId) {
      writeSettings({ selectedAiModelId: modelId });
      setSwitchNotice({ kind: "success", message: `Switched to "${label}".` });
      return;
    }

    setSwitchTargetLabel(label);
    setEngineState("checking");
    void plugin.aiEngine
      .install(modelId)
      .then((state) => {
        setEngineState(state);
        setSwitchTargetLabel(null);
        if (state === "installed") {
          writeSettings({ selectedAiModelId: modelId });
          setSwitchNotice({
            kind: "success",
            message: `Switched to "${label}".`,
          });
        } else {
          setSwitchNotice({
            kind: "error",
            message: `Couldn't activate "${label}".`,
          });
        }
      })
      .catch((error: unknown) => {
        setSwitchTargetLabel(null);
        setReloadToken((token) => token + 1);
        if (error instanceof AiInstallCancelledError) return;
        console.error("Vertex Flow: AI model switch failed", error);
        const reason =
          plugin.aiEngine.getLoadError(modelId) ??
          (error instanceof Error ? error.message : String(error));
        setSwitchNotice({
          kind: "error",
          message: `Couldn't switch to "${label}". ${reason}`,
        });
      });
  };

  if (!aiChatEnabled) {
    return (
      <EmptyView
        icon="bot"
        iconFallback="bot"
        title="AI Chat is turned off"
        note="Enable it in Settings to start chatting."
        action={{
          label: "Open Settings",
          onClick: () => openScreen("settings", "vf-settings-ai-chat"),
        }}
      />
    );
  }

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

  // Both of these guard on `!hasSwitchedRef.current`, not `messages.length`
  // — once the user has explicitly switched models at all in this tab
  // session (even from a still-empty chat), every subsequent engine-state
  // hiccup keeps the chat view on screen (see the inline "Switching
  // to…"/error/`.vf-chat-switch-status` handling further down) rather than
  // taking over the whole view, whether the switch is still in progress
  // ("checking") or just failed ("not-installed", from `switchModel`'s catch
  // block). Only this tab's very first automatic mount-time check — before
  // any switch — still gets the full-screen treatment.
  // A load failure is recorded per session and never auto-retried (see the
  // load effect) — shown whatever the switch history, since the selected
  // model can't answer anything until it loads.
  if (engineState === "error" && selectedLoadError) {
    return (
      <EmptyView
        icon="bot"
        iconFallback="bot"
        title={`Couldn't load "${selectedModelLabel}"`}
        note={selectedLoadError}
        action={{
          label: "Retry",
          onClick: () => {
            // Straight to loading — clearing the error re-runs the load
            // effect, which would otherwise see a stale "error" for a frame.
            setEngineState("checking");
            plugin.aiEngine.clearLoadError(selectedModelId);
          },
        }}
        secondaryAction={{
          label: "Open Settings",
          onClick: () => openScreen("settings", "vf-settings-ai-chat"),
        }}
      />
    );
  }

  if (engineState === "not-installed" && !hasSwitchedRef.current) {
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

  if (engineState === "checking" && !hasSwitchedRef.current) {
    return (
      <EmptyView
        icon="bot"
        iconFallback="bot"
        title="Loading the model…"
        note={
          <>
            {inFlight?.text ?? "Warming up…"}
            {/* No bar during the brief pre-progress window (the initial
						    `getState()` cache check) — a bar stuck at 0% would read as
						    broken rather than simply "hasn't started reporting yet". */}
            {inFlight && (
              <div className="vf-ai-progress">
                <div
                  className="vf-ai-progress-fill"
                  style={{ width: `${inFlight.pct}%` }}
                />
              </div>
            )}
          </>
        }
        secondaryAction={
          inFlight
            ? { label: "Cancel", onClick: () => plugin.aiEngine.cancelInstall() }
            : undefined
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

  // A mid-conversation model switch in progress — the sole signal driving the
  // inline "Switching to…" treatment below, independent of `engineState`
  // (which may sit at "checking" or briefly "not-installed" during this
  // window without disturbing the chat still on screen — see the guarded
  // early returns above).
  const switching = switchTargetLabel != null;
  // The selected model reloading inline after a failed/cancelled switch (see
  // `reloadToken`) — same inline treatment, never a full-screen takeover.
  const reloadingInline =
    !switching && engineState === "checking" && inFlight != null;

  return (
    <div className="vf-settings">
      <header className="vf-toolbar">
        <div className="vf-toolbar-title">
          <h2>AI Chat - {snapshot.workspace.name}</h2>
        </div>
      </header>

      <div className="vf-chat-body" ref={bodyRef} onScroll={handleBodyScroll}>
        {messages.length === 0 ? (
          <p className="vf-empty-note">
            {`Ask about ${snapshot.workspace.name} — e.g. "what's overdue?"`}
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={message.id}
              className={`vf-chat-message vf-chat-message-${message.role}`}
            >
              {message.content ? (
                <div
                  className={`vf-chat-bubble vf-chat-bubble-${message.role}`}
                >
                  <AiChatBubbleContent
                    text={message.content}
                    taskPaths={message.taskPaths}
                    queryMeta={message.queryMeta}
                    projectPaths={message.projectPaths}
                    projectQueryMeta={message.projectQueryMeta}
                    snapshot={snapshot}
                    taxonomies={taxonomies}
                    onOpenTask={openTask}
                    onOpenProject={openProject}
                    onLoadMore={() => loadMoreTasks(message.id)}
                    onLoadMoreProjects={() => loadMoreProjects(message.id)}
                  />
                </div>
              ) : (
                // No `.vf-chat-bubble` at all while there's nothing to show yet —
                // the thinking indicator gets no bubble chrome/background; only
                // once real content streams in does the bubble appear.
                sending &&
                index === messages.length - 1 && <ThinkingIndicator />
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
          ))
        )}
      </div>

      {/* Mid-conversation model switch: in-progress status while it's
			    happening, then a brief success/error note once it settles — the
			    inline alternative to the full-screen loading/install takeover a
			    fresh empty chat still gets (see the guarded early returns above). */}
      {switching || reloadingInline ? (
        <p className="vf-chat-switch-status">
          <ThinkingIndicator />
          <span>
            {switching
              ? `Switching to "${switchTargetLabel}"…`
              : `Loading "${selectedModelLabel}"…`}
            {inFlight ? ` ${inFlight.text}` : ""}
          </span>
          {inFlight && (
            <button
              type="button"
              className="vf-link-button"
              onClick={() => plugin.aiEngine.cancelInstall()}
            >
              Cancel
            </button>
          )}
        </p>
      ) : (
        switchNotice && (
          <p
            className={`vf-chat-switch-status${switchNotice.kind === "error" ? " is-error" : ""}`}
          >
            {switchNotice.message}
          </p>
        )
      )}

      {contextUsage && contextUsage.pct >= 90 && (
        <p className="vf-chat-context-warning">
          This conversation is close to "{selectedModelLabel}"'s context limit —
          consider starting a new conversation or switching to a model with a
          larger context window.
        </p>
      )}

      <div className="vf-chat-composer">
        <textarea
          ref={inputRef}
          className="vf-chat-input"
          value={input}
          placeholder="Ask about this workspace…"
          disabled={switching}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="vf-chat-composer-controls">
          {contextUsage && (
            <div
              className={`vf-chat-context-meter${
                contextUsage.pct >= 90
                  ? " is-critical"
                  : contextUsage.pct >= 80
                    ? " is-warning"
                    : ""
              }`}
              title={`~${contextUsage.pct}% of "${selectedModelLabel}"'s context window used (estimated)`}
            >
              <div className="vf-ai-progress">
                <div
                  className="vf-ai-progress-fill"
                  style={{ width: `${contextUsage.pct}%` }}
                />
              </div>
              <span className="vf-chat-context-meter-label">
                ~{contextUsage.pct}% of context
              </span>
            </div>
          )}
          <div className="vf-chat-composer-actions">
            <Select
              id="vf-chat-model"
              className="vf-select"
              aria-label="Model"
              value={selectedModelId}
              disabled={sending || switching || reloadingInline}
              onChange={(event) => switchModel(event.target.value)}
            >
              {AI_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            {sending ? (
              <button
                type="button"
                className="vf-chat-send-btn mod-warning"
                disabled={stopping}
                title={stopping ? "Stopping…" : "Stop generating"}
                aria-label={stopping ? "Stopping…" : "Stop generating"}
                onClick={stop}
              >
                <Icon id="square" size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="vf-chat-send-btn mod-cta"
                disabled={!input.trim() || switching || reloadingInline}
                title="Send message"
                aria-label="Send message"
                onClick={send}
              >
                <Icon id="arrow-up" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The AI Chat tab: a thin switch on the effective provider. The two views are
 * different components, so switching providers unmounts one entirely — the
 * built-in view's WebLLM hooks and mount-time model load never run while the
 * local model server is in use, and vice versa.
 */
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
  const provider = effectiveAiProvider(plugin.settings.aiProvider, Platform.isDesktop);
  if (provider === "local-server") {
    return <LocalServerChatView snapshot={snapshot} />;
  }
  return <BuiltinAiChatView snapshot={snapshot} taxonomies={taxonomies} context={context} />;
}
