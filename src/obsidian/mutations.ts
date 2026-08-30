/**
 * Every write the plugin performs.
 *
 * The pattern throughout: **core decides, this layer applies.** A drag computes
 * its new rank in `src/core/ranking`; a deletion computes its plan in
 * `src/core/hierarchy`. Nothing here re-derives domain rules — it turns a plan
 * into vault operations and nothing more.
 */

import { App, Notice, TFile } from "obsidian";
import { disambiguatePrefix, nextTaskId, suggestPrefix } from "../core/ids";
import { formatLink, joinPath, sanitizeFileName } from "../core/links";
import { planReorder, rankForNewTask } from "../core/ranking";
import { instantiateTemplate, type WorkspaceTemplate } from "../core/templates";
import {
  nextCommentId,
  parseComments,
  withComments,
} from "../core/serialization/comments";
import {
  parseDescription,
  serializeDescription,
} from "../core/serialization/description";
import {
  extractProjectDescription,
  isProjectTitleTaken,
  nextAvailableProjectTitle,
  projectDuplicatePatch,
  serializeProject,
  withProjectDescription,
} from "../core/serialization/entities";
import { serializeTask } from "../core/serialization/task";
import { serializeView } from "../core/serialization/views";
import { serializeDashboard } from "../core/serialization/dashboards";
import { duplicateWidget as cloneWidget } from "../core/dashboards";
import { serializeWorkspace } from "../core/serialization/workspace";
import {
  addValue,
  applyTaxonomyDeletion,
  findValueByName,
  reassignValue,
  reassignValues,
  updateValue,
  workspaceTaxonomies,
  type Taxonomy,
  type TaxonomyDeletionPlan,
} from "../core/taxonomy";
import { withTaxonomy } from "../core/taxonomy";
import { TAXONOMY_PALETTE } from "../core/taxonomy/defaults";
import {
  emptyRelations,
  type Comment,
  type DashboardConfig,
  type DashboardWidget,
  type EntityKind,
  type Project,
  type ProjectDocument,
  type SavedView,
  type Task,
  type TrashedItem,
  type WorkspaceConfig,
  type WorkspaceSnapshot,
} from "../core/types";
import {
  applyDeletion,
  danglingProjectEdits,
  danglingRelationEdits,
  danglingRelationEditsForWorkspaceDeletion,
  newTaskProject,
  scopeOf,
  type DeletionChoice,
  type DeletionOutcome,
  type DeletionPlan,
} from "../core/hierarchy";
import { FOLDERS, VaultIndex, WORKSPACE_NOTE } from "./index-store";
import { NoteIO, withExtension, withoutExtension } from "./note-io";
import { liveFolder, trashFolder } from "./trash-paths";

export interface NewTaskInput {
  title: string;
  status?: string;
  priority?: string | null;
  taskType?: string | null;
  assignee?: string | null;
  project?: string | null;
  parent?: string | null;
  labels?: string[];
  estimate?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  description?: string;
}

export class Mutations {
  constructor(
    private readonly app: App,
    private readonly io: NoteIO,
    private readonly index: VaultIndex,
  ) {}

  // -- Tasks ----------------------------------------------------------------

  async createTask(
    snapshot: WorkspaceSnapshot,
    input: NewTaskInput,
  ): Promise<TFile> {
    const workspace = snapshot.workspace;
    const id = nextTaskId(
      workspace.idPrefix,
      snapshot.tasks.map((task) => task.id),
    );
    const path = joinPath(workspace.root, FOLDERS.tasks, id);
    const now = new Date().toISOString();

    // New tasks land at the top of whatever they're joining, so the person
    // who just created one can actually see it.
    const parentTask = input.parent
      ? (snapshot.tasks.find((task) => task.path === input.parent) ?? null)
      : null;
    const siblings = input.parent
      ? snapshot.tasks.filter((task) => task.parent === input.parent)
      : snapshot.tasks;

    // `parent` and `project` are independent. A sub-task defaults to its
    // parent's project *once*, at creation — from then on it's an ordinary
    // field that never re-syncs (like Linear). An explicit `project` in the
    // input (including `null`) always wins over that default.
    const project = newTaskProject(input.project, parentTask);

    const task: Task = {
      type: "task",
      id,
      title: input.title.trim() || id,
      taskType: input.taskType ?? null,
      status: input.status ?? workspace.defaultNewTaskStatus,
      priority: input.priority ?? null,
      rank: rankForNewTask(siblings),
      project,
      parent: input.parent ?? null,
      assignee: input.assignee ?? null,
      estimate: input.estimate ?? null,
      labels: input.labels ?? [],
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      archived: false,
      archivedAt: null,
      relations: emptyRelations(),
      createdAt: now,
      updatedAt: now,
      path,
      mentions: [],
    };

    const body = serializeDescription(input.description);

    const file = await this.io.create(path, serializeTask(task), body);
    await this.index.rebuild();
    return file;
  }

  /**
   * Patch a task's frontmatter. `updatedAt` is stamped here rather than by
   * each caller, so no code path can forget it.
   */
  async updateTask(task: Task, patch: Partial<Task>): Promise<void> {
    const file = this.requireFile(task.path);
    const merged: Task = {
      ...task,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.io.replaceFrontmatter(file, serializeTask(merged));
  }

  async setStatus(task: Task, status: string): Promise<void> {
    await this.updateTask(task, { status });
  }

  async setPriority(task: Task, priority: string | null): Promise<void> {
    await this.updateTask(task, { priority });
  }

  async setAssignee(task: Task, assignee: string | null): Promise<void> {
    await this.updateTask(task, { assignee });
  }

  async setLabels(task: Task, labels: string[]): Promise<void> {
    await this.updateTask(task, { labels });
  }

  /**
   * The task's parent *task* — its one true nesting position (Golden Rule).
   * Independent of `project`: setting or clearing a parent never touches the
   * task's `project` link, and moving a parent to a different project never
   * cascades to its existing sub-tasks (like Linear).
   */
  async setParent(task: Task, parent: string | null): Promise<void> {
    await this.updateTask(task, { parent });
  }

  /**
   * The task's Project — an orthogonal association, not a parent. A task may
   * carry both a `parent` task and a `project` at once.
   */
  async setProject(task: Task, project: string | null): Promise<void> {
    await this.updateTask(task, { project });
  }

  /**
   * Archiving is a visibility flag, not a location — the note never
   * moves folders, which is what keeps wikilinks stable.
   */
  async setArchived(task: Task, archived: boolean): Promise<void> {
    await this.updateTask(task, {
      archived,
      archivedAt: archived ? new Date().toISOString() : null,
    });
  }

  /**
   * Apply a drag. `siblings` is the destination column verbatim; the ranking
   * engine handles whether this is a reorder or a cross-column move.
   */
  async moveTask(
    task: Task,
    siblings: Task[],
    toIndex: number,
    fieldEdit?: Partial<Task>,
  ): Promise<void> {
    const assignment = planReorder(task, siblings, toIndex);
    await this.updateTask(task, { rank: assignment.rank, ...fieldEdit });
  }

  /** Bulk edit across a multi-selection. */
  async bulkUpdate(tasks: Task[], patch: Partial<Task>): Promise<void> {
    for (const task of tasks) {
      await this.updateTask(task, patch);
    }
    new Notice(`Updated ${tasks.length} task${tasks.length === 1 ? "" : "s"}`);
  }

  // -- Note body ------------------------------------------------------------

  /** The task note's full text — frontmatter and body, exactly as on disk. */
  async readRaw(task: Task): Promise<string> {
    const file = this.io.getFile(task.path);
    return file ? this.io.read(file) : "";
  }

  /**
   * The parts of a task that live in the body rather than in frontmatter.
   * Read on demand — the index deliberately doesn't hold these, so opening a
   * board never costs a file read per card.
   */
  async readDocument(
    task: Task,
  ): Promise<{ description: string; comments: Comment[] }> {
    const file = this.io.getFile(task.path);
    if (!file) return { description: "", comments: [] };
    const body = await this.io.readBody(file);
    return {
      description: parseDescription(body),
      comments: parseComments(body),
    };
  }

  /**
   * Write the description into the note's `## Description` section, cleanly preserving
   * comments and other user sections.
   */
  async setDescription(task: Task, text: string): Promise<void> {
    const file = this.requireFile(task.path);
    await this.io.processBody(file, (existingBody) => {
      const descBlock = serializeDescription(text);
      // Ensure we target just the exact XML-fenced block
      const blockRegex =
        /<!-- PLUGIN_DESCRIPTION_START -->[\s\S]*?<!-- PLUGIN_DESCRIPTION_END -->/;

      if (blockRegex.test(existingBody)) {
        return existingBody.replace(blockRegex, descBlock).trim();
      } else {
        // If it doesn't exist yet, seamlessly insert it above everything else
        return [descBlock, existingBody].filter(Boolean).join("\n\n").trim();
      }
    });
    // Stamp `updatedAt`; the body write doesn't touch frontmatter.
    await this.updateTask(task, {});
  }

  // -- Comments -------------------------------------------------------------

  async addComment(task: Task, author: string, body: string): Promise<void> {
    const file = this.requireFile(task.path);
    await this.io.processBody(file, (content) => {
      const comments = parseComments(content);
      const comment: Comment = {
        id: nextCommentId(comments),
        author,
        date: new Date().toISOString(),
        body: body.trim(),
        reactions: {},
      };
      return withComments(content, [...comments, comment]);
    });
    await this.updateTask(task, {});
  }

  async deleteComment(task: Task, commentId: string): Promise<void> {
    const file = this.requireFile(task.path);
    await this.io.processBody(file, (content) =>
      withComments(
        content,
        parseComments(content).filter((comment) => comment.id !== commentId),
      ),
    );
  }

  async toggleReaction(
    task: Task,
    commentId: string,
    emoji: string,
  ): Promise<void> {
    const file = this.requireFile(task.path);
    await this.io.processBody(file, (content) => {
      const comments = parseComments(content).map((comment) => {
        if (comment.id !== commentId) return comment;
        const reactions = { ...comment.reactions };
        // No per-user reaction tracking in v1 — there's no auth, so a
        // reaction is just a counter anyone can bump.
        reactions[emoji] = (reactions[emoji] ?? 0) + 1;
        return { ...comment, reactions };
      });
      return withComments(content, comments);
    });
  }

  // -- Trash --------------------------------------------------------------

  /**
   * Move a file into `Workspace/Trash/<Kind>/`, mirroring its live folder, and
   * stamp `vf-trashedAt`. Uses `io.rename` (fileManager.renameFile), not
   * `io.trash` — this is Vertex Flow's own trash, not Obsidian's, so it never
   * depends on the user's "Deleted files" preference, and a rename (rather than
   * a raw move) keeps every wikilink pointing at this file resolving into Trash
   * instead of breaking.
   */
  private async moveToTrash(
    snapshot: WorkspaceSnapshot,
    file: TFile,
    kind: EntityKind,
  ): Promise<void> {
    const folder = trashFolder(snapshot.workspace.root, kind);
    await this.io.ensureFolder(folder);
    const target = this.io.availablePath(joinPath(folder, file.basename));
    await this.io.updateFrontmatter(file, (frontmatter) => {
      frontmatter["vf-trashedAt"] = new Date().toISOString();
    });
    await this.io.rename(file, withExtension(target));
  }

  /**
   * The reverse of `moveToTrash` — back to the live folder, clearing the stamp.
   * `availablePath` handles the one real collision risk: a Project created with
   * the same title while the old one sat in Trash. The restored file's `title:`
   * frontmatter is untouched, so it still displays correctly even if its
   * filename picked up a numeric suffix.
   */
  private async restoreFromTrash(
    snapshot: WorkspaceSnapshot,
    file: TFile,
    kind: EntityKind,
  ): Promise<void> {
    const folder = liveFolder(snapshot.workspace.root, kind);
    await this.io.ensureFolder(folder);
    const target = this.io.availablePath(joinPath(folder, file.basename));
    await this.io.updateFrontmatter(file, (frontmatter) => {
      delete frontmatter["vf-trashedAt"];
    });
    await this.io.rename(file, withExtension(target));
  }

  /** Restore one trashed item to its live folder. */
  async restoreItem(
    snapshot: WorkspaceSnapshot,
    item: TrashedItem,
  ): Promise<void> {
    const file = this.io.getFile(item.entity.path);
    if (file) await this.restoreFromTrash(snapshot, file, item.kind);
    await this.index.rebuild();
  }

  /**
   * Permanently remove a trashed item. Reuses `io.trash()` — the same call
   * every other delete in the codebase uses — rather than a Vertex-Flow
   * override: once a human has confirmed "Delete Forever" there's no
   * cross-machine recoverable state left to keep consistent, and both of
   * `trashFile()`'s destinations are hidden folders the Vault API never
   * surfaces through `getMarkdownFiles()`.
   */
  async permanentlyDeleteItem(item: TrashedItem): Promise<void> {
    const file = this.io.getFile(item.entity.path);
    if (file) await this.io.trash(file);
    await this.index.rebuild();
  }

  // -- Deletion ------------------------------------------------------

  /**
   * Apply one confirmed deletion dialog. Returns any follow-up plans, each of
   * which the caller must present as its own dialog — this method deliberately
   * will not run them itself.
   */
  async applyDeletionPlan(
    snapshot: WorkspaceSnapshot,
    plan: DeletionPlan,
    choice: DeletionChoice,
  ): Promise<DeletionPlan[]> {
    const scope = scopeOf(snapshot);
    const outcome: DeletionOutcome = applyDeletion(scope, plan, choice);
    if (choice === "cancel") return [];

    // Unparent first: if a later delete fails, children are already safe.
    for (const edit of outcome.edits) {
      const file = this.io.getFile(edit.path);
      if (!file) continue;
      await this.io.updateFrontmatter(file, (frontmatter) => {
        delete frontmatter[edit.field];
      });
    }

    // Relations aren't hierarchy, so they're tidied silently rather than
    // prompted about.
    await this.applyRelationEdits(
      danglingRelationEdits(scope, outcome.deletePaths),
    );

    // Likewise the denormalized `project` link on any deep sub-task that the
    // cascade didn't touch — same "silent cleanup after the dialog, not part
    // of it" treatment, since a metadata link isn't hierarchy either.
    for (const edit of danglingProjectEdits(scope, outcome.deletePaths)) {
      const file = this.io.getFile(edit.path);
      if (!file) continue;
      await this.io.updateFrontmatter(file, (frontmatter) => {
        delete frontmatter[edit.field];
      });
    }

    // The file(s) go into this workspace's own `Trash/` folder, not Obsidian's
    // trash. `plan.path` keeps the plan's kind (task or project); every other
    // entry in `deletePaths` is a cascaded child task.
    for (const path of outcome.deletePaths) {
      const file = this.io.getFile(path);
      if (!file) continue;
      const kind: EntityKind = path === plan.path ? plan.kind : "task";
      await this.moveToTrash(snapshot, file, kind);
    }

    await this.index.rebuild();
    return outcome.followUps;
  }

  /**
   * Rewrite the `relations` frontmatter of each task named in `edits` — the
   * silent cleanup, shared by single-entity deletion and whole-workspace
   * deletion so the link-formatting only lives in one place.
   */
  private async applyRelationEdits(
    edits: { path: string; relations: Task["relations"] }[],
  ): Promise<void> {
    for (const edit of edits) {
      const file = this.io.getFile(edit.path);
      if (!file) continue;
      await this.io.updateFrontmatter(file, (frontmatter) => {
        frontmatter.relations = {
          blocks: edit.relations.blocks.map((p) => formatLink(p)),
          blockedBy: edit.relations.blockedBy.map((p) => formatLink(p)),
          related: edit.relations.related.map((p) => formatLink(p)),
          duplicateOf: formatLink(edit.relations.duplicateOf),
        };
      });
    }
  }

  // -- Taxonomy ------------------------------------------------------

  /**
   * Delete a taxonomy value, reassigning everything that used it. The guard
   * itself lives in core; this just applies the outcome across the vault.
   */
  async applyTaxonomyDeletionPlan(
    snapshot: WorkspaceSnapshot,
    taxonomy: Taxonomy,
    plan: TaxonomyDeletionPlan,
    replacementId: string | null,
  ): Promise<void> {
    const result = applyTaxonomyDeletion(taxonomy, plan, replacementId);
    const kind = taxonomy.schema.kind;
    const to = result.replacementId;

    if (result.removeFromAll) {
      // Multi-select only (labels): just strip the value everywhere.
      for (const task of snapshot.tasks) {
        if (!task.labels.includes(plan.valueId)) continue;
        await this.updateTask(task, {
          labels: task.labels.filter((id) => id !== plan.valueId),
        });
      }
    } else if (to) {
      for (const task of snapshot.tasks) {
        if (kind === "label") {
          const labels = reassignValues(task.labels, plan.valueId, to);
          if (labels !== task.labels) await this.updateTask(task, { labels });
          continue;
        }

        const current = task[kind] as string | null;
        const next = reassignValue(current, plan.valueId, to);
        if (next !== current) {
          await this.updateTask(task, { [kind]: next } as Partial<Task>);
        }
      }

      // Projects share the status taxonomy.
      if (kind === "status") {
        for (const entity of snapshot.projects) {
          if (entity.status !== plan.valueId) continue;
          const file = this.io.getFile(entity.path);
          if (!file) continue;
          await this.io.updateFrontmatter(file, (frontmatter) => {
            frontmatter.status = to;
          });
        }
      }
    }

    await this.saveWorkspaceConfig(
      withTaxonomy(snapshot.workspace, result.taxonomy),
    );
  }

  // -- Labels — fluid: created and edited outside Settings ----------

  /** First palette colour not already used by a label, cycling if all are. */
  private nextLabelColor(snapshot: WorkspaceSnapshot): string {
    const used = new Set(snapshot.workspace.labels.map((l) => l.color));
    return (
      TAXONOMY_PALETTE.find((c) => !used.has(c)) ??
      TAXONOMY_PALETTE[
        snapshot.workspace.labels.length % TAXONOMY_PALETTE.length
      ]
    );
  }

  /**
   * Attach-or-create by name: returns the id of the matching label (any case)
   * or a freshly created one. The "no two labels alike" rule lives in
   * `addValue`; this makes typing a dup a no-op rather than an error.
   */
  async addLabel(snapshot: WorkspaceSnapshot, name: string): Promise<string> {
    const labels = workspaceTaxonomies(snapshot.workspace).label;
    const existing = findValueByName(labels, name);
    if (existing) return existing.id;

    const next = addValue(labels, {
      name: name.trim(),
      color: this.nextLabelColor(snapshot),
    });
    const created = next.values[next.values.length - 1];
    await this.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, next));
    return created.id;
  }

  async createLabel(
    snapshot: WorkspaceSnapshot,
    name: string,
    color: string,
    description?: string,
  ): Promise<string> {
    const labels = workspaceTaxonomies(snapshot.workspace).label;
    const next = addValue(labels, { name: name.trim(), color, description });
    const created = next.values[next.values.length - 1];
    await this.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, next));
    return created.id;
  }

  async updateLabel(
    snapshot: WorkspaceSnapshot,
    id: string,
    patch: { name?: string; color?: string; description?: string },
  ): Promise<void> {
    const labels = workspaceTaxonomies(snapshot.workspace).label;
    const next = updateValue(labels, id, patch);
    await this.saveWorkspaceConfig(withTaxonomy(snapshot.workspace, next));
  }

  // -- Config notes ---------------------------------------------------------

  async saveWorkspaceConfig(workspace: WorkspaceConfig): Promise<void> {
    const path = joinPath(workspace.root, WORKSPACE_NOTE);
    const file = this.io.getFile(path);
    if (!file) throw new Error(`Missing workspace note at "${path}"`);
    await this.io.replaceFrontmatter(file, serializeWorkspace(workspace));
    await this.index.rebuild();
  }

  /** The vault path of a view's backing note, `<root>/Views/<id>`. */
  private viewPath(snapshot: WorkspaceSnapshot, id: string): string {
    return joinPath(snapshot.workspace.root, FOLDERS.views, id);
  }

  /** The one live Saved View by id, read fresh so a stale render can't clobber. */
  private liveView(
    snapshot: WorkspaceSnapshot,
    id: string,
  ): SavedView | undefined {
    return (this.index.get(snapshot.workspace.root) ?? snapshot).views.find(
      (v) => v.id === id,
    );
  }

  /** Create a new Saved View — one `Views/<id>.md` note. */
  async addView(snapshot: WorkspaceSnapshot, view: SavedView): Promise<void> {
    await this.io.writeConfigNote(
      this.viewPath(snapshot, view.id),
      serializeView(view),
    );
    await this.index.rebuild();
  }

  /**
   * Persist an edit to one Saved View — rename, filter/group/sort tweak,
   * column state — straight to that view's own file, never touching any other
   * view. Writes the file even for a System View (its tweaks persist just like
   * a user view's); migration is the only path that must never create one.
   */
  async updateView(
    snapshot: WorkspaceSnapshot,
    view: SavedView,
  ): Promise<void> {
    const path = this.liveView(snapshot, view.id)?.path || this.viewPath(snapshot, view.id);
    await this.io.writeConfigNote(path, serializeView(view));
    await this.index.rebuild();
  }

  /**
   * Remove a Saved View — move its one file into `Trash/Views/`, restorable
   * from the Trash hub. System Views are protected by the UI.
   */
  async deleteView(snapshot: WorkspaceSnapshot, id: string): Promise<void> {
    const path = this.liveView(snapshot, id)?.path || this.viewPath(snapshot, id);
    const file = this.io.getFile(path);
    if (file) await this.moveToTrash(snapshot, file, "view");
    await this.index.rebuild();
  }

  // -- Dashboards (§Dashboards Phase 1) ------------------------------------

  /** The vault path of a dashboard's backing note, `<root>/Dashboards/<id>`. */
  private dashboardPath(snapshot: WorkspaceSnapshot, id: string): string {
    return joinPath(snapshot.workspace.root, FOLDERS.dashboards, id);
  }

  /** The one live dashboard by id, read fresh so a stale render can't clobber. */
  private liveDashboard(
    snapshot: WorkspaceSnapshot,
    id: string,
  ): DashboardConfig | undefined {
    return (
      this.index.get(snapshot.workspace.root) ?? snapshot
    ).dashboards.find((d) => d.id === id);
  }

  async addDashboard(
    snapshot: WorkspaceSnapshot,
    dashboard: DashboardConfig,
  ): Promise<void> {
    await this.io.writeConfigNote(
      this.dashboardPath(snapshot, dashboard.id),
      serializeDashboard(dashboard),
    );
    await this.index.rebuild();
  }

  /** Replace one dashboard by id — the Save from the dashboard view. */
  async updateDashboard(
    snapshot: WorkspaceSnapshot,
    dashboard: DashboardConfig,
  ): Promise<void> {
    const path =
      this.liveDashboard(snapshot, dashboard.id)?.path ||
      this.dashboardPath(snapshot, dashboard.id);
    await this.io.writeConfigNote(path, serializeDashboard(dashboard));
    await this.index.rebuild();
  }

  /** Remove a dashboard — move its one file into `Trash/Dashboards/`. */
  async deleteDashboard(
    snapshot: WorkspaceSnapshot,
    id: string,
  ): Promise<void> {
    const path =
      this.liveDashboard(snapshot, id)?.path || this.dashboardPath(snapshot, id);
    const file = this.io.getFile(path);
    if (file) await this.moveToTrash(snapshot, file, "dashboard");
    await this.index.rebuild();
  }

  /** Apply a widget-list transform to one live dashboard and write only that file. */
  private async mutateDashboardWidgets(
    snapshot: WorkspaceSnapshot,
    dashboardId: string,
    transform: (widgets: DashboardWidget[]) => DashboardWidget[],
  ): Promise<void> {
    const live = this.liveDashboard(snapshot, dashboardId);
    if (!live) return;
    await this.updateDashboard(snapshot, {
      ...live,
      widgets: transform(live.widgets),
    });
  }

  async addWidget(
    snapshot: WorkspaceSnapshot,
    dashboardId: string,
    widget: DashboardWidget,
  ): Promise<void> {
    await this.mutateDashboardWidgets(snapshot, dashboardId, (widgets) => [
      ...widgets,
      widget,
    ]);
  }

  async updateWidget(
    snapshot: WorkspaceSnapshot,
    dashboardId: string,
    widget: DashboardWidget,
  ): Promise<void> {
    await this.mutateDashboardWidgets(snapshot, dashboardId, (widgets) =>
      widgets.map((w) => (w.id === widget.id ? widget : w)),
    );
  }

  async deleteWidget(
    snapshot: WorkspaceSnapshot,
    dashboardId: string,
    widgetId: string,
  ): Promise<void> {
    await this.mutateDashboardWidgets(snapshot, dashboardId, (widgets) =>
      widgets.filter((w) => w.id !== widgetId),
    );
  }

  async duplicateWidget(
    snapshot: WorkspaceSnapshot,
    dashboardId: string,
    widgetId: string,
  ): Promise<void> {
    await this.mutateDashboardWidgets(snapshot, dashboardId, (widgets) => {
      const source = widgets.find((w) => w.id === widgetId);
      if (!source) return widgets;
      return [...widgets, cloneWidget(source, widgets)];
    });
  }

  // -- Projects -----------------------------------------------------------

  async createProject(
    snapshot: WorkspaceSnapshot,
    title: string,
    icon?: string,
  ): Promise<TFile> {
    // Titles are unique per workspace — a collision would make
    // `project:` filters and links ambiguous. Block it here rather than let
    // `availablePath` quietly mint "<title> 2": that suffixing was papering
    // over exactly this bug.
    if (isProjectTitleTaken(snapshot.projects, title)) {
      throw new Error(`A project named "${title.trim()}" already exists`);
    }

    const now = new Date().toISOString();
    // `availablePath` stays as a filesystem safety net for the rare case of
    // two *different* titles that sanitize to the same filename.
    const path = this.io.availablePath(
      joinPath(
        snapshot.workspace.root,
        FOLDERS.projects,
        sanitizeFileName(title),
      ),
    );
    const file = await this.io.create(
      path,
      serializeProject({
        type: "project",
        title,
        icon,
        status: snapshot.workspace.defaultNewTaskStatus,
        priority: null,
        labels: [],
        startDate: null,
        dueDate: null,
        owner: null,
        archived: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        path,
      }),
      // The body is the project's description, edited in the plugin's own
      // Project editor — created empty, like a Task note.
      "",
    );
    await this.index.rebuild();
    return file;
  }

  /**
   * Copy a project into a fresh, active project of the same identity — title
   * `"<title> copy"` (deduped), same icon, status, priority, labels, dates,
   * owner and description. Deliberately copies **nothing under it**: a
   * duplicated project has no tasks (remapping ids/relations/parent links is a
   * separate, much larger feature). `archived`/`archivedAt` are not copied —
   * every "new" flow in the app starts active.
   */
  async duplicateProject(
    snapshot: WorkspaceSnapshot,
    project: Project,
  ): Promise<TFile> {
    const title = nextAvailableProjectTitle(
      snapshot.projects,
      `${project.title} copy`,
    );
    // `createProject` rebuilds the index, so the new project is resolvable
    // straight after.
    const file = await this.createProject(snapshot, title, project.icon);
    const created = this.index
      .workspaceFor(file.path)
      ?.projects.find((p) => p.path === withoutExtension(file.path));
    if (created) {
      // Description first: `setProjectDescription` re-stamps frontmatter from
      // the (still blank) `created`, so the field patch has to land after it.
      const source = await this.readProjectDocument(project);
      if (source.description) {
        await this.setProjectDescription(created, source.description);
      }
      await this.updateProject(created, projectDuplicatePatch(project));
    }
    return file;
  }

  // -- Project note body --------------------------------------------------

  /** The project note's full text — frontmatter and body, exactly as on disk. */
  async readProjectRaw(project: Project): Promise<string> {
    const file = this.io.getFile(project.path);
    return file ? this.io.read(file) : "";
  }

  /**
   * The part of a project that lives in the body rather than frontmatter — its
   * description. Read on demand, exactly like `readDocument` for a Task, so the
   * index never costs a file read per project.
   */
  async readProjectDocument(project: Project): Promise<ProjectDocument> {
    const file = this.io.getFile(project.path);
    if (!file) return { project, description: "" };
    const body = await this.io.readBody(file);
    return { project, description: extractProjectDescription(body) };
  }

  /**
   * Write the description into the project note's body. A Project has no
   * comments block, so the body *is* the description — no section surgery.
   * `updatedAt` is re-stamped via frontmatter, matching Task's `setDescription`
   * (and, like it, without forcing a full index rebuild).
   */
  async setProjectDescription(project: Project, text: string): Promise<void> {
    const file = this.requireFile(project.path);
    await this.io.processBody(file, () => withProjectDescription(text));
    await this.io.replaceFrontmatter(
      file,
      serializeProject({ ...project, updatedAt: new Date().toISOString() }),
    );
  }

  /**
   * Patch a project's frontmatter (rename, icon). The note's *filename* is
   * never touched — the vault schema makes the frontmatter `title` the display
   * override, so a rename here can't cascade through wikilinks.
   */
  async updateProject(
    project: Project,
    patch: Partial<Project>,
  ): Promise<void> {
    const file = this.requireFile(project.path);

    // On rename, the new title must stay unique in the workspace — excluding
    // this project's own path so re-casing its own name is fine. Mirrors the
    // taxonomy engine's `updateValue` rejecting a rename onto another value.
    if (patch.title !== undefined) {
      const siblings = this.index.workspaceFor(project.path)?.projects ?? [];
      if (isProjectTitleTaken(siblings, patch.title, project.path)) {
        throw new Error(
          `A project named "${patch.title.trim()}" already exists`,
        );
      }
    }

    const merged: Project = {
      ...project,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.io.replaceFrontmatter(file, serializeProject(merged));
    await this.index.rebuild();
  }

  // -- Workspaces -----------------------------------------------------

  /**
   * The one workspace-creation path. Every new workspace comes from a
   * template; "Getting Started" is just the plainest one. `includeExampleContent`
   * decides whether the template's Projects/Tasks are written too.
   */
  async createWorkspaceFromTemplate(input: {
    template: WorkspaceTemplate;
    name: string;
    root: string;
    idPrefix?: string;
    icon?: string;
    includeExampleContent: boolean;
    /** Seeds a `people` entry flagged `isSelf` so "Assigned to Me" works
     *  from the first task. Blank/undefined leaves the register as the
     *  template defines it. */
    selfPersonName?: string;
  }): Promise<WorkspaceConfig> {
    const desired =
      input.idPrefix?.trim() ||
      suggestPrefix(input.name, this.index.takenPrefixes());
    const prefix = disambiguatePrefix(desired, this.index.takenPrefixes());

    const generated = instantiateTemplate({
      template: input.template,
      root: input.root,
      name: input.name,
      idPrefix: prefix,
      icon: input.icon,
      includeExampleContent: input.includeExampleContent,
      selfPersonName: input.selfPersonName,
    });

    await this.io.ensureFolder(input.root);
    for (const folder of Object.values(FOLDERS)) {
      await this.io.ensureFolder(joinPath(input.root, folder));
    }

    for (const note of generated.notes) {
      await this.io.create(note.path, note.frontmatter, note.body);
    }

    await this.index.rebuild();
    new Notice(`Created workspace "${generated.workspace.name}"`);
    return generated.workspace;
  }

  /**
   * Soft-delete an entire workspace: stamp `deletedAt` on its `_workspace.md`
   * and tidy up any relation links pointing into it from other workspaces. The
   * folder is **not** moved — the workspace's own `Trash/` folder lives inside
   * it, so it can't be relocated into itself — it just disappears from the
   * switcher (`VaultIndex.list()` filters it out) and comes back with
   * `restoreWorkspace`.
   *
   * The relation sweep runs **vault-wide** (unlike `applyDeletionPlan`, which
   * stays inside one `HierarchyScope`): the doomed workspace's tasks vanish
   * from the switcher all at once, so a `blocks`/`blockedBy`/`related`/
   * `duplicateOf` link in a *surviving* workspace would be left dangling.
   * Relations aren't hierarchy, so this is silent — no prompt, and it runs
   * immediately (the "clean up now, not deferred" precedent).
   *
   * The active-workspace pointer isn't reset here: both `useActiveWorkspace()`
   * (per-pane, in memory) and `main.activeWorkspace()` fall back to
   * `index.list()[0]` (and the UI to the onboarding empty state) when the
   * current root no longer resolves.
   */
  async deleteWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    const root = snapshot.workspace.root;

    await this.applyRelationEdits(
      danglingRelationEditsForWorkspaceDeletion(this.index.list(), root),
    );

    const file = this.io.getFile(joinPath(root, WORKSPACE_NOTE));
    if (file) {
      await this.io.updateFrontmatter(file, (frontmatter) => {
        frontmatter.deletedAt = new Date().toISOString();
      });
    }

    await this.index.rebuild();
    new Notice(`Deleted workspace "${snapshot.workspace.name}"`);
  }

  /** Undo a `deleteWorkspace` — clear the `deletedAt` stamp. */
  async restoreWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    const file = this.io.getFile(
      joinPath(snapshot.workspace.root, WORKSPACE_NOTE),
    );
    if (file) {
      await this.io.updateFrontmatter(file, (frontmatter) => {
        delete frontmatter.deletedAt;
      });
    }
    await this.index.rebuild();
  }

  // -- Helpers --------------------------------------------------------------

  private requireFile(path: string): TFile {
    const file = this.io.getFile(path);
    if (!file) throw new Error(`Note not found: "${path}"`);
    return file;
  }

  async open(path: string, newLeaf = false): Promise<void> {
    const file = this.io.getFile(path);
    if (!file) return;
    await this.app.workspace.getLeaf(newLeaf).openFile(file);
  }
}
