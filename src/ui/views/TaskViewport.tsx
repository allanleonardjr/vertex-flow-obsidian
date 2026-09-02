/**
 * The Task viewport — one Saved View, rendered as either a List or a Board and
 * switchable between them live, with Group / Sort / Filter controls in its
 * header. Every Saved View (the built-in "Tasks" and every user-created
 * one) renders through this single component, so a view is only ever a filter +
 * a display config over the same machinery.
 *
 * Lifted wholesale out of `App.tsx`: this owns view evaluation, the keyboard
 * focus layout, the quick-capture pickup, and the list-scoped shortcuts. `App`
 * keeps only the shell, the tab strip, and Escape/tab handling.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildNestedRows,
  evaluateView,
  focusableRowPaths,
  partitionScheduled,
  seedFromFilters,
} from "../../core/views";
import type { ViewContext } from "../../core/views";
import { childTasks, primaryParent, scopeOf } from "../../core/hierarchy";
import { sortTasksByRank } from "../../core/ranking";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
import { useCreateTask } from "../actions";
import { usePlugin } from "../context";
import { useUnsavedGuard } from "../components/useUnsavedGuard";
import {
  useSelection,
  useShortcuts,
  useVisualLayout,
  type FocusLayout,
} from "../selection";
import { useTabs } from "../tabs-context";
import {
  QuickFieldPicker,
  type QuickPickerKind,
} from "../shortcuts/QuickFieldPicker";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { ListView } from "./ListView";
import { TimelineView } from "./TimelineView";
import { ViewControls } from "./ViewControls";
import { useViewDraft } from "./useViewDraft";

/** How long a lone `u` waits for its second key before lapsing. */
const CHORD_TIMEOUT_MS = 1000;

export function TaskViewport({
  snapshot,
  view,
  taxonomies,
  context,
  containerRef,
  active,
  onSelectView,
  hideViewTitle,
  guardUnsavedEdits = true,
}: {
  snapshot: WorkspaceSnapshot;
  view: SavedView;
  taxonomies: WorkspaceTaxonomies;
  context: ViewContext;
  /** The shell element list shortcuts bind to. */
  containerRef: HTMLElement | null;
  /** True while this viewport's tab is the one on screen. */
  active: boolean;
  /** Switch the sidebar/tab to another Saved View, after "Save as…". */
  onSelectView: (id: string) => void;
  /**
   * Suppress the control bar's own title row — used by the Project Detail
   * screen, which renders its own header above this viewport.
   */
  hideViewTitle?: boolean;
  /**
   * Whether unsaved bar edits block navigation away from the tab. On by
   * default; the Project Detail screen turns it off — its embedded viewport
   * is a synthesised, never-persisted view, so tweaking its sort/grouping is
   * transient scratch (like column collapse), not something to guard.
   */
  guardUnsavedEdits?: boolean;
}) {
  const plugin = usePlugin();
  const selection = useSelection();
  const createTask = useCreateTask();
  const tabs = useTabs();

  // Bar edits are held as an unsaved draft (see `useViewDraft`) — everything
  // below renders `draft.effective`, never the on-disk view directly.
  const draft = useViewDraft(snapshot, view);
  const effective = draft.effective;

  // The draft lives in local state and dies with this component on a tab
  // switch — guard against silently losing it. A synthesised label view has no
  // backing file, so it can't be overwritten (Save As only).
  const canOverwriteView = snapshot.views.some((v) => v.id === view.id);
  const leaveGuard = useUnsavedGuard({
    dirty: guardUnsavedEdits && draft.dirty,
    canSave: canOverwriteView,
    what: "view",
    name: view.name,
    guardKey: view.id,
    save: async () => {
      draft.save();
    },
    reset: draft.reset,
  });

  // "New task" from a filtered view pre-fills the fields the filter pins to a
  // single value — create a task while looking at one project or label and it
  // lands there, not in the unfiltered backlog.
  const newTask = useCallback(
    () =>
      void createTask(snapshot, seedFromFilters(effective.filters, context)),
    [createTask, snapshot, effective.filters, context],
  );

  // "Clear filters" from a zero-match empty state. Drops every filter clause
  // but keeps `archived` — an archived-visibility switch, not what emptied the
  // view. (`subtaskDisplay` isn't a filter at all any more.)
  const clearFilters = useCallback(() => {
    const { archived } = effective.filters;
    draft.edit({
      ...effective,
      filters: {
        ...(archived ? { archived } : {}),
      },
    });
  }, [draft, effective]);

  const evaluated = useMemo(
    () => evaluateView(snapshot, effective, context),
    [snapshot, context, effective],
  );

  // Which parent rows have their subtree collapsed in the nested List view.
  // Transient session state, like Board column collapse — never persisted, and
  // reset whenever the view changes.
  const [collapsedSubtrees, setCollapsedSubtrees] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => setCollapsedSubtrees(new Set()), [view.id]);

  // The keyboard field picker (opened via the `u` chord: `u s`/`u p`/`u l`/
  // `u t` for taxonomy fields, `u a`/`u r`/`u m`/`u e`/`u b`/`u d` for the
  // rest), or null. Bound to the focused task at the moment the key is pressed;
  // when tasks are multi-selected the batch is carried along so the picker
  // applies to all of them.
  const [quickPicker, setQuickPicker] = useState<{
    kind: QuickPickerKind;
    path: string;
    tasks: string[];
  } | null>(null);
  useEffect(() => setQuickPicker(null), [view.id]);

  // Save the keyboard focus, multi-selection, and scroll position when this
  // viewport unmounts (its tab loses focus — only the active tab stays
  // mounted), and restore them when it mounts again (the tab comes back to
  // the front).
  //
  // The save lives in a mount-effect *cleanup*, which fires on unmount after
  // the last committed render — selection changes always render before any
  // navigation, so this sees the final selection. Reading `active` via ref
  // avoids re-running the effect (and thus re-arm/teardown) on every focus
  // move; the cleanup captures the current ref value at unmount time.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (active) {
      // Restore on (re)mount: the tab is in front, bring back its place.
      const saved = tabs.getSelectionSnapshot(view.id);
      if (saved) {
        selection.clearSelection();
        for (const path of saved.selectedPaths) {
          selection.select(path, { toggle: true });
        }
        if (saved.focusedPath) selection.focus(saved.focusedPath);
        // Restore scroll position after a paint so the DOM is laid out.
        if (saved.scrollTop != null && containerRef) {
          window.requestAnimationFrame(() => {
            containerRef.scrollTop = saved.scrollTop;
          });
        }
      }
    }
    // Cleanup runs when the effect tears down — i.e. exactly when we unmount
    // (deps are stable), which is when the tab is backgrounded/closed.
    return () => {
      if (!activeRef.current) return; // never mounted active → nothing to save
      tabs.setSelectionSnapshot(view.id, {
        focusedPath: selectionRef.current.focusedPath,
        selectedPaths: [...selectionRef.current.selectedPaths],
        scrollTop: containerRef?.scrollTop ?? 0,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount-only effect that persists view selection snapshot
  }, []);
  const toggleSubtree = useCallback((path: string) => {
    setCollapsedSubtrees((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // The `u` chord — "update a field". A bare `u` arms a one-second chord; the
  // next key resolves it (`u s/p/t/l` → that field's taxonomy picker, `u a` →
  // assignee, `u r` → re-parent, `u m` → project, `u e` → estimate, `u b`/`u d`
  // → start/due date, `u x` → archive toggle), `u u` re-arms, and anything else
  // cancels and falls through. Same grammar as the `g`/`c` engine, but
  // task-scoped: it edits the focused task, so it lives in the viewport (gated
  // on this tab being on screen), not the app-root engine. Window capture so it
  // sees the key before the shell's bubble-phase handlers — which now use the
  // freed letters (`h`/`l` move columns, `x` toggles selection).
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
  const pendingU = useRef(false);
  const uTimer = useRef<number | null>(null);
  const clearPendingU = useCallback(() => {
    pendingU.current = false;
    if (uTimer.current != null) window.clearTimeout(uTimer.current);
    uTimer.current = null;
  }, []);
  const armU = useCallback(() => {
    pendingU.current = true;
    if (uTimer.current != null) window.clearTimeout(uTimer.current);
    uTimer.current = window.setTimeout(clearPendingU, CHORD_TIMEOUT_MS);
  }, [clearPendingU]);

  // Latest selection/evaluated for the chord listener, so the listener
  // identity is stable and doesn't re-bind on every focus move.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const evaluatedRef = useRef(evaluated);
  evaluatedRef.current = evaluated;

  useEffect(() => {
    if (!active) return;
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
      // Never steal modifier combos — those stay real Obsidian commands.
      if (event.metaKey || event.ctrlKey || event.altKey) {
        clearPendingU();
        return;
      }

      // Bare `u` arms the chord; a lone `u` outside a field does nothing else,
      // and we don't swallow it (same as `g`/`c` in the engine).
      if (event.key === "u") {
        armU();
        return;
      }
      if (!pendingU.current) return;

      const key = event.key.toLowerCase();
      // `u u` re-arms (consistent with `g g` / `c c`).
      if (key === "u") {
        armU();
        return;
      }
      clearPendingU();

      const kind = uPickerKey[key];
      const focusedPath = selectionRef.current.focusedPath;
      if (kind && focusedPath) {
        event.preventDefault();
        event.stopPropagation();
        const batch = selectionRef.current
          .targets(evaluatedRef.current.tasks)
          .map((t) => t.path);
        setQuickPicker({ kind, path: focusedPath, tasks: batch });
        return;
      }
      if (key === "x") {
        event.preventDefault();
        event.stopPropagation();
        const targets = selectionRef.current.targets(
          evaluatedRef.current.tasks,
        );
        if (targets.length === 0) return;
        const archiving = !targets[0].archived;
        void plugin.mutations.bulkUpdate(targets, {
          archived: archiving,
          archivedAt: archiving ? new Date().toISOString() : null,
        });
        return;
      }
      // Any other key cancels the chord and falls through.
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, clearPendingU, armU, plugin, setQuickPicker, uPickerKey]);

  /**
   * The nested List view's rows — one forest per rendered group. `null`
   * for every other layout and for `flat`/`hidden`, which render plain rows.
   */
  const nestedGroups = useMemo(() => {
    if (
      effective.viewType !== "list" ||
      effective.subtaskDisplay !== "nested"
    ) {
      return null;
    }
    const scope = scopeOf(snapshot);
    const matchedPaths = new Set(evaluated.tasks.map((task) => task.path));
    return evaluated.groups.map((group) => ({
      key: group.key,
      label: group.label,
      color: group.color,
      collapsed: group.collapsed,
      hidden: group.hidden,
      tasks: group.tasks,
      rows: buildNestedRows(group.tasks, scope, {
        matchedPaths,
        collapsed: collapsedSubtrees,
      }),
    }));
  }, [
    effective.viewType,
    effective.subtaskDisplay,
    evaluated,
    snapshot,
    collapsedSubtrees,
  ]);

  /**
   * The layout keyboard navigation walks.
   *
   * Derived from the rendered groups, never from `evaluated.tasks` — the flat
   * task list is in *sort* order, which on a grouped view interleaves columns.
   * Walking that with ↑/↓ makes focus appear to jump between columns on every
   * press.
   *
   * Board: one entry per column. List: one column, groups concatenated in
   * render order. Timeline: it ignores grouping entirely and renders scheduled
   * rows then unscheduled, so its layout matches that order, not the groups.
   * Collapsed groups contribute nothing, because you can't focus what you
   * can't see.
   */
  const layout = useMemo<FocusLayout>(() => {
    if (effective.viewType === "timeline") {
      const { scheduled, unscheduled } = partitionScheduled(evaluated.tasks);
      return [[...scheduled, ...unscheduled].map((task) => task.path)];
    }

    // Calendar renders on a day grid, not a linear column — j/k just walks
    // the filtered+sorted list, scheduled and unscheduled alike.
    if (effective.viewType === "calendar") {
      return [evaluated.tasks.map((task) => task.path)];
    }

    // Nested List: walk the flattened forest, groups concatenated, ghosts and
    // collapsed subtrees excluded (they aren't focusable).
    if (nestedGroups) {
      return [
        nestedGroups
          .filter((group) => !group.hidden && !group.collapsed)
          .flatMap((group) => focusableRowPaths(group.rows)),
      ];
    }

    const visible = evaluated.groups.filter((group) => !group.hidden);
    const paths = (group: (typeof visible)[number]) =>
      group.collapsed ? [] : group.tasks.map((task) => task.path);

    return effective.viewType === "board"
      ? visible.map(paths)
      : [visible.flatMap(paths)];
  }, [evaluated.groups, evaluated.tasks, effective.viewType, nestedGroups]);

  useVisualLayout(layout);

  // Pick up a task queued by something outside React — the quick-capture
  // command, which can fire while this view isn't even mounted, and the
  // task-note redirect (`file-open` in main.ts), which runs before React
  // exists at all on a cold start.
  useEffect(() => {
    const pending = plugin.pendingEditPath;
    if (!pending) return;
    plugin.pendingEditPath = null;
    tabs.openTask(pending);
  }, [plugin, tabs, evaluated]);

  useShortcuts(
    containerRef,
    [
      // j/k and the arrow keys walk the visual layout: up/down within a
      // column, left/right across board columns. vim h/l alias the column
      // movement now that `l` is no longer the Label picker (it moved behind
      // the `u` chord — `u l`).
      { key: "ArrowDown", run: () => selection.moveFocus(1) },
      { key: "ArrowUp", run: () => selection.moveFocus(-1) },
      { key: "j", run: () => selection.moveFocus(1) },
      { key: "k", run: () => selection.moveFocus(-1) },
      { key: "ArrowLeft", run: () => selection.moveColumn(-1) },
      { key: "ArrowRight", run: () => selection.moveColumn(1) },
      { key: "h", run: () => selection.moveColumn(-1) },
      { key: "l", run: () => selection.moveColumn(1) },

      // Selection toggle stays a bare key: `x`. (Archive is `u x`.)

      // Hierarchy navigation — ⌘/Ctrl+Shift+↑ to the parent, ↓ to the first
      // sub-task (Linear's convention).
      {
        key: "ArrowUp",
        mod: true,
        shift: true,
        run: () => {
          const focused = evaluated.tasks.find(
            (t) => t.path === selection.focusedPath,
          );
          if (!focused) return;
          const parent = primaryParent(focused);
          if (parent.kind === "task") tabs.openTask(parent.path);
          else if (parent.kind === "project") tabs.openProject(parent.path);
        },
      },
      {
        key: "ArrowDown",
        mod: true,
        shift: true,
        run: () => {
          const focused = evaluated.tasks.find(
            (t) => t.path === selection.focusedPath,
          );
          if (!focused) return;
          const kids = sortTasksByRank(
            childTasks(scopeOf(snapshot), focused.path),
          );
          const first = kids.find((kid) =>
            evaluated.tasks.some((t) => t.path === kid.path),
          );
          if (!first) return;
          if (nestedGroups && collapsedSubtrees.has(focused.path)) {
            toggleSubtree(focused.path);
          }
          selection.focus(first.path);
        },
      },

      { key: "a", mod: true, run: () => selection.selectAll() },
      {
        key: "x",
        run: () => {
          if (selection.focusedPath) {
            selection.select(selection.focusedPath, { toggle: true });
          }
        },
      },
      {
        key: " ",
        run: () => selection.toggleFocused(),
      },
      // Enter opens the task's own tab — the thing you almost always want.
      // Opening the raw Markdown note is the rarer, deliberate act, so it
      // gets its own key.
      {
        key: "Enter",
        run: () => {
          // If there's a multi-selection, open all selected tasks.
          // Otherwise fall back to opening the focused task.
          const targets =
            selection.selectedPaths.length > 0
              ? selection.selectedPaths
              : selection.focusedPath
                ? [selection.focusedPath]
                : [];
          for (const path of targets) tabs.openTask(path);
        },
      },
    ],
    // These act on the task list, so they're only live while this viewport's
    // tab is the one you're looking at. Escape is handled by App's unified
    // capture-phase listener instead, since it must work on every tab.
    active,
  );

  return (
    <>
      {leaveGuard}
      <ViewControls
        snapshot={snapshot}
        view={effective}
        savedView={view}
        draft={draft}
        taxonomies={taxonomies}
        evaluated={evaluated}
        onSelectView={onSelectView}
        onNewTask={newTask}
        hideTitle={hideViewTitle}
      />
      {effective.viewType === "timeline" ? (
        <TimelineView
          snapshot={snapshot}
          view={effective}
          evaluated={evaluated}
          taxonomies={taxonomies}
          onTimelineChange={draft.setTimeline}
        />
      ) : effective.viewType === "calendar" ? (
        <CalendarView
          snapshot={snapshot}
          view={effective}
          evaluated={evaluated}
          taxonomies={taxonomies}
          onCalendarChange={draft.setCalendar}
          onChange={draft.edit}
        />
      ) : effective.viewType === "board" ? (
        <BoardView
          snapshot={snapshot}
          view={effective}
          evaluated={evaluated}
          taxonomies={taxonomies}
          onColumnsChange={draft.setColumns}
        />
      ) : (
        <ListView
          snapshot={snapshot}
          view={effective}
          evaluated={evaluated}
          taxonomies={taxonomies}
          nestedGroups={nestedGroups}
          collapsedSubtrees={collapsedSubtrees}
          onToggleSubtree={toggleSubtree}
          onColumnsChange={draft.setColumns}
          onNewTask={newTask}
          onClearFilters={clearFilters}
        />
      )}

      {quickPicker &&
        (() => {
          const target = evaluated.tasks.find(
            (t) => t.path === quickPicker.path,
          );
          if (!target) return null;
          const batch =
            quickPicker.tasks.length > 0
              ? quickPicker.tasks
                  .map((p) => evaluated.tasks.find((t) => t.path === p))
                  .filter((t): t is NonNullable<typeof t> => t != null)
              : [target];
          return (
            <QuickFieldPicker
              task={target}
              tasks={batch}
              kind={quickPicker.kind}
              snapshot={snapshot}
              taxonomies={taxonomies}
              onClose={() => setQuickPicker(null)}
            />
          );
        })()}
    </>
  );
}
