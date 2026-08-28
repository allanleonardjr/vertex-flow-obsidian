/**
 * The task detail panel — a Linear-style editor for one task.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  OptionSelect,
  PersonSelect,
  PropertyRow,
  TaxonomySelect,
  useDebouncedSave,
  type Option,
} from "./components/fields";
import { MarkdownContent, MarkdownField } from "./components/Markdown";
import { ProgressBar, StatusDot } from "./components/TaskBits";
import { EmbeddedTaskList } from "./components/EmbeddedTaskList";
import { LabelEditor } from "./components/LabelEditor";
import { RelationsEditor } from "./components/RelationsEditor";
import { usePlugin } from "./context";
import { FEATURES } from "./features";

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
  const [railWidth, setRailWidth] = useState(plugin.settings.editorRailWidth);

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

        <RailResizeHandle
          width={railWidth}
          onResize={setRailWidth}
          onResizeEnd={(width) => {
            plugin.settings.editorRailWidth = width;
            void plugin.saveSettings();
          }}
        />

        <aside className="vf-editor-rail" style={{ width: railWidth }}>
          <PropertyRow label="Status">
            <TaxonomySelect
              taxonomy={taxonomies.status}
              value={task.status}
              allowNone={false}
              onChange={(value) => value && update({ status: value })}
            />
          </PropertyRow>

          <PropertyRow label="Priority">
            <TaxonomySelect
              taxonomy={taxonomies.priority}
              value={task.priority}
              allowNone
              onChange={(priority) => update({ priority })}
            />
          </PropertyRow>

          <PropertyRow label="Type">
            <TaxonomySelect
              taxonomy={taxonomies.taskType}
              value={task.taskType}
              allowNone
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

          <ParentPicker task={task} snapshot={snapshot} onChange={update} />

          {FEATURES.cycles && snapshot.workspace.cycles.enabled && (
            <PropertyRow label={snapshot.workspace.cycles.termLabel}>
              <OptionSelect
                noneLabel={`No ${snapshot.workspace.cycles.termLabel.toLowerCase()}`}
                value={task.cycle}
                options={snapshot.cycles.map((cycle) => ({
                  value: cycle.path,
                  label: cycle.title,
                }))}
                onChange={(cycle) => update({ cycle })}
              />
            </PropertyRow>
          )}

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
        </aside>
      </div>
    </>
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

const RAIL_MIN_WIDTH = 200;
const RAIL_MAX_WIDTH = 520;

function RailResizeHandle({
  width,
  onResize,
  onResizeEnd,
}: {
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  return (
    <div
      className="vf-editor-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { startX: event.clientX, startWidth: width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const delta = event.clientX - drag.current.startX;
        const next = Math.min(
          RAIL_MAX_WIDTH,
          Math.max(RAIL_MIN_WIDTH, drag.current.startWidth - delta),
        );
        onResize(next);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onResizeEnd(width);
      }}
      onDoubleClick={() => onResizeEnd(264)}
      title="Drag to resize — double-click to reset"
    />
  );
}

function ParentPicker({
  task,
  snapshot,
  onChange,
}: {
  task: Task;
  snapshot: WorkspaceSnapshot;
  onChange: (patch: Partial<Task>) => void;
}) {
  const value = task.parent
    ? `task:${task.parent}`
    : task.project
      ? `project:${task.project}`
      : task.initiative
        ? `initiative:${task.initiative}`
        : null;

  const options: Option[] = [
    ...snapshot.projects.map((project) => ({
      value: `project:${project.path}`,
      label: `Project · ${project.title}`,
    })),
    // Initiatives are hidden in v1 (see features.ts). Any initiative the task
    // is *already* attached to is still listed so it renders with a real label
    // and can be cleared — new attachments just aren't offered.
    ...snapshot.initiatives
      .filter((initiative) => FEATURES.initiatives || initiative.path === task.initiative)
      .map((initiative) => ({
        value: `initiative:${initiative.path}`,
        label: `Initiative · ${initiative.title}`,
      })),
    ...snapshot.tasks
      .filter(
        (candidate) =>
          candidate.path !== task.path &&
          !descendantTasks(scopeOf(snapshot), task.path).some(
            (descendant) => descendant.path === candidate.path,
          ),
      )
      .map((candidate) => ({
        value: `task:${candidate.path}`,
        label: `Sub-task of · ${candidate.id} ${candidate.title}`,
      })),
  ];

  return (
    <PropertyRow label="Parent">
      <OptionSelect
        noneLabel="No parent"
        value={value}
        options={options}
        onChange={(next) => {
          if (!next) {
            onChange({ parent: null, project: null, initiative: null });
            return;
          }
          const [kind, ...rest] = next.split(":");
          const path = rest.join(":");
          onChange({
            parent: kind === "task" ? path : null,
            project: kind === "project" ? path : null,
            initiative: kind === "initiative" ? path : null,
          });
        }}
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
