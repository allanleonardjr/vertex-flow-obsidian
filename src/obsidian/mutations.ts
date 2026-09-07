/**
 * Every write the plugin performs.
 *
 * The pattern throughout: **core decides, this layer applies.** A drag computes
 * its new rank in `src/core/ranking`; a deletion computes its plan in
 * `src/core/hierarchy`. Nothing here re-derives domain rules — it turns a plan
 * into vault operations and nothing more.
 */

import { App, Notice, TFile } from "obsidian";
import {
  disambiguatePrefix,
  nextTaskId,
  slugify,
  suggestPrefix,
} from "../core/ids";
import { localTodayIso } from "../core/date";
import { formatLink, joinPath, sanitizeFileName } from "../core/links";
import { planReorder, rankAfter, rankForNewTask, rankForPosition, sortTasksByRank } from "../core/ranking";
import {
  describeRecurrence,
  nextInChain,
  reconcilePlans,
  recurrenceNodesInChain,
} from "../core/recurrence";
import type { OccurrencePlan } from "../core/recurrence";
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
import { COLOR_PALETTE } from "../core/color";
import {
  emptyRelations,
  type Comment,
  type DashboardConfig,
  type DashboardWidget,
  type EntityKind,
  type LinkTarget,
  type Project,
  type ProjectDocument,
  type RecurrenceConfig,
  type SavedView,
  type Task,
  type TaskFieldKey,
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
import { HistoryLog } from "./history-log";
import { getMePersonId, setMePersonId } from "./me-storage";
import {
  dashboardIdentityChanges,
  diffProjectFields,
  diffTaskFields,
  viewIdentityChanges,
  workspaceConfigChanges,
} from "../core/history/diff";
import type { HistoryActor, HistoryChange, HistoryTarget } from "../core/types";
import { SYSTEM_ACTOR_NAME, valuesDiffer } from "../core/history";

/** Callbacks into plugin-owned state the mutation layer must not hold. */
export interface MutationsHooks {
	/**
	 * Persist "who am I" for a freshly created workspace — per device, per
	 * workspace (see `src/obsidian/me-storage.ts`), never in synced settings.
	 */
	setMePersonId?: (workspaceRoot: string, personId: string | null) => void;
}

export interface NewTaskInput {
  /** Optional — a task is untitled until the user types a name. */
  title?: string;
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
    private readonly history: HistoryLog,
    private readonly hooks: MutationsHooks = {},
  ) {}

  // -- Recurring-task reconcile state -------------------------------------
  //
  // Reconcile is a post-rebuild engine (never an `updateTask` hook), so these
  // flags keep the async lifecycle honest: one pass at a time, no plotting
  // against a half-written batch, and a silent skip while a taxonomy
  // deletion is mid-flight (reassigning statuses must not resume chains).

  private reconciling = false;
  private reconcileQueued = false;
  private spawning = false;
  /** Set when a status reassignment is being applied; consumed by the next
   *  reconcile request, which skips that one pass. */
  private suppressNextReconcile = false;
  /**
   * Source paths handed a successor in the current spawn generation. Obsidian's
   * metadata cache doesn't populate synchronously after `vault.create()`, so the
   * rebuild that immediately follows a spawn can miss the just-written successor
   * and drop it from the snapshot — leaving `nextInChain()` blind and a trailing
   * pass free to spawn a second, independent successor. A source stays in this
   * set until a snapshot actually shows its successor, and is skipped for
   * planning until then.
   */
  private recentlySpawned = new Set<LinkTarget>();

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
    // field that never re-syncs. An explicit `project` in the
    // input (including `null`) always wins over that default.
    const project = newTaskProject(input.project, parentTask);

    const task: Task = {
      type: "task",
      id,
      title: (input.title ?? "").trim(),
      taskType: input.taskType ?? null,
      status: input.status ?? workspace.defaultNewTaskStatus,
      priority: input.priority ?? null,
      rank: rankForNewTask(siblings),
      project,
      parent: input.parent ?? null,
      recurringFrom: null,
      assignee: input.assignee ?? null,
      estimate: input.estimate ?? null,
      labels: input.labels ?? [],
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      recurrence: null,
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

    this.history.record(workspace, {
      action: "task.create",
      targets: [{ kind: "task", id, path }],
      changes: task.title ? [{ field: "title", to: task.title }] : [],
    });
    return file;
  }

  // -- Recurring tasks --------------------------------------------------

  /**
   * One reconcile pass: ask the engine what every workspace wants spawned
   * today, write those occurrences, and rebuild once. Safe to call from the
   * index subscription after every rebuild — a pass that spawns nothing is a
   * no-op, and a pass that did spawn is followed by another pass that sees
   * the completed chain and stops (flood-proof by construction).
   */
  async reconcileRecurrences(): Promise<void> {
    if (this.spawning || this.reconciling) {
      this.reconcileQueued = true;
      return;
    }
    if (this.suppressNextReconcile) {
      this.suppressNextReconcile = false;
      return;
    }

    this.reconciling = true;
    try {
      const today = localTodayIso();
      let wrote = false;
      for (const snapshot of this.index.list()) {
        const plans = reconcilePlans(snapshot, today);

        // Reconcile the in-memory "just spawned" set against what this snapshot
        // actually shows: a source whose successor is now visible is confirmed
        // and drops out; one still missing stays settled — drop any plan the
        // stale snapshot produced for it, so it isn't handled a second time.
        for (const path of this.recentlySpawned) {
          const node = snapshot.tasks.find((task) => task.path === path);
          if (node && nextInChain(snapshot, node)) {
            this.recentlySpawned.delete(path);
          } else {
            plans.delete(path);
          }
        }

        if (plans.size === 0) continue;
        this.spawning = true;
        try {
          await this.spawnOccurrences(snapshot, plans);
        } finally {
          this.spawning = false;
        }
        wrote = true;
      }
      if (wrote) await this.index.rebuild();
    } finally {
      this.reconciling = false;
    }

    // A request that arrived mid-pass (e.g. a rebuild fired by our own
    // writes) is honored as one trailing pass, never lost.
    if (this.reconcileQueued) {
      this.reconcileQueued = false;
      void this.reconcileRecurrences();
    }
  }

  /**
   * Set up, edit, or turn off one task's repeat schedule — the Repeat
   * editor's single Save path (both the task editor's row and the Recurring
   * hub). Writes the block, then logs **one** `task.update` carrying a
   * human-readable `recurrence` change (before / after schedule summaries),
   * so "set up a repeat", "edited a repeat", and "turned a repeat off" each
   * land exactly one History entry. A Save that changed nothing logs nothing.
   */
  async setRecurrence(
    task: Task,
    next: RecurrenceConfig | null,
  ): Promise<void> {
    const before = task.recurrence ?? null;
    const after = next ?? null;
    await this.updateTask(task, { recurrence: after }, { suppressHistory: true });
    if (!valuesDiffer(before, after)) return;

    const workspace = this.index.workspaceFor(task.path)?.workspace;
    if (!workspace) return;
    const change: HistoryChange = { field: "recurrence" };
    if (before) change.from = describeRecurrence(before, workspace.statuses);
    if (after) change.to = describeRecurrence(after, workspace.statuses);
    this.history.record(workspace, {
      action: "task.update",
      targets: [this.taskTarget(task)],
      changes: [change],
    });
  }

  /**
   * Stop a whole series. Non-destructive: every chain member keeps its
   * `recurringFrom` ancestry (the history reads), only the live recurrence
   * block is cleared. `recurrenceNodesInChain` covers the members that
   * still carry one, so a twice-stopped chain is a cheap no-op.
   *
   * Logs a single `task.update` (a `recurrence` change with the stopped
   * schedule as `from` and no `to`), attributed to the user — a deliberate
   * button-click — not per chain member.
   */
  async stopRecurrence(task: Task): Promise<void> {
    const snapshot = this.index.workspaceFor(task.path);
    if (!snapshot) return;
    const nodes = recurrenceNodesInChain(snapshot, task);
    if (nodes.length === 0) return;

    const rule = task.recurrence ?? nodes[0].recurrence;
    const change: HistoryChange = { field: "recurrence" };
    if (rule) change.from = describeRecurrence(rule, snapshot.workspace.statuses);

    for (const node of nodes) {
      await this.updateTask(node, { recurrence: null }, { suppressHistory: true });
    }
    this.history.record(snapshot.workspace, {
      action: "task.update",
      targets: [this.taskTarget(task)],
      changes: [change],
    });
  }

/**
 * Write one batch of occurrences. Successor notes are siblings of their
 * source (never sub-tasks), ranked right after it, so a backfilled series
 * reads oldest → newest down the list. The batch chains `recurringFrom`:
 * the first successor points at the source, each later one at its direct
 * predecessor, keeping the chain walkable one hop at a time.
 */
private async spawnOccurrences(
  snapshot: WorkspaceSnapshot,
  plansBySource: Map<LinkTarget, OccurrencePlan[]>,
): Promise<void> {
  const workspace = snapshot.workspace;
  const takenIds = new Set(snapshot.tasks.map((task) => task.id));
  const now = new Date().toISOString();
  const systemActor: HistoryActor = { kind: "system", name: SYSTEM_ACTOR_NAME };

  for (const [sourcePath, plans] of plansBySource) {
    const source = snapshot.tasks.find((task) => task.path === sourcePath);
    if (!source) continue;

    const file = this.io.getFile(source.path);
    const body = file ? await this.io.readBody(file) : "";
    const description = parseDescription(body);

    const siblings = sortTasksByRank(
      snapshot.tasks.filter((task) => task.parent === source.parent),
    );
    const within = siblings.map((task) => task.rank);
    const sourceIndex = siblings.findIndex((task) => task.path === source.path);
    let rank =
      sourceIndex === -1
        ? rankForNewTask(siblings)
        : rankForPosition(within, sourceIndex + 1);

    const rule = source.recurrence;
    const copyFields = rule?.copyFields;
    const shouldCopy = (field: TaskFieldKey): boolean =>
      copyFields == null || copyFields.includes(field);

    let predecessor: Task = source;
    for (const plan of plans) {
      const id = nextTaskId(workspace.idPrefix, takenIds);
      takenIds.add(id);
      const path = joinPath(workspace.root, FOLDERS.tasks, id);

      const task: Task = {
        type: "task",
        id,
        title: source.title,
        taskType: shouldCopy("taskType") ? source.taskType : null,
        status:
          source.recurrence?.newStatus ?? workspace.defaultNewTaskStatus,
        priority: shouldCopy("priority") ? source.priority : null,
        rank,
        project: shouldCopy("project") ? source.project : null,
        parent: shouldCopy("parent") ? source.parent : null,
        recurringFrom: predecessor.path,
        assignee: shouldCopy("assignee") ? source.assignee : null,
        estimate: shouldCopy("estimate") ? source.estimate : null,
        labels: shouldCopy("labels") ? source.labels : [],
        startDate: plan.startDate,
        dueDate: plan.dueDate,
        recurrence: plan.recurrence,
        archived: false,
        archivedAt: null,
        relations: emptyRelations(),
        createdAt: now,
        updatedAt: now,
        path,
        mentions: [],
      };

      await this.io.create(
        path,
        serializeTask(task),
        serializeDescription(description),
      );
      // Machine-initiated: the reconcile engine created this, not a direct
      // user action, so it's attributed to the system rather than
      // whichever device happened to run the reconcile. The recurringFrom
      // change makes the entry explicit about *why* this task exists.
      this.history.record(workspace, {
        action: "task.create",
        targets: [{ kind: "task", id, path }],
        changes: [
          ...(source.title ? [{ field: "title", to: source.title }] : []),
          { field: "recurringFrom", to: predecessor.path },
        ],
        actorOverride: systemActor,
      });

      predecessor = task;
      rank = rankAfter(rank);
    }

    // This source now has a successor on disk. Until a snapshot confirms it,
    // treat the source as settled so a cache-lagged rebuild can't double-spawn.
    this.recentlySpawned.add(sourcePath);

    // The source's own schedule is superseded the moment it spawns — only
    // the newest occurrence in the chain should ever carry a live
    // recurrence block (see the matching fix in spawnPlans's backfill
    // case). Machine-initiated, so logged under the same system actor.
    if (source.recurrence) {
      await this.updateTask(
        source,
        { recurrence: null },
        { actorOverride: systemActor },
      );
    }
  }
}

  /**
   * Patch a task's frontmatter. `updatedAt` is stamped here rather than by
   * each caller, so no code path can forget it.
   *
   * Also the choke point for history: every single-task frontmatter edit —
   * the field setters below and the UI's direct `updateTask(...)` callers
   * alike — funnels through here and logs a `task.update` with the *actual*
   * field deltas. Multi-write flows pass `{ suppressHistory: true }` and log
   * their own, richer entries (`task.bulk-update`, `task.move`, taxonomy
   * reassignment), so a single user action never double-logs.
   */
  async updateTask(
    task: Task,
    patch: Partial<Task>,
    options?: { suppressHistory?: boolean; actorOverride?: HistoryActor },
  ): Promise<void> {
    const file = this.requireFile(task.path);
    const merged: Task = {
      ...task,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.io.replaceFrontmatter(file, serializeTask(merged));
    this.logUpdate(task, merged, options);
  }

  /** Record a `task.update` when a frontmatter edit actually changed fields. */
  private logUpdate(
    before: Task,
    after: Task,
    options?: { suppressHistory?: boolean; actorOverride?: HistoryActor },
  ): void {
    if (options?.suppressHistory) return;
    const changes = diffTaskFields(before, after);
    if (changes.length === 0) return;
    const workspace = this.index.workspaceFor(before.path)?.workspace;
    if (!workspace) return;
    this.history.record(workspace, {
      action: "task.update",
      targets: [this.taskTarget(after)],
      changes,
      actorOverride: options?.actorOverride,
    });
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
    * cascades to its existing sub-tasks.
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
   *
   * One purposeful asymmetry: a pure reorder (only `rank` changed, e.g. a
   * within-column drag) still logs, because the *placement* is the event —
   * but `rank` itself is never a `change`, so the ledger says "moved" without
   * ever exposing LexoRank strings.
   */
  async moveTask(
    task: Task,
    siblings: Task[],
    toIndex: number,
    fieldEdit?: Partial<Task>,
  ): Promise<void> {
    const assignment = planReorder(task, siblings, toIndex);
    const after: Task = {
      ...task,
      ...fieldEdit,
      rank: assignment.rank,
      updatedAt: new Date().toISOString(),
    };
    await this.updateTask(task, { rank: assignment.rank, ...fieldEdit }, { suppressHistory: true });

    const workspace = this.index.workspaceFor(task.path)?.workspace;
    if (workspace) {
      this.history.record(workspace, {
        action: "task.move",
        targets: [this.taskTarget(after)],
        changes: diffTaskFields(task, after),
      });
    }
  }

  /**
   * Bulk edit across a multi-selection. Logged as a single `task.bulk-update`
   * carrying every target; the hub collapses the per-task deltas into counts,
   * so a 40-task "set priority" lands as one entry, not forty.
   */
  async bulkUpdate(tasks: Task[], patch: Partial<Task>): Promise<void> {
    if (tasks.length === 0) {
      new Notice("Updated 0 tasks");
      return;
    }

    const changes: HistoryChange[] = [];
    for (const task of tasks) {
      const after: Task = {
        ...task,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await this.updateTask(task, patch, { suppressHistory: true });
      changes.push(...diffTaskFields(task, after));
    }

    const workspace = this.index.workspaceFor(tasks[0].path)?.workspace;
    if (workspace) {
      this.history.record(workspace, {
        action: "task.bulk-update",
        targets: tasks.map((task) => this.taskTarget(task)),
        changes,
      });
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

    const workspace = this.index.workspaceFor(task.path)?.workspace;
    if (workspace) {
      this.history.record(workspace, {
        action: "task.update",
        targets: [this.taskTarget(task)],
        // The body diff is deliberately not captured ("unsavoury" in the
        // format rules) — the event is recorded, not the prose.
        changes: [{ field: "description" }],
      });
    }
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

    const workspace = this.index.workspaceFor(task.path)?.workspace;
    if (workspace) {
      this.history.record(workspace, {
        action: "comment.add",
        targets: [this.taskTarget(task)],
        // No id captured here — the comment's id is minted inside the body
        // transform above. The entry records the event, not the id.
        changes: [{ field: "comment" }],
      });
    }
  }

  async deleteComment(task: Task, commentId: string): Promise<void> {
    const file = this.requireFile(task.path);
    await this.io.processBody(file, (content) =>
      withComments(
        content,
        parseComments(content).filter((comment) => comment.id !== commentId),
      ),
    );

    const workspace = this.index.workspaceFor(task.path)?.workspace;
    if (workspace) {
      this.history.record(workspace, {
        action: "comment.delete",
        targets: [this.taskTarget(task)],
        changes: [{ field: "comment", from: commentId }],
      });
    }
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

    const workspace = this.index.workspaceFor(task.path)?.workspace;
    if (workspace) {
      this.history.record(workspace, {
        action: "comment.update",
        targets: [this.taskTarget(task)],
        changes: [{ field: "reaction", to: emoji }],
      });
    }
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

    this.history.record(snapshot.workspace, {
      action: `${item.kind}.restore`,
      targets: [this.entityTarget(item)],
    });
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

    // `permanentlyDeleteItem` has no snapshot at hand (it's reached straight
    // from the Trash hub) — resolve the workspace from the pre-delete index.
    const workspace = this.index.workspaceFor(item.entity.path)?.workspace;
    if (workspace) {
      // Note: after `io.trash` the file is already gone from `index.get`, but
      // the *config* unchanged — `workspace` above is resolved fine.
      this.history.record(workspace, {
        action: `${item.kind}.delete-forever`,
        targets: [this.entityTarget(item)],
      });
    }
  }

  /** A trashed entity as a history target, using its stored identity. */
  private entityTarget(item: TrashedItem): HistoryTarget {
    const entity = item.entity;
    if (item.kind === "task") return this.taskTarget(entity as Task);
    if (item.kind === "project") return this.projectTarget(entity as Project);
    const named = entity as SavedView | DashboardConfig;
    return { kind: item.kind, id: named.name ?? named.id, path: named.path };
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

    // One entry for the *confirmed* deletion. Cascaded children each get their
    // own Trash row through `restoreItem`/`permanentlyDeleteItem` when a human
    // touches them later — they aren't re-logged here, or a cascade would
    // flood the feed with the same event a dozen times.
    const primary = plan.kind === "project"
      ? snapshot.projects
          .filter((p) => p.path === plan.path)
          .map((p) => this.projectTarget(p))
      : snapshot.tasks
          .filter((t) => t.path === plan.path)
          .map((t) => this.taskTarget(t));
    if (primary.length > 0) {
      this.history.record(snapshot.workspace, {
        action: `${plan.kind}.delete`,
        targets: primary,
      });
    }
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
    // Reassigned statuses must not resume a chain mid-sweep — the next
    // reconcile request skips one pass, then bookkeeping proceeds normally.
    this.suppressNextReconcile = true;
    const result = applyTaxonomyDeletion(taxonomy, plan, replacementId);
    const kind = taxonomy.schema.kind;
    const to = result.replacementId;

    if (result.removeFromAll) {
      // Multi-select only (labels): just strip the value everywhere.
      for (const task of snapshot.tasks) {
        if (!task.labels.includes(plan.valueId)) continue;
        await this.updateTask(
          task,
          { labels: task.labels.filter((id) => id !== plan.valueId) },
          { suppressHistory: true },
        );
      }
    } else if (to) {
      for (const task of snapshot.tasks) {
        if (kind === "label") {
          const labels = reassignValues(task.labels, plan.valueId, to);
          if (labels !== task.labels) {
            await this.updateTask(task, { labels }, { suppressHistory: true });
          }
          continue;
        }

        const current = task[kind];
        const next = reassignValue(current, plan.valueId, to);
        if (next !== current) {
          await this.updateTask(task, { [kind]: next }, { suppressHistory: true });
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
      { skipHistory: true },
    );

    // One entry for the whole reassignment — the per-task writes above were
    // suppressed so the sweep surfaces as a single taxonomy event, not a
    // row per affected task.
    this.history.record(snapshot.workspace, {
      action: `taxonomy.${kind}.delete`,
      targets: [this.workspaceTarget(snapshot.workspace)],
      changes: [
        {
          field: `${kind}.${plan.valueId}`,
          from: plan.valueId,
          to: result.replacementId,
        },
      ],
    });
  }

  // -- Labels — fluid: created and edited outside Settings ----------

  /** First palette colour not already used by a label, cycling if all are. */
  private nextLabelColor(snapshot: WorkspaceSnapshot): string {
    const used = new Set(snapshot.workspace.labels.map((l) => l.color));
    return (
      COLOR_PALETTE.find((c) => !used.has(c)) ??
      COLOR_PALETTE[
        snapshot.workspace.labels.length % COLOR_PALETTE.length
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

  // -- People — created and edited outside Settings ----------------

  /**
   * Delete a person, reassigning (or, with `replacementId: null`, clearing)
   * every `assignee`/`owner` that referenced them before removing them from the
   * register. `reassignValue` is the same generic single-select rewrite the
   * taxonomy engine uses — no taxonomy coupling in its body. The device's
   * per-workspace "me" personId is cleared by the People settings UI when the
   * person it names is deleted here.
   */
  async deletePerson(
    snapshot: WorkspaceSnapshot,
    personId: string,
    replacementId: string | null,
  ): Promise<void> {
    for (const task of snapshot.tasks) {
      const next = reassignValue(task.assignee, personId, replacementId);
      if (next !== task.assignee) await this.updateTask(task, { assignee: next });
    }

    for (const project of snapshot.projects) {
      const next = reassignValue(project.owner, personId, replacementId);
      if (next === project.owner) continue;
      const file = this.io.getFile(project.path);
      if (!file) continue;
      await this.io.updateFrontmatter(file, (frontmatter) => {
        if (next == null) delete frontmatter.owner;
        else frontmatter.owner = next;
      });
    }

    // If this device had that person marked as "me", clear it — a dangling id
    // would silently break `SELF` resolution and the "You" badge, and clearing
    // it also brings the "who are you?" nudge back (see `me-storage`).
    if (getMePersonId(snapshot.workspace.root) === personId) {
      setMePersonId(snapshot.workspace.root, null);
    }

    await this.saveWorkspaceConfig({
      ...snapshot.workspace,
      people: snapshot.workspace.people.filter((p) => p.id !== personId),
    });
  }

  async createPerson(
    snapshot: WorkspaceSnapshot,
    name: string,
    aliases: string[],
  ): Promise<string> {
    const id = slugify(
      name,
      snapshot.workspace.people.map((p) => p.id),
    );
    await this.saveWorkspaceConfig({
      ...snapshot.workspace,
      people: [
        ...snapshot.workspace.people,
        { id, name, aliases },
      ],
    });
    return id;
  }

  async updatePerson(
    snapshot: WorkspaceSnapshot,
    id: string,
    patch: { name?: string; aliases?: string[] },
  ): Promise<void> {
    await this.saveWorkspaceConfig({
      ...snapshot.workspace,
      people: snapshot.workspace.people.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    });
  }

  // -- Config notes ---------------------------------------------------------

  async saveWorkspaceConfig(
    workspace: WorkspaceConfig,
    options?: { skipHistory?: boolean },
  ): Promise<void> {
    const path = joinPath(workspace.root, WORKSPACE_NOTE);
    const file = this.io.getFile(path);
    if (!file) throw new Error(`Missing workspace note at "${path}"`);
    // Capture the pre-write config while the index still holds it — the
    // rebuild below would otherwise hand the *new* config back and the diff
    // would always come out empty.
    const before = options?.skipHistory
      ? undefined
      : this.index.get(workspace.root)?.workspace;
    await this.io.replaceFrontmatter(file, serializeWorkspace(workspace));
    await this.index.rebuild();

    if (before && !options?.skipHistory) {
      const changes = workspaceConfigChanges(before, workspace);
      if (changes.length > 0) {
        this.history.record(workspace, {
          action: "workspace.config.update",
          targets: [this.workspaceTarget(workspace)],
          changes,
        });
      }
    }
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

    // Views churn their *content* constantly (column drags, filter tweaks) —
    // only the create/trash events are history. `updateView` stays silent.
    this.history.record(snapshot.workspace, {
      action: "view.create",
      targets: [{ kind: "view", id: view.id, path: view.path }],
    });
  }

  /**
   * Persist an edit to one Saved View — rename, filter/group/sort tweak,
   * column state — straight to that view's own file, never touching any other
   * view. Writes the file even for a System View (its tweaks persist just like
   * a user view's); migration is the only path that must never create one.
   *
   * History is identity-only: a rename or an icon/description swap is logged
   * as `view.update`; the column/filter/timeline churn a view undergoes while
   * you work in it is not (see `addView`'s comment).
   */
  async updateView(
    snapshot: WorkspaceSnapshot,
    view: SavedView,
  ): Promise<void> {
    const prev = this.liveView(snapshot, view.id);
    const path = prev?.path || this.viewPath(snapshot, view.id);
    await this.io.writeConfigNote(path, serializeView(view));
    await this.index.rebuild();

    if (prev) {
      const changes = viewIdentityChanges(prev, view);
      if (changes.length > 0) {
        this.history.record(snapshot.workspace, {
          action: "view.update",
          targets: [{ kind: "view", id: view.id, path }],
          changes,
        });
      }
    }
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
    this.history.record(snapshot.workspace, {
      action: "view.delete",
      targets: [{ kind: "view", id, path }],
    });
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
    this.history.record(snapshot.workspace, {
      action: "dashboard.create",
      targets: [{ kind: "dashboard", id: dashboard.id, path: dashboard.path }],
    });
  }

  /**
   * Replace one dashboard by id — the Save from the dashboard view. Widget and
   * filter edits are view state, not history; a rename or icon/description swap
   * is (mirrors `updateView`).
   */
  async updateDashboard(
    snapshot: WorkspaceSnapshot,
    dashboard: DashboardConfig,
  ): Promise<void> {
    const prev = this.liveDashboard(snapshot, dashboard.id);
    const path =
      this.liveDashboard(snapshot, dashboard.id)?.path ||
      this.dashboardPath(snapshot, dashboard.id);
    await this.io.writeConfigNote(path, serializeDashboard(dashboard));
    await this.index.rebuild();

    if (prev) {
      const changes = dashboardIdentityChanges(prev, dashboard);
      if (changes.length > 0) {
        this.history.record(snapshot.workspace, {
          action: "dashboard.update",
          targets: [{ kind: "dashboard", id: dashboard.id, path }],
          changes,
        });
      }
    }
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
    this.history.record(snapshot.workspace, {
      action: "dashboard.delete",
      targets: [{ kind: "dashboard", id, path }],
    });
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
    description?: string,
    options?: { suppressHistory?: boolean },
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
      // Project editor — created empty, like a Task note, unless the creation
      // dialog collected one.
      description ? withProjectDescription(description) : "",
    );
    await this.index.rebuild();
    if (!options?.suppressHistory) {
      this.history.record(snapshot.workspace, {
        action: "project.create",
        targets: [{ kind: "project", id: title, path }],
        changes: [{ field: "title", to: title }],
      });
    }
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
    // straight after. The three writes below surface as a single
    // `project.duplicate` entry rather than a create + two updates.
    const file = await this.createProject(snapshot, title, project.icon, undefined, { suppressHistory: true });
    const created = this.index
      .workspaceFor(file.path)
      ?.projects.find((p) => p.path === withoutExtension(file.path));
    if (created) {
      // Description first: `setProjectDescription` re-stamps frontmatter from
      // the (still blank) `created`, so the field patch has to land after it.
      const source = await this.readProjectDocument(project);
      if (source.description) {
        await this.setProjectDescription(created, source.description, true);
      }
      await this.updateProject(created, projectDuplicatePatch(project), {
        suppressHistory: true,
      });
    }
    this.history.record(snapshot.workspace, {
      action: "project.duplicate",
      targets: [{ kind: "project", id: title, path: withoutExtension(file.path) }],
      changes: [{ field: "source", from: project.path }],
    });
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
  async setProjectDescription(
    project: Project,
    text: string,
    skipHistory = false,
  ): Promise<void> {
    const file = this.requireFile(project.path);
    await this.io.processBody(file, () => withProjectDescription(text));
    await this.io.replaceFrontmatter(
      file,
      serializeProject({ ...project, updatedAt: new Date().toISOString() }),
    );
    if (!skipHistory) {
      const workspace = this.index.workspaceFor(project.path)?.workspace;
      if (workspace) {
        this.history.record(workspace, {
          action: "project.update",
          targets: [this.projectTarget({ ...project, path: project.path })],
          changes: [{ field: "description" }],
        });
      }
    }
  }

  /**
   * Patch a project's frontmatter (rename, icon). The note's *filename* is
   * never touched — the vault schema makes the frontmatter `title` the display
   * override, so a rename here can't cascade through wikilinks.
   */
  async updateProject(
    project: Project,
    patch: Partial<Project>,
    options?: { suppressHistory?: boolean },
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

    if (!options?.suppressHistory) {
      const changes = diffProjectFields(project, merged);
      if (changes.length > 0) {
        const workspace = this.index.workspaceFor(project.path)?.workspace;
        if (workspace) {
          this.history.record(workspace, {
            action: "project.update",
            targets: [this.projectTarget(merged)],
            changes,
          });
        }
      }
    }
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
    /** Overrides the template's `history:` frontmatter when set — the
     *  workspace-creation UI's toggle ships the template's own value as the
     *  default and only passes this when the user flips it. */
    enableHistory?: boolean;
    /** Seeds the register's "me" person by name and records it as this device's
     *  "me" for the new workspace. Blank/undefined leaves the register as the
     *  template defines it (a `template.mePersonId` path still applies). */
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
      enableHistory: input.enableHistory,
      selfPersonName: input.selfPersonName,
    });

    // Creating a workspace seeds its own self-person; record it as this
    // device's "me" for that workspace.
    if (generated.personId) {
      this.hooks.setMePersonId?.(generated.root, generated.personId);
    }

    await this.io.ensureFolder(input.root);
    for (const folder of Object.values(FOLDERS)) {
      await this.io.ensureFolder(joinPath(input.root, folder));
    }

    for (const note of generated.notes) {
      await this.io.create(note.path, note.frontmatter, note.body);
    }

    await this.index.rebuild();

    // The workspace's own creation opens the log when history is on. It lands
    // on the chain before the demo seed below, so a scaffolded workspace reads
    // "created" then "history turned on" then the demo entries — coherent even
    // though `record` and `seed` are both fire-and-forget.
    if (generated.workspace.history.enabled) {
      this.history.record(generated.workspace, {
        action: "workspace.create",
        targets: [this.workspaceTarget(generated.workspace)],
      });
    }

    // Demo history for this new workspace, if the template seeded any.
    // Fire-and-forget like `record()`: it lands on the log chain and flushes
    // before any History read; a demo-log write failing must not fail
    // workspace creation.
    if (generated.history && generated.history.length > 0) {
      void this.history.seed(generated.workspace.root, generated.history);
    }

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
    this.history.record(snapshot.workspace, {
      action: "workspace.delete",
      targets: [this.workspaceTarget(snapshot.workspace)],
    });
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
    this.history.record(snapshot.workspace, {
      action: "workspace.restore",
      targets: [this.workspaceTarget(snapshot.workspace)],
    });
  }

  /**
   * Permanently remove a soft-deleted workspace. Sends the whole root folder
   * through `io.trash()` — the same call every other permanent delete in the
   * codebase uses (see `permanentlyDeleteItem`) — honouring the user's
   * Obsidian "deleted files" preference. Once the folder is gone, the next
   * index rebuild naturally drops it from `list()`; no extra bookkeeping.
   */
  async permanentlyDeleteWorkspace(
    snapshot: WorkspaceSnapshot,
  ): Promise<void> {
    const folder = this.io.getFolder(snapshot.workspace.root);
    if (folder) await this.io.trash(folder);
    await this.index.rebuild();
  }

  // -- Helpers --------------------------------------------------------------

  private requireFile(path: string): TFile {
    const file = this.io.getFile(path);
    if (!file) throw new Error(`Note not found: "${path}"`);
    return file;
  }

  // -- History targets ------------------------------------------------------

  private taskTarget(task: Task): HistoryTarget {
    return { kind: "task", id: task.id, path: task.path };
  }

  private projectTarget(project: Project): HistoryTarget {
    return { kind: "project", id: project.title, path: project.path };
  }

  private workspaceTarget(workspace: WorkspaceConfig): HistoryTarget {
    return {
      kind: "workspace",
      id: workspace.root,
      path: joinPath(workspace.root, WORKSPACE_NOTE),
    };
  }

  async open(path: string, newLeaf = false): Promise<void> {
    const file = this.io.getFile(path);
    if (!file) return;
    await this.app.workspace.getLeaf(newLeaf).openFile(file);
  }
}
