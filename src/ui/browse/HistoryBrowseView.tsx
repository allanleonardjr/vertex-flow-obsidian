/**
 * The Activity History hub — one workspace's append-only log, read from its
 * `History/*.md` files (see `src/core/history/` + `HistoryLog`). Two modes:
 *
 *   Feed   — reverse-chronological, day-grouped cards with actor, verb,
 *            target chips and the observed field deltas.
 *   Ledger — a dense mono one-liner per entry, month-grouped (a literal
 *            reading of the log file, for anyone who wants it).
 *
 * Live like the rest of the app: every log write bumps a `HistoryLog`
 * revision and every vault change bumps the index revision, both subscribed
 * through `useSyncExternalStore`. `readEntries` awaits the writer's chain
 * before listing files, so a mutation made in another tab repaints this one
 * in place — nothing to remount, no tab-switch needed.
 *
 * The log is per-workspace and opt-in: when the workspace's `history.enabled`
 * is off the hub shows a short explainer with a single "Enable history"
 * action (a `saveWorkspaceConfig`), mirroring the settings toggle.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { historyPathFor } from "../../core/history";
import type {
  HistoryActor,
  HistoryChange,
  HistoryEntry,
  HistoryTarget,
  WorkspaceSnapshot,
} from "../../core/types";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";
import { BrowseEmpty, BrowseGroupHeader, BrowseHeader, BrowseList, formatRelativeTime } from "./shared";

type ActorFilter =
  | { kind: "all" }
  | { kind: "person"; id: string }
  | { kind: "system"; name: string };
type KindFilter = HistoryTarget["kind"] | "all";

type Mode = "feed" | "ledger";

const KIND_CHIPS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "task", label: "Tasks" },
  { value: "project", label: "Projects" },
  { value: "view", label: "Views" },
  { value: "dashboard", label: "Dashboards" },
  { value: "workspace", label: "Settings" },
];

/** Human verb for each recorded action, for the Feed's "who did what". */
const ACTION_LABEL: Record<string, string> = {
  "task.create": "created",
  "task.update": "updated",
  "task.move": "moved",
  "task.bulk-update": "bulk updated",
  "task.delete": "moved to Trash",
  "task.restore": "restored",
  "task.delete-forever": "deleted forever",
  "project.create": "created",
  "project.update": "updated",
  "project.duplicate": "duplicated",
  "project.delete": "moved to Trash",
  "project.restore": "restored",
  "project.delete-forever": "deleted forever",
  "comment.add": "commented on",
  "comment.delete": "removed a comment on",
  "comment.update": "reacted on",
  "view.create": "created",
  "view.update": "updated",
  "view.delete": "moved to Trash",
  "dashboard.create": "created",
  "dashboard.update": "updated",
  "dashboard.delete": "moved to Trash",
  "workspace.create": "created",
  "workspace.config.update": "changed settings",
  "workspace.delete": "deleted workspace",
  "workspace.restore": "restored workspace",
};

function fieldLabel(field: string): string {
  const FIXED: Record<string, string> = {
    title: "title",
    description: "description",
    status: "status",
    priority: "priority",
    taskType: "type",
    labels: "labels",
    assignee: "assignee",
    owner: "owner",
    project: "project",
    parent: "parent",
    estimate: "estimate",
    startDate: "start date",
    dueDate: "due date",
    archived: "archived",
    name: "name",
    icon: "icon",
    idPrefix: "id prefix",
    deletedAt: "deleted at",
    defaultNewTaskStatus: "default status",
    estimateUnitLabel: "estimate unit",
    comment: "comment",
    reaction: "reaction",
    "archiving.autoArchiveEnabled": "auto-archive",
    "archiving.autoArchiveDays": "auto-archive days",
    "archiving.trashedAt": "trashed at",
    "history.enabled": "history",
  };
  if (FIXED[field] != null) return FIXED[field];

  // Dotted taxonomy/people deltas: `statuses.<id>.name` → `status name`.
  const parts = field.split(".");
  if (parts.length >= 2) {
    const SINGULAR: Record<string, string> = {
      statuses: "status",
      priorities: "priority",
      taskTypes: "type",
      labels: "label",
      people: "person",
    };
    const noun = SINGULAR[parts[0]];
    if (noun) return `${noun} ${parts.slice(2).join(" ")}`.trim();
  }
  return field;
}

function isDateField(field: string): boolean {
  return (
    field === "startDate" ||
    field === "dueDate" ||
    field === "deletedAt" ||
    field === "archivedAt" ||
    field === "trashedAt" ||
    field === "createdAt" ||
    field === "updatedAt" ||
    field === "archiving.trashedAt"
  );
}

function isBooleanField(field: string): boolean {
  return (
    field === "archived" ||
    field === "archiving.autoArchiveEnabled" ||
    field === "history.enabled"
  );
}

/** Render a stored change value for a human. `snapshot` resolves names that
 *  have since been edited or deleted; `plugin` resolves task paths. */
function changeValueText(
  field: string,
  value: unknown,
  snapshot: WorkspaceSnapshot,
  taskIdAt: (path: string) => string | undefined,
): string {
  if (value == null) return "";
  if (isDateField(field) && typeof value === "string") return value.slice(0, 10);
  if (isBooleanField(field)) return value ? "On" : "Off";

  const w = snapshot.workspace;
  const resolveName = (
    id: unknown,
    list: { id: string; name: string }[],
  ): string => {
    const found = list.find((item) => item.id === id);
    return found ? found.name : (id as string);
  };

  switch (field) {
    case "status":
      return resolveName(value, w.statuses);
    case "priority":
      return resolveName(value, w.priorities);
    case "taskType":
      return resolveName(value, w.taskTypes);
    case "assignee":
    case "owner":
      return resolveName(value, w.people);
    case "labels":
      if (Array.isArray(value))
        return value.map((id) => resolveName(id, w.labels)).join(", ");
      break;
    case "project":
      if (typeof value === "string") {
        const project = snapshot.projects.find((p) => p.path === value);
        return (project ? project.title : value) ?? "";
      }
      break;
    case "parent":
      if (typeof value === "string") return taskIdAt(value) ?? value;
      break;
    // `statuses.<id>.name` / `labels.<id>.color` / `people.<id>.name` / …
    default: {
      const parts = field.split(".");
      if (parts.length === 3) return String(value);
    }
  }
  return String(value);
}

function changeText(
  change: HistoryChange,
  snapshot: WorkspaceSnapshot,
  taskIdAt: (path: string) => string | undefined,
): string {
  const label = fieldLabel(change.field);
  const txt = (v: unknown) => changeValueText(change.field, v, snapshot, taskIdAt);
  if (change.to === undefined) return `${label}: ${txt(change.from)} removed`;
  if (change.from === undefined) return `${label}: ${txt(change.to)}`;
  return `${label}: ${txt(change.from)} → ${txt(change.to)}`;
}

type PersonOrSystem =
  | { kind: "person"; id: string }
  | { kind: "system"; name: string };

function verbFor(action: string): string {
  const fixed = ACTION_LABEL[action];
  if (fixed) return fixed;
  if (action === "taxonomy.status.delete") return "removed a status";
  if (action === "taxonomy.priority.delete") return "removed a priority";
  if (action === "taxonomy.taskType.delete") return "removed a task type";
  if (action === "taxonomy.label.delete") return "removed a label";
  if (action === "taxonomy.people.delete") return "removed a person";
  return action.replace(/[._-]/g, " ");
}

function actorKey(actor: PersonOrSystem): string {
  return actor.kind === "person" ? `person:${actor.id}` : `system:${actor.name}`;
}

function actorName(actor: HistoryActor): string {
  return actor.name;
}

function actorInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function matchesActor(filter: ActorFilter, entry: HistoryEntry): boolean {
  if (filter.kind === "all") return true;
  return actorKey(filter) === actorKey(entry.actor);
}

function matchesKind(filter: KindFilter, entry: HistoryEntry): boolean {
  if (filter === "all") return true;
  return entry.targets.some((t) => t.kind === filter);
}

/** Same-day grouping labels — Today / Yesterday / the date otherwise. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 0 && diff < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export function HistoryBrowseView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const plugin = usePlugin();
  const tabs = useTabs();

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>("feed");
  const [actorFilter, setActorFilter] = useState<ActorFilter>({ kind: "all" });
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  // Bulk-update entries render collapsed (a count) until expanded. Keyed by
  // the entry's own `seq:ts`, which is stable per log line.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const enabled = snapshot.workspace.history.enabled;

  // Live, like the rest of the app: any log write (our own mutations) or any
  // vault change (an external hand-edit of a History file) bumps a revision we
  // subscribe to, and the load effect re-runs. `readEntries` awaits the log
  // writer's chain, so a just-recorded entry is always already on disk.
  const history = plugin.history;
  const historyRevision = useSyncExternalStore(
    useCallback((onChange: () => void) => history.subscribe(onChange), [history]),
    useCallback(() => history.revision, [history]),
    useCallback(() => history.revision, [history]),
  );
  const indexRevision = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => plugin.index.subscribe(onChange),
      [plugin],
    ),
    useCallback(() => plugin.index.revision, [plugin]),
    useCallback(() => plugin.index.revision, [plugin]),
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const got = await plugin.history.readEntries(snapshot.workspace.root);
      if (cancelled) return;
      setEntries(got);
      setLoaded(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [plugin, snapshot.workspace.root, historyRevision, indexRevision]);

  // Resolve a task path → its current id for `parent` change values. Returns
  // undefined when the task is trashed or otherwise gone.
  const taskIdAt = (path: string): string | undefined =>
    plugin.index.taskAt(path)?.id;

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) => matchesActor(actorFilter, e) && matchesKind(kindFilter, e),
      ),
    [entries, actorFilter, kindFilter],
  );

  const feedDays = useMemo(() => {
    const days: { key: string; label: string; entries: HistoryEntry[] }[] = [];
    for (const e of [...filtered].reverse()) {
      const key = e.ts.slice(0, 10);
      const last = days[days.length - 1];
      if (last && last.key === key) last.entries.push(e);
      else days.push({ key, label: dayLabel(e.ts), entries: [e] });
    }
    return days;
  }, [filtered]);

  const ledgerMonths = useMemo(() => {
    const months: { key: string; label: string; entries: HistoryEntry[] }[] = [];
    for (const e of filtered) {
      const key = monthKeyOf(e.ts);
      const last = months[months.length - 1];
      if (last && last.key === key) last.entries.push(e);
      else months.push({ key, label: monthLabel(e.ts), entries: [e] });
    }
    return months.reverse();
  }, [filtered]);

  const actorChoices = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; initial: string }>();
    for (const e of entries) {
      const key = actorKey(e.actor);
      if (!seen.has(key))
        seen.set(key, {
          key,
          label: actorName(e.actor),
          initial: actorInitial(actorName(e.actor)),
        });
    }
    return Array.from(seen.values());
  }, [entries]);

  const toggleEnabled = () => {
    void plugin.mutations.saveWorkspaceConfig({
      ...snapshot.workspace,
      history: { ...snapshot.workspace.history, enabled: true },
    });
  };

  const openLogFile = () => {
    // The log lives in a single `History/Year-Month.md` per month. Land the
    // user on the most recent one that has entries (or this month, if the
    // log is empty but enabled).
    const loggedMonths = [...new Set(entries.map((e) => monthKeyOf(e.ts)))].sort();
    const latest = loggedMonths.pop();
    const month = latest ?? new Date().toISOString().slice(0, 7);
    void plugin.mutations.open(historyPathFor(snapshot.workspace.root, `${month}-01T00:00:00Z`), true);
  };

  // Chips stay visible even when a filter empties the list — that's the only
  // way to clear them and get back to the full log. Hidden only when the log
  // has never recorded an entry at all, where there's nothing to filter.
  const filters = enabled &&
    entries.length > 0 && (
    <div className="vf-history-filters">
      <div className="vf-history-filter-row" aria-label="Filter by person">
        {actorChoices.map((c) => {
          const active = actorFilterKey(actorFilter) === c.key;
          return (
            <button
              key={c.key}
              className={`vf-chip-button vf-history-chip${
                active ? " is-on" : ""
              }`}
              onClick={() =>
                setActorFilter((prev) => {
                  const fromKey = actorFilterFromKey(c.key);
                  return prev.kind !== "all" && actorFilterKey(prev) === c.key
                    ? { kind: "all" }
                    : (fromKey ?? { kind: "all" });
                })
              }
            >
              <span className="vf-history-avatar vf-history-avatar-sm">
                {c.initial}
              </span>
              {c.label}
            </button>
          );
        })}
      </div>
      <div className="vf-history-filter-row" aria-label="Filter by kind">
        {KIND_CHIPS.map((k) => (
          <button
            key={k.value}
            className={`vf-chip-button vf-history-chip${
              kindFilter === k.value ? " is-on" : ""
            }`}
            onClick={() =>
              setKindFilter((prev) => (prev === k.value ? "all" : k.value))
            }
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="vf-browse">
      <BrowseHeader
        title="History"
        noun="entry"
        count={enabled ? filtered.length : 0}
        idPrefix={enabled ? snapshot.workspace.idPrefix : undefined}
      >
        {enabled && (
          <>
            <div className="vf-history-mode" role="tablist" aria-label="History view">
              {(["feed", "ledger"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  className={`vf-history-mode-btn${mode === m ? " is-on" : ""}`}
                  onClick={() => setMode(m)}
                >
                  {m === "feed" ? "Feed" : "Ledger"}
                </button>
              ))}
            </div>
            <button className="vf-history-open" onClick={openLogFile}>
              Open log file
            </button>
          </>
        )}
      </BrowseHeader>

      {!enabled ? (
        <BrowseList>
          <div className="vf-history-off">
            <p>Activity history is off.</p>
            <p className="vf-empty-note">
              Turning it on records this workspace's changes — who did what, and
              when — to a plain Markdown log under <code>History/</code>. It's a
              hand-editable local file, not a formal audit log.
            </p>
            <div className="vf-history-off-actions">
              <button className="mod-cta" onClick={toggleEnabled}>
                Enable history
              </button>
              <button
                className="vf-menu-item"
                onClick={() => tabs.openScreen("settings")}
              >
                Workspace settings
              </button>
            </div>
          </div>
        </BrowseList>
      ) : !loaded ? (
        <BrowseList>
          <div />
        </BrowseList>
      ) : (
        <>
          {filters}
          {filtered.length === 0 ? (
            <BrowseList>
              {entries.length === 0 ? (
                <BrowseEmpty label="history yet" />
              ) : (
                <BrowseEmpty label="history entries match these filters" />
              )}
            </BrowseList>
          ) : mode === "feed" ? (
            <BrowseList>
              {feedDays.map((day) => (
                <div key={day.key}>
                  <BrowseGroupHeader label={day.label} count={day.entries.length} />
                  {day.entries.map((e) => (
                    <FeedEntry
                      key={entryKey(e)}
                      entry={e}
                      snapshot={snapshot}
                      taskIdAt={taskIdAt}
                      expanded={expanded[entryKey(e)] ?? false}
                      onToggleExpand={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [entryKey(e)]: !(prev[entryKey(e)] ?? false),
                        }))
                      }
                      onOpenTask={(path) => tabs.openTask(path)}
                      onOpenProject={(path) => tabs.openProject(path)}
                    />
                  ))}
                </div>
              ))}
            </BrowseList>
          ) : (
            <BrowseList>
              {ledgerMonths.map((month) => (
                <div key={month.key}>
                  <BrowseGroupHeader label={month.label} count={month.entries.length} />
                  {month.entries.map((e) => (
                    <LedgerLine key={entryKey(e)} entry={e} snapshot={snapshot} taskIdAt={taskIdAt} />
                  ))}
                </div>
              ))}
            </BrowseList>
          )}
        </>
      )}
    </div>
  );
}

function entryKey(e: HistoryEntry): string {
  return `${e.seq}:${e.ts}`;
}

function actorFilterKey(filter: ActorFilter): string {
  return filter.kind === "all" ? "" : actorKey(filter);
}

function actorFilterFromKey(key: string): ActorFilter | null {
  if (key.startsWith("person:")) return { kind: "person", id: key.slice(7) };
  if (key.startsWith("system:")) return { kind: "system", name: key.slice(7) };
  return null;
}

function FeedEntry({
  entry,
  snapshot,
  taskIdAt,
  expanded,
  onToggleExpand,
  onOpenTask,
  onOpenProject,
}: {
  entry: HistoryEntry;
  snapshot: WorkspaceSnapshot;
  taskIdAt: (path: string) => string | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpenTask: (path: string) => void;
  onOpenProject: (path: string) => void;
}) {
  const verb = verbFor(entry.action);
  const isBulk = entry.action === "task.bulk-update";
  const targetChips =
    entry.targets.length === 0
      ? null
      : entry.targets.length <= 3
        ? entry.targets
        : entry.targets.slice(0, 3);

  // Aggregated change rows for bulk updates: identical (field, from, to)
  // triples collapse to "×N". Derived at view time — the log stays raw.
  const changes = entry.changes ?? [];
  const grouped = useMemo(() => {
    if (!isBulk) return changes.map((c) => ({ count: 1, change: c }));
    const map = new Map<string, { count: number; change: HistoryChange }>();
    for (const c of changes) {
      const key = JSON.stringify([c.field, c.from, c.to]);
      const hit = map.get(key);
      if (hit) hit.count += 1;
      else map.set(key, { count: 1, change: c });
    }
    return Array.from(map.values());
  }, [isBulk, changes]);

  const showRows = expanded || !isBulk ? grouped : grouped.slice(0, 3);
  const tail = isBulk && !expanded ? grouped.length - showRows.length : 0;

  return (
    <div className="vf-history-entry">
      <div className="vf-history-line">
        <span className="vf-history-avatar">{actorInitial(actorName(entry.actor))}</span>
        <span className="vf-history-who">{actorName(entry.actor)}</span>
        <span className="vf-history-verb">
          {verb}
          {isBulk && (
            <span className="vf-history-count"> {entry.targets.length}</span>
          )}
        </span>
        {targetChips && (
          <span className="vf-history-targets">
            {targetChips.map((t) => (
              <TargetChip
                key={`${t.kind}:${t.id}`}
                target={t}
                onOpenTask={onOpenTask}
                onOpenProject={onOpenProject}
              />
            ))}
            {entry.targets.length > targetChips.length && (
              <span className="vf-history-chip vf-history-chip-more">
                +{entry.targets.length - targetChips.length} more
              </span>
            )}
          </span>
        )}
        <span className="vf-history-time">
          {formatRelativeTime(entry.ts)}
        </span>
      </div>
      {showRows.length > 0 && (
        <div className="vf-history-changes">
          {showRows.map(({ count, change }, i) => (
            <div className="vf-history-change" key={i}>
              {changeText(change, snapshot, taskIdAt)}
              {count > 1 && <span className="vf-history-count"> ×{count}</span>}
            </div>
          ))}
          {tail > 0 && (
            <button
              className="vf-history-expand"
              onClick={onToggleExpand}
            >
              {tail} more change{tail === 1 ? "" : "s"}
            </button>
          )}
          {isBulk && expanded && grouped.length > 3 && (
            <button className="vf-history-expand" onClick={onToggleExpand}>
              collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TargetChip({
  target,
  onOpenTask,
  onOpenProject,
}: {
  target: HistoryTarget;
  onOpenTask: (path: string) => void;
  onOpenProject: (path: string) => void;
}) {
  const plugin = usePlugin();

  if (target.kind === "task") {
    const live = plugin.index.taskAt(target.path) != null;
    return live ? (
      <button className="vf-history-chip" onClick={() => onOpenTask(target.path)}>
        {target.id}
      </button>
    ) : (
      <span className="vf-history-chip is-dead">{target.id}</span>
    );
  }
  if (target.kind === "project") {
    const live = plugin.index.workspaceFor(target.path)?.projects.some(
      (p) => p.path === target.path,
    );
    return live ? (
      <button className="vf-history-chip" onClick={() => onOpenProject(target.path)}>
        {target.id}
      </button>
    ) : (
      <span className="vf-history-chip is-dead">{target.id}</span>
    );
  }
  return <span className="vf-history-chip">{target.id}</span>;
}

function LedgerLine({
  entry,
  snapshot,
  taskIdAt,
}: {
  entry: HistoryEntry;
  snapshot: WorkspaceSnapshot;
  taskIdAt: (path: string) => string | undefined;
}) {
  const verb = verbFor(entry.action);
  const targetLabel =
    entry.targets.map((t) => t.id).join(", ") || entry.action;
  const desc = (entry.changes ?? [])
    .slice(0, 2)
    .map((c) => changeText(c, snapshot, taskIdAt))
    .join(" · ");
  const more = (entry.changes?.length ?? 0) > 2;
  const time = entry.ts.replace("T", " ").slice(0, 16);

  return (
    <div className="vf-ledger-line">
      <span className="vf-ledger-ts">{time}</span>
      <span className="vf-ledger-who">{actorName(entry.actor)}</span>
      <span className="vf-ledger-action">
        {verb} <span className="vf-ledger-target">{targetLabel}</span>
      </span>
      {desc && <span className="vf-ledger-changes">{desc}</span>}
      {more && <span className="vf-ledger-more">…</span>}
    </div>
  );
}