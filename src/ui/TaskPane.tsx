/**
 * Renders one task's tab content.
 *
 * Resolves the task and its own owning workspace/taxonomies fresh via
 * `plugin.index` on every render — never through whichever workspace
 * `App.tsx` currently considers "active." A task tab can legitimately outlive
 * a workspace switch (open a task in workspace A, then one in workspace B —
 * A's tab is still sitting there), and the *active* tab itself can briefly be
 * for a workspace that `App.tsx`'s own state hasn't caught up to yet, right
 * after `openTask()` flips it. Scoping the lookup to a passed-down snapshot
 * prop made both of those render a permanently blank pane.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workspaceTaxonomies } from "../core/taxonomy";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { TaskDetailPanel } from "./TaskDetailPanel";
import {
  QuickFieldPicker,
  type QuickPickerKind,
} from "./shortcuts/QuickFieldPicker";

/** How long a lone `u` waits for its second key before lapsing. */
const CHORD_TIMEOUT_MS = 1000;

export function TaskPane({ path }: { path: string }) {
  const plugin = usePlugin();
  const { openTask, close, closeActive, closeAllTasks } = useTabs();

  const owner = plugin.index.workspaceFor(path);
  const task =
    owner?.tasks.find((candidate) => candidate.path === path) ?? null;

  // Genuinely unresolvable (deleted since the last index rebuild — the tab
  // strip's own prune effect normally catches this first). Closing has to
  // happen in an effect, not inline during render: calling a state setter
  // while this component is still rendering is unsafe in React.
  useEffect(() => {
    if (!task) close(path);
  }, [task, close, path]);

  // Mirror "the task in front" out to the plugin so native commands (Stop
  // repeating…) can act on it. Cleared when this pane unmounts.
  useEffect(() => {
    plugin.activeTaskPath = path;
    return () => {
      if (plugin.activeTaskPath === path) plugin.activeTaskPath = null;
    };
  }, [plugin, path]);

  // The `u` chord for the single-task editor, mirroring TaskViewport's:
  // a bare `u` arms a one-second chord; the next key resolves it to a field
  // picker (`u s`/`u p`/`u l`/`u t`/`u a`/`u r`/`u m`/`u e`/`u b`/`u d`),
  // the archive toggle (`u x`), or a focus jump to an already-visible field
  // (`u n` title, `u i` description, `u c` comment composer — handled as
  // special cases below, not through this map). `u u` re-arms, anything
  // else cancels. Bound to this tab's task — never the selection, which the
  // editor doesn't participate in.
  const uPickerKey: Record<string, QuickPickerKind> = useMemo(
    () => ({
      s: "status",
      p: "priority",
      t: "taskType",
      l: "label",
      a: "assignee",
      r: "parent",
      m: "project",
      e: "estimate",
      b: "startDate",
      d: "dueDate",
    }),
    [],
  );

  // The field picker this tab is showing, or null.
  const [quickPicker, setQuickPicker] = useState<{
    kind: QuickPickerKind;
  } | null>(null);

  const pendingU = useRef(false);
  const uTimer = useRef<number | null>(null);
  const clearPendingU = useCallback(() => {
    pendingU.current = false;
    if (uTimer.current != null) {
      window.clearTimeout(uTimer.current);
      uTimer.current = null;
    }
  }, []);
  const armU = useCallback(() => {
    pendingU.current = true;
    if (uTimer.current != null) window.clearTimeout(uTimer.current);
    uTimer.current = window.setTimeout(clearPendingU, CHORD_TIMEOUT_MS);
  }, [clearPendingU]);

  useEffect(() => {
    if (!task) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        clearPendingU();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        clearPendingU();
        return;
      }

      if (event.key === "u") {
        armU();
        return;
      }
      if (!pendingU.current) return;

      const key = event.key.toLowerCase();
      if (key === "u") {
        armU();
        return;
      }
      clearPendingU();

      const kind = uPickerKey[key];
      if (kind) {
        event.preventDefault();
        event.stopPropagation();
        setQuickPicker({ kind });
        return;
      }

      // `n`/`i`/`c` don't open a picker — the title, description and
      // comment fields are already on screen in this context, so the
      // shortcut just moves focus there. Scoped through this tab's own
      // `[data-task-path]` wrapper (see `TaskDetailPanel`) so a second
      // task tab's fields are never touched. A List/Board row carries
      // the same attribute, so pick the match that is actually the
      // open editor.
      const editorScope = () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            `[data-task-path="${CSS.escape(task.path)}"]`,
          ),
        ].find((el) => el.querySelector(".vf-editor-title")) ?? null;

      if (key === "n") {
        event.preventDefault();
        event.stopPropagation();
        const field =
          editorScope()?.querySelector<HTMLTextAreaElement>(".vf-editor-title");
        field?.focus();
        field?.select();
        return;
      }
      if (key === "i") {
        event.preventDefault();
        event.stopPropagation();
        const scope = editorScope();
        if (!scope) return;
        const toggle = scope.querySelector<HTMLButtonElement>(
          ".vf-description-toggle",
        );
        const wasCollapsed = toggle?.getAttribute("aria-expanded") === "false";
        if (wasCollapsed) toggle?.click();
        const focusEditor = (attempt = 0) => {
          const el = scope.querySelector<HTMLElement>(
            ".vf-editor-description .cm-content, .vf-editor-description .vf-markdown-edit",
          );
          if (el) el.focus();
          else if (attempt < 20)
            window.requestAnimationFrame(() => focusEditor(attempt + 1));
        };
        // The editor mounts a frame or two after the section expands.
        if (wasCollapsed) window.requestAnimationFrame(() => focusEditor());
        else focusEditor();
        return;
      }
      if (key === "c") {
        event.preventDefault();
        event.stopPropagation();
        const composer =
          editorScope()?.querySelector<HTMLElement>(".vf-comment-draft");
        if (!composer) return;
        composer.scrollIntoView({ behavior: "smooth", block: "center" });
        composer
          .querySelector<HTMLElement>(".cm-content, .vf-markdown-edit")
          ?.focus();
        return;
      }
      if (key === "x") {
        event.preventDefault();
        event.stopPropagation();
        const archiving = !task.archived;
        void plugin.mutations.updateTask(task, {
          archived: archiving,
          archivedAt: archiving ? new Date().toISOString() : null,
        });
        return;
      }
      // Any other key cancels the chord and falls through.
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [task, clearPendingU, armU, uPickerKey]);

  if (!owner || !task) return null;

  const snapshot = owner;

  return (
    <>
      <TaskDetailPanel
        key={task.path}
        task={task}
        snapshot={snapshot}
        taxonomies={workspaceTaxonomies(owner.workspace)}
        onOpenTask={openTask}
        onClose={closeActive}
        onCloseAllTasks={closeAllTasks}
      />

      {quickPicker && task && (
        <QuickFieldPicker
          key={`${task.path}:${quickPicker.kind}`}
          task={task}
          kind={quickPicker.kind}
          snapshot={snapshot}
          taxonomies={workspaceTaxonomies(owner.workspace)}
          onClose={() => setQuickPicker(null)}
          anchorSelector={`[data-field="${quickPicker.kind}"]`}
        />
      )}
    </>
  );
}
