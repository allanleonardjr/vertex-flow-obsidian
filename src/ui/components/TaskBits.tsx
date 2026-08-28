import { Signal, SignalHigh, SignalLow, SignalMedium, SignalZero } from "lucide-react";
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
 * Linear-style priority glyph. `index` is the value's position in the ordered
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
      <span className="vf-priority-icon is-none" title={name ?? "No priority"} aria-hidden>
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
 * A single Linear-style tinted pill: the value's own colour as text over a
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
  // Assuming the array of items is stored on the `.values` property.
  // If it's different in types.ts (e.g., .options), change it here!
  const item = (taxonomy as any)?.values?.find((i: any) => i.id === id);

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

  // Render Labels & Task Types as Linear-style tinted pills
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
  const item = (taxonomies.status as any)?.values?.find(
    (i: any) => i.id === status,
  );
  const color = item?.color || "var(--vf-muted)";
  return <span className="vf-status-dot" style={{ backgroundColor: color }} />;
}

export function ProgressBar({
  progress,
}: {
  progress: { completed: number; total: number };
}) {
  if (progress.total === 0) return null;
  const pct = Math.round((progress.completed / progress.total) * 100);

  return (
    <div className="vf-progress-wrap">
      <span className="vf-progress">
        <span className="vf-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="vf-progress-count">
        {progress.completed}/{progress.total} done
      </span>
    </div>
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

export function Assignee({
  people,
  assignee,
}: {
  people: Array<{ id: string; name: string }>;
  assignee?: string | null;
}) {
  if (!assignee) return null;
  const person = people.find((p) => p.id === assignee);
  const initials = (person?.name ?? assignee)
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <span className="vf-avatar" title={person?.name ?? assignee}>
      {initials}
    </span>
  );
}

export function RelationBadge({ task }: { task: Task }) {
  const count = Object.values(task.relations ?? {})
    .flat()
    .filter(Boolean).length;
  if (count === 0) return null;

  return <span className="vf-chip">{count} rel</span>;
}
