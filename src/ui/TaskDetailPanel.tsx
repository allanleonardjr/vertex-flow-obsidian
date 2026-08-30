/**
 * The task detail panel — a Linear-style editor for one task.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ancestorTasks,
  childTasks,
  descendantTasks,
  scopeOf,
  subtaskProgress,
} from "../core/hierarchy";
import { sortTasksByRank } from "../core/ranking";
import { withExtension } from "../obsidian/note-io";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import type { Comment, Task, WorkspaceSnapshot } from "../core/types";
import { NEW_TASK_TITLE } from "./actions";
import {
  DateField,
  NumberField,
  OptionSelect,
  type Option,
  PersonSelect,
  PrioritySelect,
  PropertyRow,
  StatusSelect,
  TypeSelect,
  useDebouncedSave,
} from "./components/fields";
import { CollapsibleSection } from "./components/CollapsibleSection";
import { Icon } from "./components/Icon";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { DescriptionSection } from "./components/DescriptionSection";
import { EditorRail } from "./components/EditorRail";
import { ResizeHandle } from "./components/ResizeHandle";
import { MarkdownContent, MarkdownField } from "./components/Markdown";
import { ProgressBar, StatusDot } from "./components/TaskBits";
import { TaskBreadcrumb } from "./components/TaskBreadcrumb";
import { EmbeddedTaskList } from "./components/EmbeddedTaskList";
import { LabelEditor } from "./components/LabelEditor";
import { RelationsEditor } from "./components/RelationsEditor";
import { TaskSelectMenu } from "./components/TaskSelectMenu";
import { usePlugin } from "./context";

const TASK_INFO_MIN_HEIGHT = 80;
const TASK_SECTIONS_MIN_HEIGHT = 160;
const TASK_INFO_DEFAULT_HEIGHT = 220;

/**
 * Sub-tasks deeper than this still work, but get hard to scan — parenting past
 * it asks for a nudge, never blocks. One-based: a root task is level 1.
 */
const MAX_COMFORTABLE_DEPTH = 4;

/** The level (1-based) a task would sit at if parented under `parentPath`. */
function depthUnder(snapshot: WorkspaceSnapshot, parentPath: string): number {
  const parent = snapshot.tasks.find((t) => t.path === parentPath);
  if (!parent) return 1;
  return ancestorTasks(scopeOf(snapshot), parent).length + 2;
}

export interface TaskDetailPanelProps {
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onOpenTask: (path: string) => void;
  onClose: () => void;
  onCloseAllTasks: () => void;
}

export function TaskDetailPanel({
  task,
  snapshot,
  taxonomies,
  onOpenTask,
  onClose,
  onCloseAllTasks,
}: TaskDetailPanelProps) {
  const plugin = usePlugin();
  const [comments, setComments] = useState<Comment[]>([]);
  const [description, setDescription] = useState<string | null>(null);
  const [descCollapsed, setDescCollapsed] = useState(
    plugin.settings.descriptionCollapsed,
  );
  const [descSourceMode, setDescSourceMode] = useState(
    plugin.settings.descriptionSourceMode,
  );
  const [descHeight, setDescHeight] = useState(
    plugin.settings.taskDescriptionHeight,
  );

  const toggleDescription = () => {
    const next = !descCollapsed;
    setDescCollapsed(next);
    plugin.settings.descriptionCollapsed = next;
    void plugin.saveSettings();
  };

  const toggleSourceMode = () => {
    const next = !descSourceMode;
    setDescSourceMode(next);
    plugin.settings.descriptionSourceMode = next;
    void plugin.saveSettings();
  };

  const scope = scopeOf(snapshot);
  // Sub-tasks list in the shared global `rank` order, so it reads the same
  // here as in every other view.
  const children = sortTasksByRank(childTasks(scope, task.path));
  // Progress excludes archived sub-tasks; the list below still shows
  // them.
  const progress = subtaskProgress(scope, task, taxonomies.status);

  const update = (patch: Partial<Task>) =>
    void plugin.mutations.updateTask(task, patch);

  useEffect(() => {
    let cancelled = false;
    void plugin.mutations.readDocument(task).then((doc) => {
      if (cancelled) return;
      setDescription(doc.description);
      setComments(doc.comments);
    });
    return () => {
      cancelled = true;
    };
  }, [plugin, task.path]);

  return (
    <>
      <header className="vf-editor-header">
        <StatusDot taxonomies={taxonomies} status={task.status} />
        <span className="vf-id">{task.id}</span>
        {task.archived && <span className="vf-chip">Archived</span>}
        <span className="vf-editor-spacer" />
        <button
          type="button"
          className="vf-icon-button"
          title="Open the raw note in Obsidian"
          onClick={() => {
            plugin.suppressNextRedirect();
            void plugin.mutations.open(task.path);
          }}
        >
          ↗
        </button>
        <button
          type="button"
          className="vf-icon-button"
          title="Close tab (Esc) — shift-click to close every task tab"
          onClick={(event) => (event.shiftKey ? onCloseAllTasks() : onClose())}
        >
          ✕
        </button>
      </header>

      <TaskBreadcrumb
        task={task}
        snapshot={snapshot}
        taxonomies={taxonomies}
        onOpenTask={onOpenTask}
      />

      <div className="vf-editor-body">
        <div className="vf-editor-main-col">
          <div className="vf-editor-main vf-task-editor-title">
            <TitleField task={task} />
          </div>

          <main
            className={`vf-editor-main vf-task-editor-info${
              descCollapsed ? " is-collapsed" : ""
            }`}
            style={
              descCollapsed
                ? undefined
                : { height: descHeight, flex: "0 0 auto" }
            }
          >
            <DescriptionSection
              collapsed={descCollapsed}
              onToggleCollapsed={toggleDescription}
              sourceMode={descSourceMode}
              onToggleSourceMode={toggleSourceMode}
              value={description}
              editorKey={task.path}
              sourcePath={withExtension(task.path)}
              onSave={(text) => void plugin.mutations.setDescription(task, text)}
            />
          </main>

          {!descCollapsed && (
            <ResizeHandle
              axis="y"
              sign={1}
              value={descHeight}
              min={TASK_INFO_MIN_HEIGHT}
              computeMax={(colHeight) => colHeight - TASK_SECTIONS_MIN_HEIGHT}
              onResize={setDescHeight}
              onResizeEnd={(next) => {
                plugin.settings.taskDescriptionHeight = next;
                void plugin.saveSettings();
              }}
              resetTo={TASK_INFO_DEFAULT_HEIGHT}
              className="vf-task-editor-resize"
            />
          )}

          <div className="vf-task-editor-sections">
            <CollapsibleSection
              id="subtasks"
              title="Sub-tasks"
              aside={
                progress.total > 0 ? <ProgressBar progress={progress} /> : null
              }
            >
              <EmbeddedTaskList
                tasks={children}
                snapshot={snapshot}
                taxonomies={taxonomies}
                onOpenTask={onOpenTask}
                onRemove={(path) => {
                  const child = children.find((c) => c.path === path);
                  if (child) {
                    void plugin.mutations.updateTask(child, { parent: null });
                  }
                }}
                removeTitle={(title) =>
                  `Unlink sub-task “${title}” — it becomes a top-level task`
                }
                renderAddTrigger={() => (
                  <AddSubtaskTrigger
                    task={task}
                    snapshot={snapshot}
                    taxonomies={taxonomies}
                  />
                )}
              />
            </CollapsibleSection>

            <CollapsibleSection id="relations" title="Relations">
              <RelationsEditor
                task={task}
                snapshot={snapshot}
                taxonomies={taxonomies}
                onChange={update}
                onOpenTask={onOpenTask}
              />
            </CollapsibleSection>

            <CollapsibleSection id="comments" title="Comments">
              <CommentList
                task={task}
                comments={comments}
                onChanged={(next) => setComments(next)}
              />
            </CollapsibleSection>
          </div>
        </div>

        <EditorRail>
          <PropertyRow label="Status">
            <StatusSelect
              taxonomy={taxonomies.status}
              value={task.status}
              onChange={(status) => status && update({ status })}
            />
          </PropertyRow>

          <PropertyRow label="Priority">
            <PrioritySelect
              taxonomy={taxonomies.priority}
              value={task.priority}
              onChange={(priority) => update({ priority })}
            />
          </PropertyRow>

          <PropertyRow label="Type">
            <TypeSelect
              taxonomy={taxonomies.taskType}
              value={task.taskType}
              onChange={(taskType) => update({ taskType })}
            />
          </PropertyRow>

          <PropertyRow label="Assignee">
            <PersonSelect
              people={snapshot.workspace.people}
              value={task.assignee}
              onChange={(assignee) => update({ assignee })}
            />
          </PropertyRow>

          <PropertyRow label="Labels">
            <LabelEditor
              snapshot={snapshot}
              taxonomy={taxonomies.label}
              value={task.labels}
              onChange={(labels) => update({ labels })}
            />
          </PropertyRow>

          <ParentPicker
            task={task}
            snapshot={snapshot}
            taxonomies={taxonomies}
            onChange={update}
          />

          <ProjectPicker task={task} snapshot={snapshot} onChange={update} />

          <PropertyRow label="Estimate">
            <NumberField
              value={task.estimate}
              placeholder={snapshot.workspace.estimateUnitLabel ?? "—"}
              onChange={(estimate) => update({ estimate })}
            />
          </PropertyRow>

          <PropertyRow label="Start">
            <DateField
              value={task.startDate}
              onChange={(startDate) => update({ startDate })}
            />
          </PropertyRow>

          <PropertyRow label="Due">
            <DateField
              value={task.dueDate}
              onChange={(dueDate) => update({ dueDate })}
            />
          </PropertyRow>

          <PropertyRow label="Archived">
            <label className="vf-toggle">
              <input
                type="checkbox"
                checked={task.archived}
                onChange={(event) =>
                  update({
                    archived: event.target.checked,
                    archivedAt: event.target.checked
                      ? new Date().toISOString()
                      : null,
                  })
                }
              />
              <span>Hide from views</span>
            </label>
          </PropertyRow>

          <RawSourceSection task={task} />
        </EditorRail>
      </div>
    </>
  );
}

/**
 * A read-only look at the task note exactly as it sits on disk — frontmatter
 * and body. Collapsed by default; the open state is remembered. Re-reads
 * whenever the task changes while open, so it tracks edits made above.
 */
function RawSourceSection({ task }: { task: Task }) {
  const plugin = usePlugin();
  const [open, setOpen] = useState(plugin.settings.editorSourceOpen);
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setRaw(null);
    void plugin.mutations.readRaw(task).then((text) => {
      if (live) setRaw(text);
    });
    return () => {
      live = false;
    };
  }, [open, plugin, task.path, task.updatedAt]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    plugin.settings.editorSourceOpen = next;
    void plugin.saveSettings();
  };

  return (
    <div className="vf-editor-rail-section">
      <button
        type="button"
        className="vf-rail-section-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        <span
          className={`vf-section-chevron${open ? " is-open" : ""}`}
          aria-hidden
        >
          ›
        </span>
        Source
      </button>
      {open && (
        <pre className="vf-source-view">
          <code>{raw ?? "Loading…"}</code>
        </pre>
      )}
    </div>
  );
}

function TitleField({ task }: { task: Task }) {
  const plugin = usePlugin();
  const [title, setTitle] = useDebouncedSave(task.title, (value) => {
    void plugin.mutations.updateTask(task, { title: value.trim() || task.id });
  });

  const isPlaceholder = task.title === NEW_TASK_TITLE;
  const focusRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
      if (isPlaceholder) {
        element.focus();
        element.select();
      }
    },
    [isPlaceholder],
  );

  return (
    <textarea
      ref={focusRef}
      className="vf-editor-title"
      value={title}
      rows={1}
      placeholder="Task title"
      onChange={(event) => setTitle(event.target.value)}
      onInput={(event) => {
        const el = event.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }}
    />
  );
}

/**
 * "+ Add sub-task" — styled like the relations add-triggers. Picking a task
 * makes *this* task its parent. A task that already has a parent isn't silently
 * re-parented: a modal asks whether to move it here or cancel.
 */
function AddSubtaskTrigger({
  task,
  snapshot,
  taxonomies,
}: {
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
}) {
  const plugin = usePlugin();
  const [conflict, setConflict] = useState<Task | null>(null);
  const [tooDeep, setTooDeep] = useState<Task | null>(null);

  // Can't parent a task to itself, to one of its own descendants (a cycle), or
  // to a task that's already its child.
  const blocked = new Set(
    descendantTasks(scopeOf(snapshot), task.path).map((t) => t.path),
  );
  const candidates = snapshot.tasks.filter(
    (candidate) =>
      candidate.path !== task.path &&
      !blocked.has(candidate.path) &&
      candidate.parent !== task.path,
  );

  const commit = (picked: Task) => {
    if (picked.parent) {
      setConflict(picked);
      return;
    }
    void plugin.mutations.setParent(picked, task.path);
  };

  const add = (path: string) => {
    const picked = snapshot.tasks.find((t) => t.path === path);
    if (!picked) return;
    if (depthUnder(snapshot, task.path) > MAX_COMFORTABLE_DEPTH) {
      setTooDeep(picked);
      return;
    }
    commit(picked);
  };

  return (
    <>
      <TaskSelectMenu
        candidates={candidates}
        snapshot={snapshot}
        taxonomies={taxonomies}
        value={null}
        onSelect={(path) => path && add(path)}
        noneLabel="Cancel"
        searchPlaceholder="Search tasks…"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className={`vf-add-relation${open ? " is-on" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            + Add sub-task
          </button>
        )}
      />

      {conflict && (
        <ReparentSubtaskDialog
          child={conflict}
          currentParent={
            snapshot.tasks.find((t) => t.path === conflict.parent) ?? null
          }
          newParent={task}
          onConfirm={() => {
            void plugin.mutations.setParent(conflict, task.path);
            setConflict(null);
          }}
          onClose={() => setConflict(null)}
        />
      )}

      {tooDeep && (
        <ConfirmDeleteDialog
          title={`Nest "${tooDeep.title}" ${depthUnder(
            snapshot,
            task.path,
          )} levels deep?`}
          body="Deeply nested sub-tasks get hard to scan. You can still add it."
          confirmLabel="Add anyway"
          onCancel={() => setTooDeep(null)}
          onConfirm={() => {
            const picked = tooDeep;
            setTooDeep(null);
            commit(picked);
          }}
        />
      )}
    </>
  );
}

/**
 * The task picked for "+ Add sub-task" is already someone else's sub-task.
 * A task has exactly one primary parent (Golden Rule), so this is a real
 * either/or: move it here, or leave it where it is.
 */
function ReparentSubtaskDialog({
  child,
  currentParent,
  newParent,
  onConfirm,
  onClose,
}: {
  child: Task;
  currentParent: Task | null;
  newParent: Task;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const label = (task: Task) => `${task.id} ${task.title}`;

  return createPortal(
    <div className="vf-editor-backdrop" onClick={onClose}>
      <div
        className="vf-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Move "{label(child)}" here?</h3>
        <p className="vf-dialog-lead">
          It's already a sub-task of{" "}
          {currentParent ? `"${label(currentParent)}"` : "another task"}. A task
          has only one parent, so moving it under "{label(newParent)}" removes
          it from there.
        </p>
        <div className="vf-dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="mod-cta" onClick={onConfirm}>
            Move it here
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The task's parent *task* — its one true nesting position (Golden Rule).
 * Tasks only; the Project association is an independent field, edited by
 * `ProjectPicker` below. Setting or clearing a parent never touches `project`.
 */
function ParentPicker({
  task,
  snapshot,
  taxonomies,
  onChange,
}: {
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onChange: (patch: Partial<Task>) => void;
}) {
  // Its own descendants can't become its parent.
  const blocked = new Set(
    descendantTasks(scopeOf(snapshot), task.path).map((t) => t.path),
  );
  const candidates = snapshot.tasks.filter(
    (candidate) => candidate.path !== task.path && !blocked.has(candidate.path),
  );

  const parentTask = task.parent
    ? snapshot.tasks.find((t) => t.path === task.parent)
    : null;

  const [tooDeep, setTooDeep] = useState<string | null>(null);

  const choose = (parent: string | null) => {
    if (parent && depthUnder(snapshot, parent) > MAX_COMFORTABLE_DEPTH) {
      setTooDeep(parent);
      return;
    }
    onChange({ parent });
  };

  return (
    <PropertyRow label="Parent">
      {tooDeep && (
        <ConfirmDeleteDialog
          title={`Nest "${task.title}" ${depthUnder(snapshot, tooDeep)} levels deep?`}
          body="Deeply nested sub-tasks get hard to scan. You can still move it."
          confirmLabel="Move anyway"
          onCancel={() => setTooDeep(null)}
          onConfirm={() => {
            const parent = tooDeep;
            setTooDeep(null);
            onChange({ parent });
          }}
        />
      )}
      <TaskSelectMenu
        candidates={candidates}
        snapshot={snapshot}
        taxonomies={taxonomies}
        value={task.parent}
        onSelect={choose}
        noneLabel="No parent"
        searchPlaceholder="Search tasks…"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className="vf-icon-select-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            {parentTask ? (
              <>
                <StatusDot taxonomies={taxonomies} status={parentTask.status} />
                <span className="vf-id">{parentTask.id}</span>
                <span className="vf-icon-select-name">{parentTask.title}</span>
              </>
            ) : (
              <span className="vf-icon-select-name vf-prop-empty">
                No parent
              </span>
            )}
            <span className="vf-icon-select-caret" aria-hidden>
              ⌄
            </span>
          </button>
        )}
      />
    </PropertyRow>
  );
}

/**
 * The task's Project — an association orthogonal to its parent task, not a
 * second parent. A sub-task can carry both at once; this edits `project` alone
 * and never touches `parent`.
 */
function ProjectPicker({
  task,
  snapshot,
  onChange,
}: {
  task: Task;
  snapshot: WorkspaceSnapshot;
  onChange: (patch: Partial<Task>) => void;
}) {
  // Each row carries the project's own icon, the way the tab strip and sidebar
  // draw it — so the picker looks like the thing it's picking.
  const options: Option[] = snapshot.projects
    .map((project) => ({
      value: project.path,
      label: project.title,
      icon: <Icon id={project.icon} fallback="folder" size={13} />,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <PropertyRow label="Project">
      <OptionSelect
        options={options}
        value={task.project}
        onChange={(project) => onChange({ project })}
        noneLabel="No project"
        searchPlaceholder="Search projects…"
      />
    </PropertyRow>
  );
}

function CommentList({
  task,
  comments,
  onChanged,
}: {
  task: Task;
  comments: Comment[];
  onChanged: (comments: Comment[]) => void;
}) {
  const plugin = usePlugin();
  const [draft, setDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const self = plugin
    .activeWorkspace()
    ?.workspace.people.find((person) => person.isSelf);

  const reload = async () => {
    const doc = await plugin.mutations.readDocument(task);
    onChanged(doc.comments);
  };

  const deletingComment = comments.find((c) => c.id === deletingId);

  return (
    <div className="vf-comments">
      {deletingComment && (
        <ConfirmDeleteDialog
          title="Delete comment?"
          body="This can't be undone."
          onCancel={() => setDeletingId(null)}
          onConfirm={() => {
            setDeletingId(null);
            void plugin.mutations
              .deleteComment(task, deletingComment.id)
              .then(reload);
          }}
        />
      )}
      {comments.map((comment) => (
        <article key={comment.id} className="vf-comment">
          <header>
            <strong>{comment.author}</strong>
            <span className="vf-comment-date">{comment.date.slice(0, 10)}</span>
            <button
              type="button"
              className="vf-icon-button"
              title="Delete comment"
              onClick={() => setDeletingId(comment.id)}
            >
              ✕
            </button>
          </header>
          <MarkdownContent
            className="vf-comment-body"
            text={comment.body}
            sourcePath={withExtension(task.path)}
          />
          {Object.entries(comment.reactions).length > 0 && (
            <div className="vf-reactions">
              {Object.entries(comment.reactions).map(([emoji, count]) => (
                <span key={emoji} className="vf-reaction">
                  {emoji} {count}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}

      <CommentDraftField
        placeholder={
          self
            ? `Comment as ${self.name}… (@mention to notify)`
            : "Add a comment…"
        }
        value={draft}
        onChange={setDraft}
        sourcePath={withExtension(task.path)}
      />
      <button
        type="button"
        className="mod-cta"
        disabled={!draft.trim()}
        onClick={() =>
          void plugin.mutations
            .addComment(task, self?.id ?? "me", draft)
            .then(() => {
              setDraft("");
              return reload();
            })
        }
      >
        Comment
      </button>
    </div>
  );
}

function CommentDraftField({
  value,
  onChange,
  placeholder,
  sourcePath,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  sourcePath: string;
}) {
  return (
    <MarkdownField
      className="vf-comment-draft"
      value={value}
      onChange={onChange}
      sourcePath={sourcePath}
      placeholder={placeholder}
    />
  );
}
