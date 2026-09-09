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

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Platform, TFolder, type TFile } from "obsidian";
import { localTodayIso } from "../../core/date";
import {
  buildExport,
  DEFAULT_FIELDS,
  FIELD_GROUPS,
  FIELDS,
  fieldsForFormat,
  type ExportFormat,
  type ExportScope,
  type FieldId,
} from "../../core/export";
import { snapshotContext } from "../../core/views";
import type { WorkspaceSnapshot } from "../../core/types";
import {
  exportAsTemplate,
  runExport,
  type ExportProgress,
} from "../../obsidian/export";
import { usePlugin } from "../context";
import { useMePersonId } from "../useMe";
import { IconField } from "../components/Icon";
import { FolderSuggestModal } from "./FolderSuggestModal";

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "csv", label: "CSV" },
  { id: "json", label: "JSON" },
  { id: "ics", label: "iCalendar" },
];

type ScopeKind = "current" | "view" | "project" | "workspace";

type ExportOutcome =
  | { kind: "tasks"; file: TFile; taskCount: number }
  | { kind: "template"; file: TFile };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function scopeDisplay(scope: ExportScope): string {
  switch (scope.kind) {
    case "view":
      return scope.view.name;
    case "project":
      return scope.project.title;
    case "workspace":
      return "the whole workspace";
  }
}

/** "Show in system explorer" is Obsidian's own file-reveal — a real runtime
 *  method on `App`, but undocumented and untyped in `obsidian.d.ts` (1.13.x),
 *  so it's reached through a feature-detected cast. Absent on mobile. */
function canRevealInFolder(app: {
  showInFolder?: (path: string) => void;
}): boolean {
  return typeof app.showInFolder === "function";
}

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
  const [includeArchived, setIncludeArchived] = useState(false);
  const [fields, setFields] = useState<Set<FieldId>>(
    () => new Set(DEFAULT_FIELDS),
  );

  // --- template-export state ---
  const [tplName, setTplName] = useState(`${snapshot.workspace.name} template`);
  const [tplDescription, setTplDescription] = useState("");
  const [tplIcon, setTplIcon] = useState<string | undefined>(
    snapshot.workspace.icon,
  );
  // The canonical `Templates/` folder is the gallery's only discovery target,
  // so it's the default; picking elsewhere saves fine but hides the template
  // from the New Workspace gallery (surfaced in the UI below).
  const [tplLocation, setTplLocation] = useState("Templates");

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
    return { kind: "workspace" };
  }, [
    lockScope,
    initialScope,
    scopeKind,
    snapshot,
    scopeViewId,
    scopeProjectPath,
  ]);

  const selectedFields = useMemo(
    () => fieldsForFormat(format, [...fields]),
    [format, fields],
  );

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
      return `${taskCount} task${taskCount === 1 ? "" : "s"} · ${formatBytes(content.length)}`;
    } catch {
      return "—";
    }
  }, [snapshot, context, scope, format, fields, includeArchived, plugin]);

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
    try {
      const file = await exportAsTemplate(plugin, snapshot, {
        name: tplName.trim(),
        description: tplDescription.trim() || undefined,
        icon: tplIcon,
        folder: tplLocation.trim(),
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
        <h3>Export</h3>

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
              <div className="vf-export-modes" role="tablist">
                <button
                  type="button"
                  className={`vf-bar-item${mode === "tasks" ? " is-on" : ""}`}
                  onClick={() => setMode("tasks")}
                >
                  Export tasks
                </button>
                <button
                  type="button"
                  className={`vf-bar-item${mode === "template" ? " is-on" : ""}`}
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
                    <div className="vf-export-segmented">
                      {FORMATS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={`vf-bar-item${format === f.id ? " is-on" : ""}`}
                          onClick={() => setFormat(f.id)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="vf-field">
                    <span>Scope</span>
                    {lockScope ? (
                      <div className="vf-export-locked-scope">
                        Exporting: {scopeDisplay(initialScope)}
                      </div>
                    ) : (
                      <select
                        value={scopeKind}
                        onChange={(e) =>
                          setScopeKind(e.target.value as ScopeKind)
                        }
                      >
                        {initialScope.kind === "view" && (
                          <option value="current">
                            Current view ({initialScope.view.name})
                          </option>
                        )}
                        <option value="view">Saved view…</option>
                        <option value="project">Project…</option>
                        <option value="workspace">Whole workspace</option>
                      </select>
                    )}
                  </label>

                  {!lockScope && scopeKind === "view" && (
                    <label className="vf-field">
                      <span>View</span>
                      <select
                        value={scopeViewId}
                        onChange={(e) => setScopeViewId(e.target.value)}
                      >
                        {snapshot.views.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {!lockScope && scopeKind === "project" && (
                    <label className="vf-field">
                      <span>Project</span>
                      <select
                        value={scopeProjectPath}
                        onChange={(e) => setScopeProjectPath(e.target.value)}
                      >
                        {snapshot.projects.map((p) => (
                          <option key={p.path} value={p.path}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </label>
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

                  <div className="vf-field">
                    <span>Fields</span>
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
                  </div>

                  {busy && progress && (
                    <p className="vf-export-progress">
                      Exporting {progress.current}/{progress.total}…
                    </p>
                  )}
                  {error && <p className="vf-error">{error}</p>}
                </div>

                <div className="vf-export-footer">
                  <p className="vf-export-preview">{preview}</p>
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
                      Export
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
                    {tplLocation.trim() !== "Templates" && (
                      <small className="vf-field-hint">
                        Templates outside <code>Templates/</code> won't show up
                        in the New Workspace gallery.
                      </small>
                    )}
                  </label>

                  <p className="vf-export-preview">
                    <strong>This exports your workspace configuration.</strong>
                    <br />
                    Captures statuses, priorities, task types, labels, the
                    people roster, saved views and dashboards — no tasks or
                    projects.
                  </p>

                  {error && <p className="vf-error">{error}</p>}
                </div>

                <div className="vf-dialog-actions">
                  <button onClick={onClose} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    className="mod-cta"
                    disabled={busy || !templateValid}
                    onClick={() => void runTemplateExport()}
                  >
                    Save template
                  </button>
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
