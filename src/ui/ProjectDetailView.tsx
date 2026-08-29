/**
 * One project's tab: an in-plugin editor with the same two-column body as the
 * Task editor. A full-height, resizable, collapsible `PropertyRow` rail on the
 * right (shared `EditorRail`); on the left, the project info (title +
 * description) stacked above the project's task viewport.
 *
 * `projectView()` in `App.tsx` builds the filter for that viewport. A Project's
 * editable fields — status, priority, labels, dates, owner, archived, and the
 * description (the note body) — are all edited here rather than in the raw
 * Obsidian note, the same shift Tasks made. "Open note" and the raw-source
 * section keep the escape hatch to the file.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Notice } from "obsidian";
import { projectProgress, projectTasks, scopeOf } from "../core/hierarchy";
import type { ViewContext } from "../core/views";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import type { Project, WorkspaceSnapshot } from "../core/types";
import { withExtension } from "../obsidian/note-io";
import { NEW_PROJECT_TITLE, useCreateTask } from "./actions";
import {
  DateField,
  PersonSelect,
  PrioritySelect,
  PropertyRow,
  StatusSelect,
  useDebouncedSave,
} from "./components/fields";
import { EditorRail } from "./components/EditorRail";
import { Icon, IconField } from "./components/Icon";
import { LabelEditor } from "./components/LabelEditor";
import { MarkdownField } from "./components/Markdown";
import { ProgressBar } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { projectView } from "./App";
import { TaskViewport } from "./views/TaskViewport";

export function ProjectDetailView({
  path,
  snapshot,
  taxonomies,
  context,
  containerRef,
  active,
  onSelectView,
}: {
  path: string;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  context: ViewContext;
  containerRef: HTMLElement | null;
  active: boolean;
  onSelectView: (id: string) => void;
}) {
  const plugin = usePlugin();
  const { closeActive } = useTabs();
  const createTask = useCreateTask();

  const project = snapshot.projects.find((p) => p.path === path) ?? null;

  // Unresolvable (deleted since the last rebuild — App's prune effect normally
  // catches this first). Closing has to happen in an effect, not inline: a
  // state setter fired mid-render is unsafe in React. Same guard as `TaskPane`.
  useEffect(() => {
    if (!project) closeActive();
  }, [project, closeActive]);

  if (!project) return null;

  return (
    <ProjectEditor
      // Remount per project so the description state, the debounced-save buffer
      // and the raw-source view can't leak from one project into the next
      // (same reason `TaskPane` keys `TaskDetailPanel` by path).
      key={project.path}
      project={project}
      snapshot={snapshot}
      taxonomies={taxonomies}
      onNewTask={() => void createTask(snapshot, { project: project.path })}
      onOpenNote={() => {
        plugin.suppressNextRedirect();
        void plugin.mutations.open(project.path);
      }}
      tasks={
        <TaskViewport
          snapshot={snapshot}
          view={projectView(project)}
          taxonomies={taxonomies}
          context={context}
          containerRef={containerRef}
          active={active}
          onSelectView={onSelectView}
          hideViewTitle
        />
      }
    />
  );
}

function ProjectEditor({
  project,
  snapshot,
  taxonomies,
  tasks,
  onNewTask,
  onOpenNote,
}: {
  project: Project;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  /** The project's task viewport, rendered under the project info. */
  tasks: ReactNode;
  onNewTask: () => void;
  onOpenNote: () => void;
}) {
  const plugin = usePlugin();
  const [description, setDescription] = useState<string | null>(null);
  const [descCollapsed, setDescCollapsed] = useState(
    plugin.settings.projectDescriptionCollapsed,
  );
  const [infoHeight, setInfoHeight] = useState(plugin.settings.projectInfoHeight);

  const toggleDescription = () => {
    const next = !descCollapsed;
    setDescCollapsed(next);
    plugin.settings.projectDescriptionCollapsed = next;
    void plugin.saveSettings();
  };

  const scope = scopeOf(snapshot);
  const taskCount = projectTasks(scope, project.path).length;
  // §7.1: progress is computed independently of the project's own status, and
  // never fed back into it.
  const progress = projectProgress(scope, project.path, taxonomies.status);

  const update = (patch: Partial<Project>) =>
    void plugin.mutations.updateProject(project, patch);

  useEffect(() => {
    let cancelled = false;
    void plugin.mutations.readProjectDocument(project).then((doc) => {
      if (!cancelled) setDescription(doc.description);
    });
    return () => {
      cancelled = true;
    };
  }, [plugin, project.path]);

  return (
    <>
      <header className="vf-editor-header vf-project-editor-header">
        <span className="vf-view-title-icon" aria-hidden>
          <Icon id={project.icon} fallback="folder" size={16} />
        </span>
        <ProjectTitleField project={project} />
        <span className="vf-view-title-code">
          ({snapshot.workspace.idPrefix})
        </span>
        <span className="vf-count">
          {taskCount} {taskCount === 1 ? "task" : "tasks"}
        </span>
        {project.archived && <span className="vf-chip">Archived</span>}
        <span className="vf-editor-spacer" />
        <button className="mod-cta" onClick={onNewTask}>
          New task
        </button>
        <button
          type="button"
          className="vf-icon-button"
          title="Open the raw note in Obsidian"
          onClick={onOpenNote}
        >
          ↗
        </button>
      </header>

      <div className="vf-editor-body vf-project-editor">
        <div className="vf-editor-main-col">
          <main
            className={`vf-editor-main vf-project-editor-info${
              descCollapsed ? " is-collapsed" : ""
            }`}
            style={
              descCollapsed
                ? undefined
                : { height: infoHeight, flex: "0 0 auto" }
            }
          >
            <button
              type="button"
              className="vf-rail-section-toggle vf-project-desc-toggle"
              aria-expanded={!descCollapsed}
              onClick={toggleDescription}
            >
              <span
                className={`vf-section-chevron${descCollapsed ? "" : " is-open"}`}
                aria-hidden
              >
                ›
              </span>
              Description
            </button>

            {!descCollapsed &&
              (description === null ? (
                <div className="vf-editor-loading">Loading…</div>
              ) : (
                <ProjectDescriptionField
                  project={project}
                  initial={description}
                />
              ))}
          </main>

          {!descCollapsed && (
            <VerticalResizeHandle
              value={infoHeight}
              onResize={setInfoHeight}
              onResizeEnd={(next) => {
                plugin.settings.projectInfoHeight = next;
                void plugin.saveSettings();
              }}
            />
          )}

          <div className="vf-project-editor-tasks">{tasks}</div>
        </div>

        <EditorRail>
          <PropertyRow label="Icon">
            <IconField
              value={project.icon}
              fallback="folder"
              onChange={(icon) => update({ icon })}
            />
          </PropertyRow>

          <PropertyRow label="Status">
            <StatusSelect
              taxonomy={taxonomies.status}
              value={project.status}
              onChange={(status) => status && update({ status })}
            />
          </PropertyRow>

          <PropertyRow label="Priority">
            <PrioritySelect
              taxonomy={taxonomies.priority}
              value={project.priority}
              onChange={(priority) => update({ priority })}
            />
          </PropertyRow>

          <PropertyRow label="Labels">
            <LabelEditor
              snapshot={snapshot}
              taxonomy={taxonomies.label}
              value={project.labels}
              onChange={(labels) => update({ labels })}
            />
          </PropertyRow>

          <PropertyRow label="Start">
            <DateField
              value={project.startDate}
              onChange={(startDate) => update({ startDate })}
            />
          </PropertyRow>

          <PropertyRow label="Due">
            <DateField
              value={project.dueDate}
              onChange={(dueDate) => update({ dueDate })}
            />
          </PropertyRow>

          <PropertyRow label="Owner">
            <PersonSelect
              people={snapshot.workspace.people}
              value={project.owner}
              onChange={(owner) => update({ owner })}
            />
          </PropertyRow>

          <PropertyRow label="Archived">
            <label className="vf-toggle">
              <input
                type="checkbox"
                checked={project.archived}
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

          <PropertyRow label="Progress">
            {progress.total > 0 ? (
              <ProgressBar progress={progress} />
            ) : (
              <span className="vf-prop-empty">
                {taskCount === 0 ? "No tasks yet" : "—"}
              </span>
            )}
          </PropertyRow>

          <ProjectRawSourceSection project={project} />
        </EditorRail>
      </div>
    </>
  );
}

const INFO_MIN_HEIGHT = 80;
/** Keep at least this much for the task list below the handle. */
const TASKS_MIN_HEIGHT = 120;
const INFO_DEFAULT_HEIGHT = 220;

/**
 * The drag handle between the project info pane and its task list — the
 * horizontal counterpart of `EditorRail`'s width handle.
 */
function VerticalResizeHandle({
  value,
  onResize,
  onResizeEnd,
}: {
  value: number;
  onResize: (height: number) => void;
  onResizeEnd: (height: number) => void;
}) {
  const drag = useRef<{
    startY: number;
    startHeight: number;
    max: number;
  } | null>(null);

  return (
    <div
      className="vf-vertical-resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={value}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const col = event.currentTarget.parentElement;
        const height = col?.clientHeight ?? window.innerHeight;
        drag.current = {
          startY: event.clientY,
          startHeight: value,
          max: Math.max(INFO_MIN_HEIGHT, height - TASKS_MIN_HEIGHT),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const delta = event.clientY - drag.current.startY;
        const next = Math.min(
          drag.current.max,
          Math.max(INFO_MIN_HEIGHT, drag.current.startHeight + delta),
        );
        onResize(next);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onResizeEnd(value);
      }}
      onDoubleClick={() => {
        onResize(INFO_DEFAULT_HEIGHT);
        onResizeEnd(INFO_DEFAULT_HEIGHT);
      }}
      title="Drag to resize — double-click to reset"
    />
  );
}

/**
 * A read-only look at the project note exactly as it sits on disk — frontmatter
 * and body. Collapsed by default; the open state is remembered (shared with the
 * Task editor's Source section). Re-reads whenever the project changes while
 * open, so it tracks edits made above.
 */
function ProjectRawSourceSection({ project }: { project: Project }) {
  const plugin = usePlugin();
  const [open, setOpen] = useState(plugin.settings.editorSourceOpen);
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setRaw(null);
    void plugin.mutations.readProjectRaw(project).then((text) => {
      if (live) setRaw(text);
    });
    return () => {
      live = false;
    };
  }, [open, plugin, project.path, project.updatedAt]);

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

/**
 * The project's name — rendered inline in the header next to the icon and ID
 * prefix, matching the `All Tasks (PREFIX)` title of a Saved View. A rename to a
 * title another project in the workspace already uses is rejected by
 * `updateProject`; the field surfaces that and reverts rather than leaving a
 * duplicate name showing.
 */
function ProjectTitleField({ project }: { project: Project }) {
  const plugin = usePlugin();
  const [title, setTitle, flush] = useDebouncedSave(project.title, (value) => {
    void plugin.mutations
      .updateProject(project, { title: value.trim() || NEW_PROJECT_TITLE })
      .catch((cause) => {
        new Notice(cause instanceof Error ? cause.message : String(cause));
        setTitle(project.title);
      });
  });

  const isPlaceholder = project.title === NEW_PROJECT_TITLE;
  const focusRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && isPlaceholder) {
        element.focus();
        element.select();
      }
    },
    [isPlaceholder],
  );

  return (
    <input
      ref={focusRef}
      type="text"
      className="vf-project-title-input"
      // Size to the title so the ID prefix and task count sit right beside it,
      // the way a Saved View's title does. Clamped so neither a one-word
      // project nor a very long name distorts the header.
      size={Math.max(6, Math.min(title.length + 1, 48))}
      value={title}
      placeholder="Project title"
      onChange={(event) => setTitle(event.target.value)}
      onBlur={flush}
    />
  );
}

function ProjectDescriptionField({
  project,
  initial,
}: {
  project: Project;
  initial: string;
}) {
  const plugin = usePlugin();
  const [text, setText] = useDebouncedSave(initial, (value) => {
    void plugin.mutations.setProjectDescription(project, value);
  });

  return (
    <MarkdownField
      className="vf-editor-description"
      value={text}
      onChange={setText}
      sourcePath={withExtension(project.path)}
      placeholder="Add a description… start typing Markdown — [[wikilinks]], #tags, and ![[embeds]] all work, with live preview and link suggestions as you go"
    />
  );
}
