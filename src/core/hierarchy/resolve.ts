/**
 * Parent/child resolution and progress rollup (§7.1, §7.2, §4.2).
 *
 * Hierarchy is read entirely from frontmatter links — there are no stored
 * `children` arrays anywhere, so a child is found by querying for its parent
 * reference. That is what makes re-parenting a one-field edit (Golden Rule).
 */

import { linksMatch } from "../links";
import { categoryOf, type Taxonomy } from "../taxonomy/engine";
import {
  emptyProgress,
  type LinkTarget,
  type Progress,
  type Project,
  type Task,
  type WorkspaceSnapshot,
} from "../types";

/** The subset of a snapshot the hierarchy functions actually read. */
export interface HierarchyScope {
  tasks: Task[];
  projects: Project[];
}

export function scopeOf(snapshot: WorkspaceSnapshot): HierarchyScope {
  return {
    tasks: snapshot.tasks,
    projects: snapshot.projects,
  };
}

// ---------------------------------------------------------------------------
// Direct children
// ---------------------------------------------------------------------------

/** Sub-tasks of a task: the tasks whose `parent` points at it. */
export function childTasks(scope: HierarchyScope, parent: LinkTarget): Task[] {
  return scope.tasks.filter((task) => linksMatch(task.parent, parent));
}

/**
 * Every task carrying this project link, at any nesting depth.
 *
 * `parent` and `project` are independent fields (like Linear): a sub-task keeps
 * its own `project` — seeded from its parent at creation, then never synced —
 * so this flattened result includes nested sub-tasks. That's what a `project:X`
 * view filter wants (show all the work under a project); for a *rollup* use
 * `topLevelProjectTasks` instead, or the same work counts twice.
 */
export function projectTasks(
  scope: HierarchyScope,
  project: LinkTarget,
): Task[] {
  return scope.tasks.filter((task) => linksMatch(task.project, project));
}

/**
 * The project's *direct* tasks: same as `projectTasks` but only those with no
 * parent task. This is the set a project rollup (progress, the deletion
 * cascade) reasons about — a nested sub-task is already rolled into its own
 * parent's progress bar, so counting it again at the project level would
 * double-count it, and it's a hierarchical child of its parent task, not of
 * the project.
 */
export function topLevelProjectTasks(
  scope: HierarchyScope,
  project: LinkTarget,
): Task[] {
  return projectTasks(scope, project).filter((task) => task.parent == null);
}

// ---------------------------------------------------------------------------
// Relations (Blocks, Blocked By, Duplicates, etc.)
// ---------------------------------------------------------------------------

/** Resolve an array of link targets into actual Task objects. */
export function resolveTaskLinks(
  scope: HierarchyScope,
  links: LinkTarget[],
): Task[] {
  if (!links || links.length === 0) return [];
  return scope.tasks.filter((task) =>
    links.some((link) => linksMatch(task.path, link)),
  );
}

/**
 * Fetch all actual Task objects mapped to a specific relation category.
 * Example usage: relationTasks(scope, task, "blockedBy")
 */
export function relationTasks(
  scope: HierarchyScope,
  task: Task,
  relationCategory: string,
): Task[] {
  // Assumes task.relations is typed as Record<string, LinkTarget[]>
  // We cast to `any` safely here just in case the TS interface isn't updated yet.
  const links = (task as any).relations?.[relationCategory];
  if (!links || !Array.isArray(links)) return [];

  return resolveTaskLinks(scope, links);
}

// ---------------------------------------------------------------------------
// Descendants
// ---------------------------------------------------------------------------

/**
 * All sub-tasks beneath a task, at any depth. Cycle-safe: a corrupted vault
 * where two tasks name each other as parent must not hang the plugin.
 */
export function descendantTasks(
  scope: HierarchyScope,
  root: LinkTarget,
): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>([root]);
  const queue: LinkTarget[] = [root];

  while (queue.length > 0) {
    const current = queue.shift() as LinkTarget;
    for (const child of childTasks(scope, current)) {
      if (seen.has(child.path)) continue;
      seen.add(child.path);
      out.push(child);
      queue.push(child.path);
    }
  }
  return out;
}

/** Chain from a task up to its root ancestor, nearest first. Cycle-safe. */
export function ancestorTasks(scope: HierarchyScope, task: Task): Task[] {
  const byPath = new Map(scope.tasks.map((t) => [t.path, t]));
  const out: Task[] = [];
  const seen = new Set<string>([task.path]);

  let current: Task = task;
  while (current.parent) {
    const parentLink: LinkTarget = current.parent;
    const parent: Task | undefined =
      byPath.get(parentLink) ??
      scope.tasks.find((t) => linksMatch(t.path, parentLink));
    if (!parent || seen.has(parent.path)) break;
    seen.add(parent.path);
    out.push(parent);
    current = parent;
  }
  return out;
}

export function isSubtask(task: Task): boolean {
  return task.parent != null;
}

/**
 * The `project` a newly created task should get.
 *
 * `parent` and `project` are independent (like Linear): a new sub-task defaults
 * to its parent's project *once*, at creation, and from then on the field is
 * maintained on its own — re-parenting or moving the parent never re-syncs it.
 * An explicit value in the creation input — including an explicit `null` — always
 * wins over that inherited default.
 */
export function newTaskProject(
  explicit: LinkTarget | null | undefined,
  parent: Task | null,
): LinkTarget | null {
  if (explicit !== undefined) return explicit;
  return parent?.project ?? null;
}

/**
 * The single primary parent of a task, as a tagged reference (Golden Rule:
 * exactly one). `parent` wins over `project` — a sub-task's real home is its
 * parent task.
 */
export type PrimaryParent =
  | { kind: "task"; path: LinkTarget }
  | { kind: "project"; path: LinkTarget }
  | { kind: "none" };

export function primaryParent(task: Task): PrimaryParent {
  if (task.parent) return { kind: "task", path: task.parent };
  if (task.project) return { kind: "project", path: task.project };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Progress (computed, never stored, never auto-synced)
// ---------------------------------------------------------------------------

/**
 * Roll a set of tasks up into a progress figure.
 *
 * Canceled tasks are excluded from the denominator — a canceled task is work
 * that will never happen, so counting it against completion would leave every
 * finished project stuck below 100%.
 */
export function computeProgress(tasks: Task[], statuses: Taxonomy): Progress {
  if (tasks.length === 0) return emptyProgress();

  let completed = 0;
  let started = 0;
  let canceled = 0;

  for (const task of tasks) {
    switch (categoryOf(statuses, task.status)) {
      case "completed":
        completed++;
        break;
      case "started":
        started++;
        break;
      case "canceled":
        canceled++;
        break;
      default:
        break;
    }
  }

  const countable = tasks.length - canceled;
  return {
    total: tasks.length,
    completed,
    started,
    canceled,
    percent: countable > 0 ? Math.round((completed / countable) * 100) : 0,
  };
}

/**
 * Archived tasks are parked, out-of-scope work (§7.7), so they never count
 * toward a progress rollup — a parked sub-task shouldn't hold a parent's bar
 * below 100%, nor should un-archiving one suddenly change the maths. This is
 * unconditional: unlike the "Show archived" list toggle, a progress figure has
 * one correct value.
 */
function forRollup(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.archived);
}

/**
 * Sub-task progress bar for a parent task (§7.2). Direct children only — a
 * progress bar that silently counted grandchildren would misrepresent what the
 * user sees listed underneath it. Archived children are excluded (see
 * `forRollup`).
 *
 * Note what this function deliberately does *not* do: it never flips the
 * parent's own status when everything underneath is finished. Manual control is
 * the default posture everywhere (Golden Rule).
 */
export function subtaskProgress(
  scope: HierarchyScope,
  task: Task,
  statuses: Taxonomy,
): Progress {
  return computeProgress(forRollup(childTasks(scope, task.path)), statuses);
}

/**
 * Project progress (§4.2) — computed at render time, never written to
 * frontmatter, and intentionally not synced with the project's own `status`
 * in either direction (§7.1).
 */
export function projectProgress(
  scope: HierarchyScope,
  project: LinkTarget,
  statuses: Taxonomy,
): Progress {
  // Top-level only: a sub-task is already counted in its own parent's rollup
  // (§7.2), so counting it here too would double it. Archived tasks excluded,
  // same as `subtaskProgress`.
  return computeProgress(forRollup(topLevelProjectTasks(scope, project)), statuses);
}

/** A project's task tally, split so the header can show it unambiguously. */
export interface ProjectTaskBreakdown {
  /** Active, top-level (parent-less) tasks — what the project list shows by default. */
  tasks: number;
  /** Active sub-tasks (any depth) carrying the project link. */
  subtasks: number;
  /** Archived tasks in the project, top-level and sub combined. */
  archived: number;
}

/**
 * The project's whole scope of work, counted from `project`-link membership
 * (the same rule the view filter and `projectTasks` use). Deliberately
 * independent of any viewport's "Show sub-tasks" / "Show archived" toggles —
 * this is a stable fact about the project, not a reflection of what's on screen.
 *
 * `tasks` alone equals the default project viewport's row count;
 * `tasks + subtasks + archived` equals that viewport with both toggles on.
 * (`projectProgress` still rolls up top-level tasks only, so its denominator
 * can be smaller than `tasks`.)
 */
export function projectTaskBreakdown(
  scope: HierarchyScope,
  project: LinkTarget,
): ProjectTaskBreakdown {
  let tasks = 0;
  let subtasks = 0;
  let archived = 0;

  for (const task of projectTasks(scope, project)) {
    if (task.archived) archived += 1;
    else if (task.parent == null) tasks += 1;
    else subtasks += 1;
  }

  return { tasks, subtasks, archived };
}

/**
 * Relation progress — calculate completion of tasks inside a specific relation category.
 * E.g., pass "blockedBy" to see if this task is ready to start.
 */
export function relationProgress(
  scope: HierarchyScope,
  task: Task,
  relationCategory: string,
  statuses: Taxonomy,
): Progress {
  return computeProgress(
    relationTasks(scope, task, relationCategory),
    statuses,
  );
}

/** `"6/10"` — the compact form used on project cards. */
export function formatProgress(progress: Progress): string {
  return `${progress.completed}/${progress.total - progress.canceled}`;
}
