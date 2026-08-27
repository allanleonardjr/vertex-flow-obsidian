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
  type Initiative,
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
  initiatives?: Initiative[];
}

export function scopeOf(snapshot: WorkspaceSnapshot): HierarchyScope {
  return {
    tasks: snapshot.tasks,
    projects: snapshot.projects,
    initiatives: snapshot.initiatives,
  };
}

// ---------------------------------------------------------------------------
// Direct children
// ---------------------------------------------------------------------------

/** Sub-tasks of a task: the tasks whose `parent` points at it. */
export function childTasks(scope: HierarchyScope, parent: LinkTarget): Task[] {
  return scope.tasks.filter((task) => linksMatch(task.parent, parent));
}

/** Tasks whose primary parent is this project. */
export function projectTasks(
  scope: HierarchyScope,
  project: LinkTarget,
): Task[] {
  return scope.tasks.filter((task) => linksMatch(task.project, project));
}

/** Projects belonging to this initiative. */
export function initiativeProjects(
  scope: HierarchyScope,
  initiative: LinkTarget,
): Project[] {
  return scope.projects.filter((project) =>
    linksMatch(project.initiative, initiative),
  );
}

/** Tasks attached *directly* to this initiative, bypassing any project. */
export function initiativeDirectTasks(
  scope: HierarchyScope,
  initiative: LinkTarget,
): Task[] {
  return scope.tasks.filter((task) => linksMatch(task.initiative, initiative));
}

/**
 * Every task that rolls up to an initiative: those attached directly, plus
 * everything under each of its projects.
 */
export function initiativeTasks(
  scope: HierarchyScope,
  initiative: LinkTarget,
): Task[] {
  const seen = new Set<string>();
  const out: Task[] = [];
  const push = (task: Task) => {
    if (seen.has(task.path)) return;
    seen.add(task.path);
    out.push(task);
  };

  for (const task of initiativeDirectTasks(scope, initiative)) push(task);
  for (const project of initiativeProjects(scope, initiative)) {
    for (const task of projectTasks(scope, project.path)) push(task);
  }
  return out;
}

export function cycleTasks(scope: HierarchyScope, cycle: LinkTarget): Task[] {
  return scope.tasks.filter((task) => linksMatch(task.cycle, cycle));
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
 * The single primary parent of a task, as a tagged reference (Golden Rule:
 * exactly one). `parent` wins over `project`, which wins over `initiative` —
 * a sub-task's real home is its parent task.
 */
export type PrimaryParent =
  | { kind: "task"; path: LinkTarget }
  | { kind: "project"; path: LinkTarget }
  | { kind: "initiative"; path: LinkTarget }
  | { kind: "none" };

export function primaryParent(task: Task): PrimaryParent {
  if (task.parent) return { kind: "task", path: task.parent };
  if (task.project) return { kind: "project", path: task.project };
  if (task.initiative) return { kind: "initiative", path: task.initiative };
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
 * Sub-task progress bar for a parent task (§7.2). Direct children only — a
 * progress bar that silently counted grandchildren would misrepresent what the
 * user sees listed underneath it.
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
  return computeProgress(childTasks(scope, task.path), statuses);
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
  return computeProgress(projectTasks(scope, project), statuses);
}

export function initiativeProgress(
  scope: HierarchyScope,
  initiative: LinkTarget,
  statuses: Taxonomy,
): Progress {
  return computeProgress(initiativeTasks(scope, initiative), statuses);
}

export function cycleProgress(
  scope: HierarchyScope,
  cycle: LinkTarget,
  statuses: Taxonomy,
): Progress {
  return computeProgress(cycleTasks(scope, cycle), statuses);
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
