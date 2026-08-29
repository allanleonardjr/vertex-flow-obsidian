/**
 * The task detail panel — a Linear-style editor for one task.
 */

import { useCallback, useEffect, useState } from "react";
import {
  childTasks,
  computeProgress,
  descendantTasks,
  scopeOf,
} from "../core/hierarchy";
import { withExtension } from "../obsidian/note-io";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import type { Comment, Task, WorkspaceSnapshot } from "../core/types";
import { NEW_TASK_TITLE } from "./actions";
import {
  DateField,
  NumberField,
  PersonSelect,
  PrioritySelect,
  PropertyRow,
  StatusSelect,
  TypeSelect,
  useDebouncedSave,
} from "./components/fields";
import { EditorRail } from "./components/EditorRail";
import { MarkdownContent, MarkdownField } from "./components/Markdown";
import { ProgressBar, StatusDot } from "./components/TaskBits";
import { EmbeddedTaskList } from "./components/EmbeddedTaskList";
import { LabelEditor } from "./components/LabelEditor";
import { RelationsEditor } from "./components/RelationsEditor";
import {
  TaskSelectMenu,
  type TaskSelectExtraOption,
} from "./components/TaskSelectMenu";
import { usePlugin } from "./context";

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

  const scope = scopeOf(snapshot);
  const children = childTasks(scope, task.path);
  const progress = computeProgress(children, taxonomies.status);

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

      <div className="vf-editor-body">
        <main className="vf-editor-main">
          <TitleField task={task} />

          {description === null ? (
            <div className="vf-editor-loading">Loading…</div>
          ) : (
            <DescriptionField task={task} initial={description} />
          )}

          <section className="vf-editor-section">
            <h4>
              Sub-tasks{" "}
              {children.length > 0 && <ProgressBar progress={progress} />}
            </h4>
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
              removeTitle={(title) => `Unlink sub-task ${title}`}
            />
          </section>

          <section className="vf-editor-section">
            <h4>Relations</h4>
            <RelationsEditor
              task={task}
              snapshot={snapshot}
              taxonomies={taxonomies}
              onChange={update}
              onOpenTask={onOpenTask}
            />
          </section>

          <section className="vf-editor-section">
            <h4>Comments</h4>
            <CommentList
              task={task}
              comments={comments}
              onChanged={(next) => setComments(next)}
            />
          </section>
        </main>

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

function DescriptionField({ task, initial }: { task: Task; initial: string }) {
  const plugin = usePlugin();
  const [text, setText] = useDebouncedSave(initial, (value) => {
    void plugin.mutations.setDescription(task, value);
  });

  return (
    <MarkdownField
      className="vf-editor-description"
      value={text}
      onChange={setText}
      sourcePath={withExtension(task.path)}
      placeholder="Add a description… start typing Markdown — [[wikilinks]], #tags, and ![[embeds]] all work, with live preview and link suggestions as you go"
    />
  );
}

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
  const value = task.parent ?? task.project ?? null;

  // Its own descendants can't become its parent.
  const blocked = new Set(
    descendantTasks(scopeOf(snapshot), task.path).map((t) => t.path),
  );
  const candidates = snapshot.tasks.filter(
    (candidate) => candidate.path !== task.path && !blocked.has(candidate.path),
  );

  const extraOptions: TaskSelectExtraOption[] = snapshot.projects.map(
    (project) => ({
      value: project.path,
      search: project.title,
      label: (
        <span className="vf-task-option-plain">
          <span className="vf-task-option-kind">Project</span>
          {project.title}
        </span>
      ),
    }),
  );

  const parentTask = task.parent
    ? snapshot.tasks.find((t) => t.path === task.parent)
    : null;
  const parentProject = task.project
    ? snapshot.projects.find((p) => p.path === task.project)
    : null;

  const apply = (next: string | null) => {
    if (!next) {
      onChange({ parent: null, project: null });
      return;
    }
    const isTask = snapshot.tasks.some((t) => t.path === next);
    onChange({
      parent: isTask ? next : null,
      project: isTask ? null : next,
    });
  };

  return (
    <PropertyRow label="Parent">
      <TaskSelectMenu
        candidates={candidates}
        snapshot={snapshot}
        taxonomies={taxonomies}
        value={value}
        onSelect={apply}
        noneLabel="No parent"
        searchPlaceholder="Search projects & tasks…"
        extraOptions={extraOptions}
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
            ) : parentProject ? (
              <span className="vf-icon-select-name">
                <span className="vf-task-option-kind">Project</span>
                {parentProject.title}
              </span>
            ) : (
              <span className="vf-icon-select-name vf-prop-empty">No parent</span>
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
  const self = plugin
    .activeWorkspace()
    ?.workspace.people.find((person) => person.isSelf);

  const reload = async () => {
    const doc = await plugin.mutations.readDocument(task);
    onChanged(doc.comments);
  };

  return (
    <div className="vf-comments">
      {comments.map((comment) => (
        <article key={comment.id} className="vf-comment">
          <header>
            <strong>{comment.author}</strong>
            <span className="vf-comment-date">{comment.date.slice(0, 10)}</span>
            <button
              type="button"
              className="vf-icon-button"
              title="Delete comment"
              onClick={() =>
                void plugin.mutations
                  .deleteComment(task, comment.id)
                  .then(reload)
              }
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
