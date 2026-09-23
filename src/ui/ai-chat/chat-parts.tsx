/**
 * Presentational pieces shared by both AI Chat views — the built-in WebLLM
 * chat (`AiChatView.tsx`) and the local model server chat
 * (`LocalServerChatView.tsx`). Moved here as-is rather than rewritten, so
 * the built-in view renders exactly the same DOM it always has; nothing in
 * this file knows which provider is answering.
 */

import { useEffect, useRef, useState } from "react";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Project, Task, WorkspaceSnapshot } from "../../core/types";
import { Icon } from "../components/Icon";
import { MarkdownContent } from "../components/Markdown";
import { TaskList } from "../components/TaskList";
import { TaxonomyChip } from "../components/TaskBits";
import type { AiChatBubble } from "./ai-chat-session";

/**
 * A pseudo vault path for `MarkdownContent`'s `sourcePath` — there's no real
 * note behind a chat bubble, but a relative link/embed still needs something
 * to resolve against, the same role `HELP_SOURCE_PATH` plays for the Help pane
 * (see `HelpView.tsx`/`ShortcutsHelpDialog.tsx`).
 */
export const AI_CHAT_SOURCE_PATH = "Vertex Flow AI Chat.md";

/**
 * A `searchProjects` result rendered as a plain, clickable list — title +
 * status chip, same spirit as `TaskList`'s rows but with no reusable
 * project-row component in the app to lean on (unlike tasks' `TaskList`),
 * so this stays a small inline renderer, shared by both AI Chat providers'
 * views rather than promoted to an app-wide component.
 */
export function AiChatProjectList({
  projects,
  taxonomies,
  onOpenProject,
}: {
  projects: Project[];
  taxonomies: WorkspaceTaxonomies;
  onOpenProject: (path: string) => void;
}) {
  return (
    <div className="vf-chat-project-list">
      {projects.map((project) => (
        <button
          key={project.path}
          type="button"
          className="vf-chat-project-row"
          onClick={() => onOpenProject(project.path)}
        >
          <TaxonomyChip taxonomies={taxonomies} kind="status" id={project.status} />
          <span className="vf-chat-project-title">{project.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Shown in place of an assistant bubble's content before the first token has streamed in. Pure CSS animation — no timers, no state. */
export function ThinkingIndicator() {
  return (
    <span className="vf-chat-thinking" aria-label="Thinking…">
      <span className="vf-chat-thinking-dot" />
      <span className="vf-chat-thinking-dot" />
      <span className="vf-chat-thinking-dot" />
    </span>
  );
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
export function useThrottledText(text: string): string {
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
      if (frameRef.current != null)
        window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return display;
}

/** A message's Markdown, re-rendered at most once per animation frame while it streams (`useThrottledText`). */
export function ChatMarkdown({ text }: { text: string }) {
  const display = useThrottledText(text);
  return <MarkdownContent text={display} sourcePath={AI_CHAT_SOURCE_PATH} />;
}

/**
 * Tasks listed under an answer as real, clickable rows. The caller resolves
 * the tasks and passes the snapshot/taxonomies they belong to — the local
 * server chat's results can come from a workspace other than the pane's.
 */
export function ChatTaskList({
  tasks,
  snapshot,
  taxonomies,
  onOpenTask,
}: {
  tasks: Task[];
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onOpenTask: (path: string) => void;
}) {
  return (
    <TaskList
      className="vf-chat-task-list"
      groups={[{ key: "ai-results", tasks }]}
      snapshot={snapshot}
      taxonomies={taxonomies}
      onOpenTask={onOpenTask}
    />
  );
}

/** Copy (both roles), Retry (the most recent assistant reply only) and Edit (user messages) under a message. All disabled while a response is generating. */
export function ChatMessageActions({
  message,
  isLastAssistant,
  sending,
  copied,
  onCopy,
  onRetry,
  onEdit,
}: {
  message: AiChatBubble;
  isLastAssistant: boolean;
  sending: boolean;
  copied: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="vf-chat-actions">
      {message.role === "assistant" && message.content && (
        <button
          type="button"
          className="vf-icon-button"
          title="Copy"
          aria-label="Copy message"
          disabled={sending}
          onClick={onCopy}
        >
          <Icon id={copied ? "check" : "copy"} size={13} />
        </button>
      )}
      {message.role === "assistant" &&
        message.content &&
        isLastAssistant &&
        !sending && (
          <button
            type="button"
            className="vf-icon-button"
            title="Retry"
            aria-label="Retry this response"
            onClick={onRetry}
          >
            <Icon id="rotate-ccw" size={13} />
          </button>
        )}
      {message.role === "user" && (
        <button
          type="button"
          className="vf-icon-button"
          title="Rollback and Edit"
          aria-label="Roll back and edit this message"
          disabled={sending}
          onClick={onEdit}
        >
          <Icon id="undo-2" size={13} />
        </button>
      )}
      {message.role === "user" && (
        <button
          type="button"
          className="vf-icon-button"
          title="Copy"
          aria-label="Copy message"
          disabled={sending}
          onClick={onCopy}
        >
          <Icon id={copied ? "check" : "copy"} size={13} />
        </button>
      )}
    </div>
  );
}
