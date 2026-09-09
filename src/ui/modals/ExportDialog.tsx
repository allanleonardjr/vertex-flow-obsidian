/**
 * The Export dialog — task export (CSV / JSON / iCalendar) and "Export as
 * template", sharing one chrome. Reached from the Sidebar's "Export…" row, the
 * `Export…` command, the view toolbar's contextual shortcut, and the
 * right-click row/card menus on Workspaces, Views and Projects.
 *
 * Follows `LabelDialog`'s portal pattern: `.vf-editor-backdrop` + `.vf-dialog`,
 * `createPortal` to `document.body`, `busy`/`error` state.
 *
 * After a successful export the body swaps to a small result view with a
 * "Reveal in …" / "Open in Obsidian" action instead of a toast — `.csv` /
 * `.json` / `.ics` files are real vault files but stay hidden from Obsidian's
 * own file list unless "Detect all file extensions" is on, so a dialog that
 * can hand the user a way *out* beats a path they can't click.
 */

import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Platform, TFolder, type TFile } from "obsidian";
import { localTodayIso } from "../../core/date";
import {
  buildExport,
  DEFAULT_FIELDS,
  FIELD_GROUPS,
  FIELDS,
  fieldsForFormat,
  ICS_MANDATORY_FIELDS,
  type ExportFormat,
  type ExportScope,
  type FieldId,
} from "../../core/export";
import { isSystemViewId, layoutIcon, snapshotContext } from "../../core/views";
import { queryContext } from "../../core/query";
import { serializeTemplateMarkdown } from "../../core/templates/markdown/serialize";
import { workspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import {
  exportAsTemplate,
  runExport,
  type ExportProgress,
} from "../../obsidian/export";
import { WORKSPACE_TEMPLATES_FOLDER } from "../../obsidian/template-folder";
import { usePlugin } from "../context";
import { useMePersonId } from "../useMe";
import { Icon, IconField } from "../components/Icon";
import { SelectMenu, type SelectRow } from "../components/fields";
import { labelView, personView } from "../App";
import { FolderSuggestModal } from "./FolderSuggestModal";

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "csv", label: "CSV" },
  { id: "json", label: "JSON" },
  { id: "ics", label: "iCalendar" },
];

type ScopeKind = "current" | "view" | "project" | "label" | "person" | "workspace";

type ExportOutcome =
  | { kind: "tasks"; file: TFile; taskCount: number }
  | { kind: "template"; file: TFile };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The read-only scope shown when the dialog is opened locked to a target:
 *  what kind it is + its icon / colour dot / avatar + name, matching how the
 *  same thing reads in the Scope picker and the sidebar. */
function LockedScope({
  scope,
  snapshot,
}: {
  scope: ExportScope;
  snapshot: WorkspaceSnapshot;
}) {
  let kind: string;
  let glyph: ReactNode;
  let name: string;

  if (scope.kind === "workspace") {
    kind = "Workspace";
    glyph = <Icon id={snapshot.workspace.icon} fallback="layers" size={13} />;
    name = snapshot.workspace.name;
  } else if (scope.kind === "project") {
    kind = "Project";
    glyph = <Icon id={scope.project.icon} fallback="folder" size={13} />;
    name = scope.project.title;
  } else if (scope.view.id.startsWith("label:")) {
    const labelId = scope.view.id.slice("label:".length);
    const color = workspaceTaxonomies(snapshot.workspace).label.values.find(
      (v) => v.id === labelId,
    )?.color;
    kind = "Label";
    glyph = (
      <span
        className="vf-status-dot"
        style={{ backgroundColor: color || "var(--vf-muted)" }}
      />
    );
    name = scope.view.name;
  } else if (scope.view.id.startsWith("person:")) {
    kind = "Person";
    glyph = <Icon fallback="user" size={13} />;
    name = scope.view.name;
  } else {
    kind = "View";
    glyph = (
      <Icon
        id={scope.view.icon}
        fallback={layoutIcon(scope.view.viewType)}
        size={13}
      />
    );
    name = scope.view.name;
  }

  return (
    <div className="vf-export-locked-scope">
      <span className="vf-export-locked-scope-kind">{kind}</span>
      {glyph}
      <span className="vf-icon-select-name">{name}</span>
    </div>
  );
}

/** "Show in system explorer" is Obsidian's own file-reveal — a real runtime
 *  method on `App`, but undocumented and untyped in `obsidian.d.ts` (1.13.x),
 *  so it's reached through a feature-detected cast. Absent on mobile. */
function canRevealInFolder(app: {
  showInFolder?: (path: string) => void;
}): boolean {
  return typeof app.showInFolder === "function";
}

const SCOPE_KIND_LABELS: Record<ScopeKind, string> = {
  current: "Current view",
  view: "Views",
  project: "Projects",
  label: "Labels",
  person: "People",
  workspace: "Whole workspace",
};

export function ExportDialog({
  snapshot,
  initialScope,
  allowTemplateExport = false,
  lockScope = false,
  forceMode,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  initialScope: ExportScope;
  /** Only the sidebar / command path passes `true` — the contextual shortcut
   *  has no meaningful whole-workspace template to capture. */
  allowTemplateExport?: boolean;
  /** Right-click row/card menus know exactly what they're exporting. When
   *  true the Scope section renders as static text and `scope` is
   *  `initialScope` directly — the scope state machine is bypassed. */
  lockScope?: boolean;
  /** When set, the dialog opens directly in that mode and hides the mode
   *  toggle — a single-purpose invocation never shows an irrelevant switch. */
  forceMode?: "tasks" | "template";
  onClose: () => void;
}) {
  const plugin = usePlugin();
  const me = useMePersonId(snapshot.workspace.root);

  const [mode, setMode] = useState<"tasks" | "template">(forceMode ?? "tasks");

  // --- task-export state ---
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scopeKind, setScopeKind] = useState<ScopeKind>(
    initialScope.kind === "view" ? "current" : "workspace",
  );
  const [scopeViewId, setScopeViewId] = useState(snapshot.views[0]?.id ?? "");
  const [scopeProjectPath, setScopeProjectPath] = useState(
    snapshot.projects[0]?.path ?? "",
  );
  const orderedLabels = useMemo(
    () =>
      [...workspaceTaxonomies(snapshot.workspace).label.values].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [snapshot],
  );
  const orderedPeople = useMemo(
    () =>
      [...snapshot.workspace.people].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [snapshot],
  );
  const [scopeLabelId, setScopeLabelId] = useState(orderedLabels[0]?.id ?? "");
  const [scopePersonId, setScopePersonId] = useState(
    orderedPeople[0]?.id ?? "",
  );
  const [includeArchived, setIncludeArchived] = useState(false);
  const [fields, setFields] = useState<Set<FieldId>>(
    () => new Set(DEFAULT_FIELDS),
  );

  // --- template-export state ---
  const [tplName, setTplName] = useState(`${snapshot.workspace.name} Template`);
  const [tplDescription, setTplDescription] = useState("");
  const [tplIcon, setTplIcon] = useState<string | undefined>(
    snapshot.workspace.icon,
  );
  // The canonical `Vertex Flow Templates/` folder is the gallery's primary
  // discovery target, so it's the default; picking elsewhere saves fine but
  // hides the template from the New Workspace gallery (surfaced below).
  const [tplLocation, setTplLocation] = useState(WORKSPACE_TEMPLATES_FOLDER);
  // Off by default: a template is a blueprint, and carrying Tasks makes it a
  // snapshot. The `includeArchived` toggle is shared with the Task-export
  // path — it governs archived Projects and Tasks alike here so a full
  // snapshot keeps its cross-links resolvable.
  const [includeTasks, setIncludeTasks] = useState(true);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);

  const context = useMemo(() => snapshotContext(snapshot, me), [snapshot, me]);

  const scope = useMemo<ExportScope>(() => {
    if (lockScope) return initialScope;
    if (scopeKind === "current" && initialScope.kind === "view") {
      return initialScope;
    }
    if (scopeKind === "view") {
      const view = snapshot.views.find((v) => v.id === scopeViewId);
      if (view) return { kind: "view", view };
    }
    if (scopeKind === "project") {
      const project = snapshot.projects.find(
        (p) => p.path === scopeProjectPath,
      );
      if (project) return { kind: "project", project };
    }
    if (scopeKind === "label" && scopeLabelId) {
      return { kind: "view", view: labelView(snapshot, scopeLabelId) };
    }
    if (scopeKind === "person" && scopePersonId) {
      return { kind: "view", view: personView(snapshot, scopePersonId) };
    }
    return { kind: "workspace" };
  }, [
    lockScope,
    initialScope,
    scopeKind,
    snapshot,
    scopeViewId,
    scopeProjectPath,
    scopeLabelId,
    scopePersonId,
  ]);

  const selectedFields = useMemo(
    () => fieldsForFormat(format, [...fields]),
    [format, fields],
  );

  const eligibleFields = useMemo(
    () =>
      FIELD_GROUPS.flatMap((group) => group.fields).filter(
        (id) => format !== "ics" || FIELDS[id].icalEligible,
      ),
    [format],
  );
  // iCalendar's mandatory data is always written, so it counts toward both the
  // selected and the total in the Fields header.
  const mandatoryCount = format === "ics" ? ICS_MANDATORY_FIELDS.length : 0;
  const selectedFieldCount =
    mandatoryCount + eligibleFields.filter((id) => fields.has(id)).length;
  const totalFieldCount = mandatoryCount + eligibleFields.length;
  const allFieldsIncluded = selectedFieldCount === totalFieldCount;
  const fieldsSummary = allFieldsIncluded
    ? "Fields (All included)"
    : `Fields ${selectedFieldCount} of ${totalFieldCount}`;
  const selectedFieldLabels = [
    // iCalendar always writes its mandatory data — surface it in the summary
    // so an .ics export doesn't read as "No fields selected".
    ...(format === "ics" ? ICS_MANDATORY_FIELDS : []),
    ...eligibleFields.filter((id) => fields.has(id)),
  ].map((id) => FIELDS[id].label);

  const preview = useMemo(() => {
    try {
      const { content, taskCount } = buildExport({
        snapshot,
        context,
        scope,
        format,
        fields: [...fields],
        today: localTodayIso(),
        includeArchived,
        pluginVersion: plugin.manifest.version,
      });
      return {
        taskCount,
        label: `${taskCount} task${taskCount === 1 ? "" : "s"} · ${formatBytes(content.length)}`,
      };
    } catch {
      return { taskCount: null as number | null, label: "—" };
    }
  }, [snapshot, context, scope, format, fields, includeArchived, plugin]);

  // Template export carries the whole workspace (a template is a blueprint,
  // not a scoped slice), so this counts what the file would actually ship.
  const templateCarriedTasks = snapshot.tasks.filter(
    (task) => includeArchived || !task.archived,
  ).length;

  // A size estimate for the footer, mirroring the task-export preview. Runs the
  // real serializer but with empty body maps (descriptions/comments need async
  // reads) — so it's a floor, not an exact figure, same as the task preview.
  const templatePreview = useMemo(() => {
    try {
      const content = serializeTemplateMarkdown({
        meta: {
          id: "preview",
          name: tplName.trim() || "template",
          description: tplDescription.trim() || undefined,
          icon: tplIcon,
          createdAt: new Date().toISOString(),
        },
        workspace: snapshot.workspace,
        views: snapshot.views.filter((view) => !isSystemViewId(view.id)),
        dashboards: snapshot.dashboards,
        projects: snapshot.projects,
        projectDescriptions: {},
        tasks: includeTasks ? snapshot.tasks : undefined,
        taskDescriptions: includeTasks ? {} : undefined,
        taskComments: includeTasks ? {} : undefined,
        includeArchived,
        queryContext: queryContext(snapshot, me),
      });
      const taskCount = includeTasks ? templateCarriedTasks : 0;
      return {
        label: `${taskCount} task${taskCount === 1 ? "" : "s"} · ${formatBytes(content.length)}`,
      };
    } catch {
      return { label: "—" };
    }
  }, [
    snapshot,
    me,
    tplName,
    tplDescription,
    tplIcon,
    includeTasks,
    includeArchived,
    templateCarriedTasks,
  ]);

  const folders = useMemo(
    () =>
      plugin.app.vault
        .getAllLoadedFiles()
        .filter((file): file is TFolder => file instanceof TFolder)
        .map((file) => file.path)
        .filter((path) => path !== "/")
        .sort(),
    [plugin],
  );

  const toggleField = (id: FieldId) => {
    setFields((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroup = (groupFields: FieldId[], on: boolean) => {
    setFields((current) => {
      const next = new Set(current);
      for (const id of groupFields) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const runTaskExport = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const { file, taskCount } = await runExport(plugin, {
        snapshot,
        scope,
        format,
        fields: selectedFields,
        includeArchived,
        onProgress: setProgress,
      });
      setBusy(false);
      setOutcome({ kind: "tasks", file, taskCount });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const runTemplateExport = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const file = await exportAsTemplate(plugin, snapshot, {
        name: tplName.trim(),
        description: tplDescription.trim() || undefined,
        icon: tplIcon,
        folder: tplLocation.trim(),
        includeTasks,
        includeArchived,
        onProgress: setProgress,
      });
      setBusy(false);
      setOutcome({ kind: "template", file });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const revealInFolder = (file: TFile) => {
    const app = plugin.app as unknown as {
      showInFolder?: (path: string) => void;
    };
    app.showInFolder?.(file.path);
  };

  const openInObsidian = (file: TFile) => {
    void plugin.app.workspace.getLeaf(true).openFile(file);
  };

  const templateValid = tplName.trim().length > 0;
  const showReveal = canRevealInFolder(
    plugin.app as unknown as { showInFolder?: (path: string) => void },
  );
  const fileManagerLabel = Platform.isMacOS
    ? "Finder"
    : Platform.isWin
      ? "File Explorer"
      : "File Manager";

  return createPortal(
    <div className="vf-editor-backdrop" onClick={onClose}>
      <div
        className="vf-dialog vf-export-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>{mode === "tasks" ? "Export Tasks" : "Export Workspace"}</h3>

        {outcome ? (
          <>
            <div className="vf-dialog-body">
              <p className="vf-export-result">
                {outcome.kind === "tasks"
                  ? `Exported ${outcome.taskCount} task${outcome.taskCount === 1 ? "" : "s"} to ${outcome.file.path}`
                  : `Saved template to ${outcome.file.path}`}
              </p>
              <p className="vf-dialog-hint">
                This file type may not appear in Obsidian's own file list — turn
                on "Show all file types" in Obsidian's Settings:
                <br />
                [Settings → Files and links → Links → Show all file types] to
                see it in Obsidian's File Explorer.
              </p>
              <div className="vf-export-result-actions">
                {showReveal && (
                  <button
                    type="button"
                    onClick={() => revealInFolder(outcome.file)}
                  >
                    Reveal in {fileManagerLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openInObsidian(outcome.file)}
                >
                  Open in Obsidian
                </button>
              </div>
            </div>
            <div className="vf-dialog-actions">
              <button className="mod-cta" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {allowTemplateExport && !forceMode && (
              <div className="vf-segmented" role="group">
                <button
                  type="button"
                  className={`vf-segmented-item${mode === "tasks" ? " is-on" : ""}`}
                  aria-pressed={mode === "tasks"}
                  onClick={() => setMode("tasks")}
                >
                  Export tasks
                </button>
                <button
                  type="button"
                  className={`vf-segmented-item${mode === "template" ? " is-on" : ""}`}
                  aria-pressed={mode === "template"}
                  onClick={() => setMode("template")}
                >
                  Export Workspace as Template…
                </button>
              </div>
            )}

            {mode === "tasks" ? (
              <>
                <div className="vf-export-config">
                  <div className="vf-field">
                    <span>Format</span>
                    <div className="vf-segmented" role="group">
                      {FORMATS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={`vf-segmented-item${format === f.id ? " is-on" : ""}`}
                          aria-pressed={format === f.id}
                          onClick={() => setFormat(f.id)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="vf-field">
                    <span>Scope</span>
                    {lockScope ? (
                      <LockedScope scope={initialScope} snapshot={snapshot} />
                    ) : (
                      <SelectMenu
                        value={scopeKind}
                        onChange={(v) => setScopeKind(v as ScopeKind)}
                        trigger={
                          <span className="vf-icon-select-name">
                            {scopeKind === "current" &&
                            initialScope.kind === "view"
                              ? `Current view (${initialScope.view.name})`
                              : SCOPE_KIND_LABELS[scopeKind]}
                          </span>
                        }
                        rows={[
                          ...(initialScope.kind === "view"
                            ? [
                                {
                                  value: "current",
                                  node: (
                                    <span className="vf-icon-select-name">
                                      Current view ({initialScope.view.name})
                                    </span>
                                  ),
                                  search: initialScope.view.name,
                                } satisfies SelectRow,
                              ]
                            : []),
                          {
                            value: "view",
                            node: (
                              <span className="vf-icon-select-name">Views</span>
                            ),
                            search: "views",
                          },
                          {
                            value: "project",
                            node: (
                              <span className="vf-icon-select-name">
                                Projects
                              </span>
                            ),
                            search: "projects",
                          },
                          {
                            value: "label",
                            node: (
                              <span className="vf-icon-select-name">
                                Labels
                              </span>
                            ),
                            search: "labels",
                          },
                          {
                            value: "person",
                            node: (
                              <span className="vf-icon-select-name">
                                People
                              </span>
                            ),
                            search: "people",
                          },
                          {
                            value: "workspace",
                            node: (
                              <span className="vf-icon-select-name">
                                Whole workspace
                              </span>
                            ),
                            search: "whole workspace",
                          },
                        ]}
                      />
                    )}
                  </div>

                  {!lockScope && scopeKind === "view" && (
                    <div className="vf-field">
                      <span>View</span>
                      <SelectMenu
                        value={scopeViewId}
                        onChange={(v) => v && setScopeViewId(v)}
                        trigger={(() => {
                          const v = snapshot.views.find(
                            (view) => view.id === scopeViewId,
                          );
                          return (
                            <>
                              <Icon
                                id={v?.icon}
                                fallback={layoutIcon(v?.viewType ?? "list")}
                                size={13}
                              />
                              <span className="vf-icon-select-name">
                                {v?.name ?? "Select a view"}
                              </span>
                            </>
                          );
                        })()}
                        rows={snapshot.views.map((v) => ({
                          value: v.id,
                          node: (
                            <>
                              <Icon
                                id={v.icon}
                                fallback={layoutIcon(v.viewType)}
                                size={13}
                              />
                              <span className="vf-icon-select-name">
                                {v.name}
                              </span>
                            </>
                          ),
                          search: v.name,
                        }))}
                      />
                    </div>
                  )}

                  {!lockScope && scopeKind === "project" && (
                    <div className="vf-field">
                      <span>Project</span>
                      <SelectMenu
                        value={scopeProjectPath}
                        onChange={(v) => v && setScopeProjectPath(v)}
                        trigger={(() => {
                          const p = snapshot.projects.find(
                            (project) => project.path === scopeProjectPath,
                          );
                          return (
                            <>
                              <Icon
                                id={p?.icon}
                                fallback="folder"
                                size={13}
                              />
                              <span className="vf-icon-select-name">
                                {p?.title ?? "Select a project"}
                              </span>
                            </>
                          );
                        })()}
                        rows={snapshot.projects.map((p) => ({
                          value: p.path,
                          node: (
                            <>
                              <Icon id={p.icon} fallback="folder" size={13} />
                              <span className="vf-icon-select-name">
                                {p.title}
                              </span>
                            </>
                          ),
                          search: p.title,
                        }))}
                      />
                    </div>
                  )}

                  {!lockScope && scopeKind === "label" && (
                    <div className="vf-field">
                      <span>Label</span>
                      <SelectMenu
                        value={scopeLabelId}
                        onChange={(v) => v && setScopeLabelId(v)}
                        trigger={(() => {
                          const l = orderedLabels.find(
                            (label) => label.id === scopeLabelId,
                          );
                          return (
                            <>
                              <span
                                className="vf-status-dot"
                                style={{
                                  backgroundColor:
                                    l?.color || "var(--vf-muted)",
                                }}
                              />
                              <span className="vf-icon-select-name">
                                {l?.name ?? "Select a label"}
                              </span>
                            </>
                          );
                        })()}
                        rows={orderedLabels.map((l) => ({
                          value: l.id,
                          node: (
                            <>
                              <span
                                className="vf-status-dot"
                                style={{ backgroundColor: l.color || "var(--vf-muted)" }}
                              />
                              <span className="vf-icon-select-name">
                                {l.name}
                              </span>
                            </>
                          ),
                          search: l.name,
                        }))}
                      />
                    </div>
                  )}

                  {!lockScope && scopeKind === "person" && (
                    <div className="vf-field">
                      <span>Person</span>
                      <SelectMenu
                        value={scopePersonId}
                        onChange={(v) => v && setScopePersonId(v)}
                        trigger={(() => {
                          const person = orderedPeople.find(
                            (p) => p.id === scopePersonId,
                          );
                          return (
                            <>
                              <Icon fallback="user" size={13} />
                              <span className="vf-icon-select-name">
                                {person?.name ?? "Select a person"}
                              </span>
                            </>
                          );
                        })()}
                        rows={orderedPeople.map((p) => ({
                          value: p.id,
                          node: (
                            <>
                              <Icon fallback="user" size={13} />
                              <span className="vf-icon-select-name">
                                {p.name}
                              </span>
                            </>
                          ),
                          search: p.name,
                        }))}
                      />
                    </div>
                  )}
                </div>

                <div className="vf-dialog-body">
                  <div className="vf-export-group">
                    <div className="vf-export-group-head">
                      <strong>Options</strong>
                    </div>
                    <button
                      type="button"
                      className="vf-menu-item"
                      role="checkbox"
                      aria-checked={includeArchived}
                      onClick={() => setIncludeArchived(!includeArchived)}
                    >
                      <span className="vf-export-field-check">
                        {includeArchived ? "✓" : ""}
                      </span>
                      Include archived tasks
                    </button>
                  </div>

                  <details className="vf-field vf-export-fields">
                    <summary>
                      <span className="vf-section-chevron" aria-hidden>
                        ›
                      </span>
                      {fieldsSummary}
                    </summary>
                    {FIELD_GROUPS.map((group) => {
                      const groupFields = group.fields.filter(
                        (id) => format !== "ics" || FIELDS[id].icalEligible,
                      );
                      if (groupFields.length === 0) return null;
                      return (
                        <div key={group.id} className="vf-export-group">
                          <div className="vf-export-group-head">
                            <strong>{group.label}</strong>
                            <button
                              type="button"
                              className="vf-bar-item"
                              onClick={() => setGroup(groupFields, true)}
                            >
                              All
                            </button>
                            <button
                              type="button"
                              className="vf-bar-item"
                              onClick={() => setGroup(groupFields, false)}
                            >
                              None
                            </button>
                          </div>
                          {groupFields.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className="vf-menu-item"
                              role="checkbox"
                              aria-checked={fields.has(id)}
                              onClick={() => toggleField(id)}
                            >
                              <span className="vf-export-field-check">
                                {fields.has(id) ? "✓" : ""}
                              </span>
                              {FIELDS[id].label}
                            </button>
                          ))}
                        </div>
                      );
                    })}

                    {format === "ics" && (
                      <div className="vf-export-group">
                        <div className="vf-export-group-head">
                          <strong>Mandatory data</strong>
                        </div>
                        {ICS_MANDATORY_FIELDS.map((id) => (
                          <div
                            key={id}
                            className="vf-menu-item vf-export-field-locked"
                            role="checkbox"
                            aria-checked
                            aria-disabled
                          >
                            <span className="vf-export-field-check">✓</span>
                            {FIELDS[id].label}
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  <p className="vf-export-preview">
                    <strong>
                      This exports{" "}
                      {preview.taskCount == null
                        ? "your tasks"
                        : `${preview.taskCount.toLocaleString()} task${
                            preview.taskCount === 1 ? "" : "s"
                          }`}
                      .
                    </strong>
                    <br />
                    {selectedFieldLabels.length > 0
                      ? `Captures ${selectedFieldLabels.join(", ")}.`
                      : "No fields selected."}
                  </p>

                  {busy && progress && (
                    <p className="vf-export-progress">
                      Exporting {progress.current}/{progress.total}…
                    </p>
                  )}
                  {error && <p className="vf-error">{error}</p>}
                </div>

                <div className="vf-export-footer">
                  <p className="vf-export-preview">{preview.label}</p>
                  <div className="vf-dialog-actions">
                    <button onClick={onClose} disabled={busy}>
                      Cancel
                    </button>
                    <button
                      className="mod-cta"
                      disabled={
                        busy ||
                        (format !== "ics" && selectedFields.length === 0)
                      }
                      onClick={() => void runTaskExport()}
                    >
                      {preview.taskCount == null
                        ? "Export"
                        : `Export ${preview.taskCount} Task${
                            preview.taskCount === 1 ? "" : "s"
                          }`}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="vf-dialog-body">
                  <div className="vf-icon-name-row">
                    <div className="vf-field vf-field-icon">
                      <span>Icon</span>
                      <IconField
                        value={tplIcon}
                        fallback="layers"
                        onChange={setTplIcon}
                      />
                    </div>
                    <label className="vf-field vf-field-name">
                      <span>Name</span>
                      <input
                        type="text"
                        autoFocus
                        value={tplName}
                        onChange={(e) => {
                          setTplName(e.target.value);
                          setError(null);
                        }}
                      />
                    </label>
                  </div>

                  <label className="vf-field">
                    <span>Description</span>
                    <textarea
                      rows={2}
                      value={tplDescription}
                      placeholder="One or two sentences, shown on the gallery card"
                      onChange={(e) => setTplDescription(e.target.value)}
                    />
                  </label>

                  <label className="vf-field">
                    <span>Location</span>
                    <div className="vf-folder-field">
                      <input
                        type="text"
                        list="vf-export-template-folder-options"
                        value={tplLocation}
                        placeholder="Vault root"
                        onChange={(e) => setTplLocation(e.target.value)}
                      />
                      <button
                        type="button"
                        title="Browse for a folder"
                        onClick={() =>
                          new FolderSuggestModal(plugin.app, (chosen) =>
                            setTplLocation(chosen.isRoot() ? "" : chosen.path),
                          ).open()
                        }
                      >
                        Browse…
                      </button>
                    </div>
                    <datalist id="vf-export-template-folder-options">
                      {folders.map((path) => (
                        <option key={path} value={path} />
                      ))}
                    </datalist>
                    {tplLocation.trim() !== WORKSPACE_TEMPLATES_FOLDER && (
                      <small className="vf-field-hint">
                        Templates outside <code>{WORKSPACE_TEMPLATES_FOLDER}/</code>
                        won't show up in the New Workspace gallery.
                      </small>
                    )}
                  </label>

                  <div className="vf-export-group">
                    <div className="vf-export-group-head">
                      <strong>Options</strong>
                    </div>
                    <button
                      type="button"
                      className="vf-menu-item"
                      role="checkbox"
                      aria-checked={includeTasks}
                      onClick={() => setIncludeTasks(!includeTasks)}
                    >
                      <span className="vf-export-field-check">
                        {includeTasks ? "✓" : ""}
                      </span>
                      Include tasks in the template file
                    </button>
                    {includeTasks && (
                      <button
                        type="button"
                        className="vf-menu-item"
                        role="checkbox"
                        aria-checked={includeArchived}
                        onClick={() => setIncludeArchived(!includeArchived)}
                      >
                        <span className="vf-export-field-check">
                          {includeArchived ? "✓" : ""}
                        </span>
                        Include archived projects and tasks
                      </button>
                    )}
                  </div>

                  <p className="vf-export-preview">
                    <strong>
                      {includeTasks
                        ? "This exports your workspace with data."
                        : "This exports your workspace configuration."}
                    </strong>
                    <br />
                    Captures statuses, priorities, task types, labels, the
                    people roster, saved views, dashboards and projects —
                    {includeTasks
                      ? ` plus ${templateCarriedTasks.toLocaleString()} task${
                          templateCarriedTasks === 1 ? "" : "s"
                        } with their descriptions and comments.`
                      : " no tasks."}
                  </p>

                  {busy && progress && (
                    <p className="vf-export-progress">
                      Exporting {progress.current}/{progress.total}…
                    </p>
                  )}
                  {error && <p className="vf-error">{error}</p>}
                </div>

                <div className="vf-export-footer">
                  <p className="vf-export-preview">{templatePreview.label}</p>
                  <div className="vf-dialog-actions">
                    <button onClick={onClose} disabled={busy}>
                      Cancel
                    </button>
                    <button
                      className="mod-cta"
                      disabled={busy || !templateValid}
                      onClick={() => void runTemplateExport()}
                    >
                      {includeTasks
                        ? "Export template with data"
                        : "Export template with no data"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
