/**
 * The task editor's **Repeat** row and its set-up dialog.
 *
 * The row shows the one-line `describeRecurrence` summary (or "None") plus
 * Edit / Stop affordances. The dialog authors a `RecurrenceConfig` — trigger,
 * cadence, anchor, optional end conditions — with a live preview of the next
 * few landings. Everything the dialog needs to describe a schedule comes from
 * `src/core/recurrence`; this file only collects the fields.
 *
 * Editing a mid-chain occurrence only rewrites *that* node's block — the
 * engine carries the change forward on the next spawn — so the dialog says so.
 */

import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { localTodayIso } from "../../core/date";
import {
  describeRecurrence,
  nextOccurrence,
  projectOccurrences,
  weekdayName,
  weekdayOf,
} from "../../core/recurrence";
import type {
  RecurrenceConfig,
  RecurrenceFrequency,
  Task,
  TaskFieldKey,
  Weekday,
  WorkspaceSnapshot,
} from "../../core/types";
import { WEEKDAYS } from "../../core/types";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { NumberField, PropertyRow, StatusSelect } from "./fields";
import { usePlugin } from "../context";

const FREQUENCIES: { id: RecurrenceFrequency; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

const WEEKDAY_LABEL: Record<Weekday, string> = {
  sun: "S",
  mon: "M",
  tue: "T",
  wed: "W",
  thu: "T",
  fri: "F",
  sat: "S",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const NTH_LABELS = ["first", "second", "third", "fourth", "last"];

/** A fresh schedule seeded from whatever dates the task already carries. */
function defaultRule(task: Task): RecurrenceConfig {
  const anchor: RecurrenceConfig["anchor"] = task.dueDate
    ? "dueDate"
    : "startDate";
  const anchorDate =
    (anchor === "dueDate" ? task.dueDate : task.startDate) ?? localTodayIso();
  return {
    trigger: "on-date",
    triggerStatus: null,
    freq: "weekly",
    interval: 1,
    weekdays: [],
    dayOfMonth: null,
    weekdayOfMonth: null,
    monthOfYear: null,
    anchor,
    newStatus: null,
    endsAfter: null,
    endsOn: null,
    nextDate: anchorDate,
    copyFields: null,
  };
}

export function RepeatRow({
  task,
  snapshot,
  taxonomies,
}: {
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
}) {
  const plugin = usePlugin();
  const [editing, setEditing] = useState(false);
  const [stopping, setStopping] = useState(false);

  const rule = task.recurrence;
  const summary = rule
    ? describeRecurrence(rule, snapshot.workspace.statuses)
    : null;

  // Check if task has children in the current snapshot
  const hasChildren = snapshot.tasks.some((t) => t.parent === task.path);
  const childCount = snapshot.tasks.filter(
    (t) => t.parent === task.path,
  ).length;

  return (
    <PropertyRow label="Repeat">
      <div className="vf-repeat-row">
        {summary ? (
          <>
            <span className="vf-repeat-summary" title={summary}>
              {summary}
            </span>
            <span className="vf-repeat-actions">
              <button
                type="button"
                className="vf-linkish"
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
              <button
                type="button"
                className="vf-linkish vf-linkish-warn"
                onClick={() => setStopping(true)}
              >
                Stop
              </button>
            </span>
          </>
        ) : (
          <button
            type="button"
            className="vf-linkish"
            onClick={() => setEditing(true)}
          >
            Set up…
          </button>
        )}
        {hasChildren && (
          <span
            className="vf-repeat-children-hint"
            title={`This task has ${childCount} sub-task${childCount === 1 ? "" : "s"} — they won't carry over to future occurrences.`}
          >
            ⚠ {childCount} sub-task{childCount === 1 ? "" : "s"} won't repeat
          </span>
        )}
        {task.archived && (
          <span
            className="vf-repeat-children-hint"
            title="Archived tasks don't spawn new occurrences. Un-archive this task to resume its schedule."
          >
            ⚠ Archived — repeats paused
          </span>
        )}
      </div>

      {editing && (
        <RecurrenceEditDialog
          task={task}
          snapshot={snapshot}
          taxonomies={taxonomies}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            void plugin.mutations.setRecurrence(task, next);
            setEditing(false);
          }}
        />
      )}

      {stopping && (
        <ConfirmDeleteDialog
          title="Stop this repeating task?"
          body={
            summary
              ? `“${summary}” — no files are removed, but every task in this series, including ones already spawned, will have its repeat schedule cleared.`
              : undefined
          }
          confirmLabel="Stop repeating"
          destructive={false}
          onCancel={() => setStopping(false)}
          onConfirm={() => {
            void plugin.mutations.stopRecurrence(task);
            setStopping(false);
          }}
        />
      )}
    </PropertyRow>
  );
}

export function RecurrenceEditDialog({
  task,
  snapshot,
  taxonomies,
  onClose,
  onSave,
}: {
  task: Task;
  snapshot: WorkspaceSnapshot;
  taxonomies: WorkspaceTaxonomies;
  onClose: () => void;
  onSave: (rule: RecurrenceConfig | null) => void;
}) {
  const [rule, setRule] = useState<RecurrenceConfig>(
    () => task.recurrence ?? defaultRule(task),
  );
  const patch = (part: Partial<RecurrenceConfig>) =>
    setRule((current) => ({ ...current, ...part }));

  const midChain = task.recurringFrom != null;

  // Check if task has children
  const hasChildren = snapshot.tasks.some((t) => t.parent === task.path);
  const childCount = snapshot.tasks.filter(
    (t) => t.parent === task.path,
  ).length;

  // Re-seat nextDate on the chosen anchor field before saving — the schedule
  // fires from a real date on this task, or today if it has none.
  const finalize = (): RecurrenceConfig => {
    // Status-driven mode has no cadence and no date to seed — the rule
    // stands as authored.
    if (rule.trigger === "on-close") return rule;
    const existing = rule.anchor === "dueDate" ? task.dueDate : task.startDate;
    // Seed one cadence strictly after the anchor: the task's own date is
    // *this* occurrence, not a landing the series should duplicate — so a
    // weekly repeat on a due-date task lands a week later, never "same
    // day". With no date to anchor to, seed one cadence step past today
    // rather than today itself — otherwise the very first occurrence
    // fires on the next reconcile instead of waiting a full cycle.
    const anchorDate = existing ?? localTodayIso();
    return { ...rule, nextDate: nextOccurrence(rule, anchorDate) };
  };

  const preview = useMemo(() => {
    if (rule.trigger === "on-close") return [];
    const seed = finalize();
    return projectOccurrences(seed, seed.nextDate, 4);
  }, [rule, task.startDate, task.dueDate]);

  // Track expanded state for "Ends" section
  const [endsExpanded, setEndsExpanded] = useState(
    rule.endsAfter != null || rule.endsOn != null,
  );

  // Carries forward fields - default all on for new rules
  const COPYABLE_FIELDS: { key: TaskFieldKey; label: string }[] = [
    { key: "priority", label: "Priority" },
    { key: "taskType", label: "Task Type" },
    { key: "assignee", label: "Assignee" },
    { key: "estimate", label: "Estimate" },
    { key: "labels", label: "Labels" },
    { key: "description", label: "Description" },
    { key: "project", label: "Project" },
    { key: "parent", label: "Parent" },
  ];

  const copyFields = rule.copyFields ?? COPYABLE_FIELDS.map((f) => f.key);

  const toggleCopyField = (key: TaskFieldKey) => {
    const current = rule.copyFields ?? COPYABLE_FIELDS.map((f) => f.key);
    patch({
      copyFields: current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    });
  };

  return createPortal(
    <div className="vf-editor-backdrop" onClick={onClose}>
      <div
        className="vf-dialog vf-recurrence-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Repeat</h3>

        {/* Live preview at the top */}
        <div className="vf-recurrence-preview">
          <strong>
            {describeRecurrence(finalize(), snapshot.workspace.statuses)}
          </strong>
          <span className="vf-dialog-hint">
            {rule.trigger === "on-close"
              ? "Creates a new task the moment this one matches."
              : `Next occurrences: ${preview.join(" · ") || "—"}`}
          </span>
        </div>

        <Field label="Next occurrence appears">
          <Segmented
            value={rule.trigger}
            options={[
              { value: "on-date", label: "As soon as it's due" },
              { value: "on-close", label: "Only once it reaches a status" },
            ]}
            onChange={(trigger) =>
              patch(
                trigger === "on-close"
                  ? {
                      trigger,
                      onCloseStartDateMode:
                        rule.onCloseStartDateMode ?? "immediate",
                      onCloseDueDateMode:
                        rule.onCloseDueDateMode ?? "immediate",
                    }
                  : { trigger },
              )
            }
          />
          {rule.trigger === "on-close" && (
            <>
              <div className="vf-recurrence-subfield">
                <span className="vf-recurrence-subfield-label">
                  Fires when status is
                </span>
                <StatusSelect
                  taxonomy={taxonomies.status}
                  value={rule.triggerStatus}
                  onChange={(triggerStatus) => patch({ triggerStatus })}
                  noneLabel="Any Completed status"
                />
                {rule.triggerStatus != null ? (
                  <button
                    type="button"
                    className="vf-linkish"
                    onClick={() => patch({ triggerStatus: null })}
                  >
                    Use any Completed status instead
                  </button>
                ) : (
                  <p className="vf-dialog-hint">
                    Any status in the Completed category counts.
                  </p>
                )}
              </div>

              <div className="vf-recurrence-subfield">
                <span className="vf-recurrence-subfield-label">Start Date</span>
                <Segmented
                  value={rule.onCloseStartDateMode ?? "immediate"}
                  options={[
                    { value: "none", label: "None" },
                    { value: "immediate", label: "Immediately" },
                    { value: "shifted", label: "Shifted" },
                  ]}
                  onChange={(onCloseStartDateMode) =>
                    patch({ onCloseStartDateMode })
                  }
                />
              </div>
              <div className="vf-recurrence-subfield">
                <span className="vf-recurrence-subfield-label">Due Date</span>
                <Segmented
                  value={rule.onCloseDueDateMode ?? "immediate"}
                  options={[
                    { value: "none", label: "None" },
                    { value: "immediate", label: "Immediately" },
                    { value: "shifted", label: "Shifted" },
                  ]}
                  onChange={(onCloseDueDateMode) =>
                    patch({ onCloseDueDateMode })
                  }
                />
              </div>
              {(rule.onCloseStartDateMode === "shifted" ||
                rule.onCloseDueDateMode === "shifted") && (
                <Field label="Shift relative to">
                  <Segmented
                    value={rule.anchor}
                    options={[
                      { value: "dueDate", label: "Due date" },
                      { value: "startDate", label: "Start date" },
                    ]}
                    onChange={(anchor) => patch({ anchor })}
                  />
                  <p className="vf-dialog-hint">
                    “Shifted” preserves this task's start↔due range, landing
                    the date above on the day the occurrence spawns.
                  </p>
                </Field>
              )}
            </>
          )}
        </Field>

        {rule.trigger === "on-date" && (
          <>
            <Field label="Frequency">
              <div className="vf-chip-group" role="group">
                {FREQUENCIES.map((freq) => (
                  <button
                    key={freq.id}
                    type="button"
                    className={`vf-chip-btn${rule.freq === freq.id ? " is-on" : ""}`}
                    aria-pressed={rule.freq === freq.id}
                    onClick={() => patch({ freq: freq.id })}
                  >
                    {freq.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Every">
              <div className="vf-inline-field">
                <NumberField
                  value={rule.interval}
                  onChange={(interval) =>
                    patch({ interval: Math.max(1, Math.round(interval ?? 1)) })
                  }
                />
                <span>{intervalUnit(rule.freq, rule.interval)}</span>
              </div>
            </Field>

            {rule.freq === "weekly" && (
              <Field label="On days">
                <div className="vf-chip-group" role="group">
                  {WEEKDAYS.map((day) => {
                    const on = rule.weekdays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`vf-chip-btn vf-chip-day${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        onClick={() =>
                          patch({
                            weekdays: on
                              ? rule.weekdays.filter((d) => d !== day)
                              : [...rule.weekdays, day],
                          })
                        }
                      >
                        {WEEKDAY_LABEL[day]}
                      </button>
                    );
                  })}
                </div>
                <p className="vf-dialog-hint">
                  Empty = the task's own weekday. Only applies to a weekly (not
                  multi-week) cadence.
                </p>
              </Field>
            )}

            {rule.freq === "monthly" && (
              <Field label="Monthly pattern">
                <Segmented
                  value={rule.weekdayOfMonth != null ? "nth" : "day"}
                  options={[
                    { value: "day", label: "Day of month" },
                    { value: "nth", label: "Nth weekday" },
                  ]}
                  onChange={(mode) =>
                    mode === "nth"
                      ? patch({ dayOfMonth: null, weekdayOfMonth: 1 })
                      : patch({ weekdayOfMonth: null, dayOfMonth: null })
                  }
                />
                {rule.weekdayOfMonth != null ? (
                  <select
                    className="vf-input"
                    value={rule.weekdayOfMonth}
                    onChange={(e) =>
                      patch({ weekdayOfMonth: Number(e.target.value) })
                    }
                  >
                    {NTH_LABELS.map((label, i) => (
                      <option key={label} value={i + 1}>
                        The {label}{" "}
                        {weekdayName(weekdayOf(finalize().nextDate))}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="vf-inline-field">
                    <span>On the</span>
                    <NumberField
                      value={rule.dayOfMonth}
                      placeholder="1–31"
                      onChange={(dayOfMonth) =>
                        patch({
                          dayOfMonth:
                            dayOfMonth == null
                              ? null
                              : Math.min(
                                  31,
                                  Math.max(1, Math.round(dayOfMonth)),
                                ),
                        })
                      }
                    />
                  </div>
                )}
              </Field>
            )}

            {rule.freq === "yearly" && (
              <Field label="In month">
                <select
                  className="vf-input"
                  value={rule.monthOfYear ?? ""}
                  onChange={(e) =>
                    patch({
                      monthOfYear: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                >
                  <option value="">The task's own month</option>
                  {MONTHS.map((month, i) => (
                    <option key={month} value={i + 1}>
                      {month}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {/* Anchor choice - on-date only; a date can be added to the task later */}
            <Field label="Which date repeats">
              <Segmented
                value={rule.anchor}
                options={[
                  { value: "dueDate", label: "Due date" },
                  { value: "startDate", label: "Start date" },
                ]}
                onChange={(anchor) => patch({ anchor })}
              />
              <p className="vf-dialog-hint">
                Uses today's date to schedule the next occurrence until this
                field is filled in on the task.
              </p>
            </Field>
          </>
        )}

        {/* Carries forward chip group */}
        <Field label="Carries forward">
          <div className="vf-chip-group" role="group">
            {COPYABLE_FIELDS.map((field) => {
              const on = copyFields.includes(field.key);
              return (
                <button
                  key={field.key}
                  type="button"
                  className={`vf-chip-btn${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleCopyField(field.key)}
                >
                  {field.label}
                </button>
              );
            })}
          </div>
          <p className="vf-dialog-hint">
            Unchecked fields will be reset to empty on each new occurrence.
            Title is always carried forward. Unchecking Project or Parent leaves
            new occurrences unfiled or top-level.
          </p>
        </Field>

        {/* Ends - collapsible */}
        <Field label="Ends">
          {endsExpanded ? (
            <>
              <div className="vf-inline-field">
                <span>after</span>
                <NumberField
                  value={rule.endsAfter}
                  placeholder="∞"
                  onChange={(endsAfter) =>
                    patch({
                      endsAfter:
                        endsAfter == null
                          ? null
                          : Math.max(1, Math.round(endsAfter)),
                    })
                  }
                />
                <span>occurrences</span>
              </div>
              <div className="vf-inline-field">
                <span>or on</span>
                <input
                  className="vf-input"
                  type="date"
                  value={rule.endsOn ?? ""}
                  onChange={(e) => patch({ endsOn: e.target.value || null })}
                />
              </div>
              <button
                type="button"
                className="vf-linkish"
                onClick={() => setEndsExpanded(false)}
              >
                Remove end condition
              </button>
            </>
          ) : (
            <button
              type="button"
              className="vf-linkish"
              onClick={() => setEndsExpanded(true)}
            >
              Add an end condition
            </button>
          )}
        </Field>

        {hasChildren && (
          <p className="vf-dialog-hint vf-dialog-warning">
            This task has {childCount} sub-task{childCount === 1 ? "" : "s"} —
            they won't carry over to future occurrences.
          </p>
        )}

        {midChain && (
          <p className="vf-dialog-hint">
            This is one occurrence in a series — the change applies to this
            note's schedule and is carried forward from here.
          </p>
        )}

        <div className="vf-dialog-actions">
          {task.recurrence && (
            <button
              type="button"
              className="vf-linkish vf-linkish-warn"
              onClick={() => onSave(null)}
            >
              Turn off
            </button>
          )}
          <span className="vf-editor-spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="mod-cta"
            onClick={() => onSave(finalize())}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function intervalUnit(freq: RecurrenceFrequency, interval: number): string {
  const n = Math.max(1, interval);
  const base = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  }[freq];
  return n === 1 ? base : `${base}s`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="vf-recurrence-field">
      <span className="vf-recurrence-field-label">{label}</span>
      <div className="vf-recurrence-field-body">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="vf-segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`vf-segmented-item${value === option.value ? " is-on" : ""}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
