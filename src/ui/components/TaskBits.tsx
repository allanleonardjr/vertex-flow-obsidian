import type { ReactNode } from "react";
import {
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SignalZero,
  Link,
  ListTree,
  Archive,
  Gauge,
} from "lucide-react";
import { basename } from "../../core/links";
import { Icon } from "./Icon";
import { listValues, type WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Task } from "../../core/types";

/** Signal glyphs from weakest to strongest — the buckets a priority maps into. */
const SIGNAL_GLYPHS = [SignalLow, SignalMedium, SignalHigh, Signal] as const;

/**
 * Which glyph a priority at ordered position `index` (0 = highest) gets, given
 * `count` levels in total. The rank — not the name or id — picks the strength,
 * so it works for any number of custom levels ("Hot/Warm/Cold", "P0–P3", …).
 */
function signalLevel(index: number, count: number): number {
  const top = SIGNAL_GLYPHS.length - 1;
  if (count <= 1) return top;
  return Math.round((1 - index / (count - 1)) * top);
}

/**
 * Priority glyph. `index` is the value's position in the ordered
 * priority list (from `listValues`), `null` means "no priority". Tinted with
 * the value's own colour — see `TaxonomyChip` for the usual call site.
 */
export function PriorityIcon({
  index,
  count,
  color,
  name,
}: {
  index: number | null;
  count: number;
  color?: string | null;
  name?: string;
}) {
  if (index == null || index < 0) {
    return (
      <span
        className="vf-priority-icon is-none"
        title={name ?? "No priority"}
        aria-hidden
      >
        <SignalZero size={14} />
      </span>
    );
  }
  const Glyph = SIGNAL_GLYPHS[signalLevel(index, count)];
  return (
    <span
      className="vf-priority-icon"
      style={color ? { color } : undefined}
      title={name}
    >
      <Glyph size={14} />
    </span>
  );
}

/**
 * A single tinted pill: the value's own colour as text over a
 * faint wash of the same colour. The tint + text already carry the colour, so
 * there's no separate dot. This is the canonical way a label or task type
 * renders anywhere in the app (task rows, the sidebar, the editor) — keep it in
 * one place so they never drift.
 */
export function LabelChip({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  const tone = color || "var(--text-muted)";
  return (
    <span
      className={className ? `vf-label-chip ${className}` : "vf-label-chip"}
      style={{ backgroundColor: `${tone}1e`, color: tone }}
    >
      <span className="vf-label-chip-name">{name}</span>
    </span>
  );
}

/** Handles polymorphic taxonomy rendering (Priority icons vs Task Type / Labels) */
export function TaxonomyChip({
  taxonomies,
  kind,
  id,
}: {
  taxonomies: WorkspaceTaxonomies;
  kind: keyof WorkspaceTaxonomies;
  id?: string | null;
}) {
  if (!id) return null;

  const taxonomy = taxonomies[kind];
  // Every `Taxonomy<V>` carries `.values: V[]`, and every `V` extends
  // `TaxonomyValue` (`id`/`name`/`color`), so the lookup needs no `any`.
  const item = taxonomy.values.find((value) => value.id === id);

  if (!item) return null;

  // Priority: a signal glyph whose strength comes from its rank in the ordered
  // list, not a hardcoded id — so custom levels render too.
  if (kind === "priority") {
    const ordered = listValues(taxonomies.priority);
    const index = ordered.findIndex((value) => value.id === id);
    return (
      <PriorityIcon
        index={index}
        count={ordered.length}
        color={item.color}
        name={item.name}
      />
    );
  }

  // Render Labels & Task Types as tinted pills
  return <LabelChip name={item.name} color={item.color} />;
}

export function Labels({
  taxonomies,
  labels,
}: {
  taxonomies: WorkspaceTaxonomies;
  labels?: string[];
}) {
  if (!labels || labels.length === 0) return null;

  return (
    <div className="vf-labels">
      {labels.map((id) => (
        <TaxonomyChip key={id} taxonomies={taxonomies} kind="label" id={id} />
      ))}
    </div>
  );
}

export function StatusDot({
  taxonomies,
  status,
}: {
  taxonomies: WorkspaceTaxonomies;
  status?: string | null;
}) {
  if (!status) return <span className="vf-status-dot" />;
  const item = taxonomies.status.values.find((value) => value.id === status);
  const color = item?.color || "var(--vf-muted)";
  return <span className="vf-status-dot" style={{ backgroundColor: color }} />;
}

/**
 * A completion meter. Renders nothing at all when there's nothing to count,
 * which is what makes it double as the "this has children" signal.
 *
 * `icon`/`title` exist because the bar is ambiguous on its own: on a row or a
 * board card it sits in a meta cluster with no surrounding label, so an
 * unadorned meter doesn't say *what* it's measuring the way the neighbouring
 * relation chip does. Where a heading already says ("Sub-tasks", "Blocked by",
 * a project's own header) the caller leaves both off.
 */
export function ProgressBar({
  progress,
  icon,
  title,
}: {
  progress: { completed: number; total: number };
  icon?: ReactNode;
  title?: string;
}) {
  if (progress.total === 0) return null;
  const pct = Math.round((progress.completed / progress.total) * 100);

  return (
    <div className="vf-progress-wrap" title={title} aria-label={title}>
      {icon && (
        <span className="vf-progress-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="vf-progress">
        <span className="vf-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="vf-progress-count">
        {progress.completed}/{progress.total} done
      </span>
    </div>
  );
}

/**
 * The sub-task meter as it appears on a List row or Board card — icon-led, so
 * "has children" is legible at a glance next to `RelationBadge`. Gated by the
 * `progress` field, same as the bare bar it wraps.
 */
export function SubtaskProgress({
  progress,
}: {
  progress: { completed: number; total: number };
}) {
  if (progress.total === 0) return null;

  return (
    <ProgressBar
      progress={progress}
      icon={<ListTree size={12} />}
      title={`${progress.completed} of ${progress.total} sub-task${
        progress.total === 1 ? "" : "s"
      } done`}
    />
  );
}

/**
 * The task's parent project (the one primary parent a project can be).
 * Suppressed by `renderedHiddenFields` inside a view already scoped to a
 * single project, where it would repeat on every row.
 */
export function ProjectChip({
  task,
  projects,
}: {
  task: Task;
  projects: readonly { path: string; title: string; icon?: string }[];
}) {
  if (!task.project) return null;
  const project = projects.find((p) => p.path === task.project);
  // An unresolvable link still says more than nothing — the basename is what
  // the user typed, and hiding it would make a broken link invisible.
  const label = project?.title ?? basename(task.project);

  return (
    <span className="vf-chip vf-chip-project" title={`Project: ${label}`}>
      {/* The project's own configured icon, same as the sidebar and tab strip
          show it — a chip that disagreed with those would read as a different
          project. Falls back to a folder, including for an unresolved link. */}
      <Icon id={project?.icon} fallback="folder" size={11} />
      {label}
    </span>
  );
}

/**
 * A plain number with the workspace's cosmetic unit suffix. The plugin
 * never calculates on it, so this is display only — no rounding, no totals.
 *
 * The icon is a gauge, not a clock, on purpose: `estimateUnitLabel` defaults to
 * null and the field carries no enforced meaning, so the most likely content is
 * story points — which are explicitly *not* time. A gauge reads as magnitude
 * and stays true whether someone puts points, hours, or anything else here.
 */
export function Estimate({
  task,
  unitLabel,
}: {
  task: Task;
  unitLabel?: string | null;
}) {
  if (task.estimate == null) return null;
  const suffix = unitLabel?.trim();

  return (
    <span
      className="vf-estimate"
      title={`Estimate: ${task.estimate}${suffix ? ` ${suffix}` : ""}`}
    >
      <Gauge size={11} aria-hidden />
      <span>
        {task.estimate}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </span>
  );
}

/**
 * Start date. Deliberately has none of `DueDate`'s today/overdue treatment —
 * a start date that has passed is the normal case for work in progress, not a
 * problem to flag.
 */
export function StartDate({ task }: { task: Task }) {
  if (!task.startDate) return null;

  return (
    <span className="vf-start" title={`Starts ${task.startDate}`}>
      → {task.startDate}
    </span>
  );
}

/**
 * Archived marker. Not a toggleable field — whether archived tasks
 * appear at all is already the per-view `archived` filter's job, and a second
 * control over the same idea would just confuse. Rows and cards are dimmed
 * via `.is-archived`; this says *why* they're dimmed.
 */
export function ArchivedBadge({ task }: { task: Task }) {
  if (!task.archived) return null;

  return (
    <span className="vf-chip vf-chip-archived" title="Archived">
      <Archive size={11} /> Archived
    </span>
  );
}

export function DueDate({ task }: { task: Task }) {
  if (!task.dueDate) return null;

  const today = new Date().toISOString().slice(0, 10);
  const isToday = task.dueDate === today;
  const isOverdue = task.dueDate < today;

  return (
    <span
      className={`vf-due${isToday ? " is-today" : ""}${
        isOverdue ? " is-overdue" : ""
      }`}
    >
      {task.dueDate}
    </span>
  );
}

/**
 * The initials disc a person renders as everywhere — rows, cards, and the
 * editor's Assignee/Owner picker. There are no uploaded avatars (the People
 * register is names, not accounts), so initials are the whole identity.
 */
export function PersonAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <span className="vf-avatar" title={name}>
      {initials}
    </span>
  );
}

export function Assignee({
  people,
  assignee,
}: {
  people: Array<{ id: string; name: string }>;
  assignee?: string | null;
}) {
  if (!assignee) return null;
  const person = people.find((p) => p.id === assignee);

  return <PersonAvatar name={person?.name ?? assignee} />;
}

export function RelationBadge({ task }: { task: Task }) {
  /* const count = Object.values(task.relations ?? {})
    .flat()
    .filter(Boolean).length;
  if (count === 0) return null;

  return <span className="vf-chip">{count} rel</span>; */

  const count = Object.values(task.relations ?? {})
    .flat()
    .filter(Boolean).length;
  if (count === 0) return null;

  const label = `${count} relation${count === 1 ? "" : "s"}`;

  return (
    <span
      className="vf-chip vf-chip-relations"
      title={label}
      aria-label={label}
    >
      <Link size={12} /> {count}
    </span>
  );
}
