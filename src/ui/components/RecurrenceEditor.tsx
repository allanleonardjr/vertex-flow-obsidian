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
  firstOccurrenceOnOrAfter,
  projectOccurrences,
  weekdayName,
  weekdayOf,
} from "../../core/recurrence";
import type {
  RecurrenceConfig,
  RecurrenceFrequency,
  Task,
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
  const anchor: RecurrenceConfig["anchor"] = task.dueDate ? "dueDate" : "startDate";
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
      </div>

      {editing && (
        <RecurrenceEditDialog
          task={task}
          snapshot={snapshot}
          taxonomies={taxonomies}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            void plugin.mutations.updateTask(task, { recurrence: next });
            setEditing(false);
          }}
        />
      )}

      {stopping && (
        <ConfirmDeleteDialog
          title="Stop this repeating task?"
          body={
            summary
              ? `“${summary}” — every occurrence already spawned stays; no new ones are created.`
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

function RecurrenceEditDialog({
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

  // Re-seat nextDate on the chosen anchor field before saving — the schedule
  // fires from a real date on this task, or today if it has none.
  const finalize = (): RecurrenceConfig => {
    const anchorDate =
      (rule.anchor === "dueDate" ? task.dueDate : task.startDate) ??
      localTodayIso();
    return { ...rule, nextDate: anchorDate };
  };

  const preview = useMemo(() => {
    const seed = finalize();
    const today = localTodayIso();
    if (seed.trigger === "on-close") {
      return [firstOccurrenceOnOrAfter(seed, seed.nextDate, today)];
    }
    return projectOccurrences(seed, seed.nextDate, 4);
  }, [rule, task.startDate, task.dueDate]);

  return createPortal(
    <div className="vf-editor-backdrop" onClick={onClose}>
      <div
        className="vf-dialog vf-recurrence-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Repeat</h3>

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
              Empty = the task’s own weekday. Only applies to a weekly (not
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
                    The {label} {weekdayName(weekdayOf(finalize().nextDate))}
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
                          : Math.min(31, Math.max(1, Math.round(dayOfMonth))),
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
                  monthOfYear: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">The task’s own month</option>
              {MONTHS.map((month, i) => (
                <option key={month} value={i + 1}>
                  {month}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Which date repeats">
          <Segmented
            value={rule.anchor}
            options={[
              { value: "dueDate", label: "Due date" },
              { value: "startDate", label: "Start date" },
            ]}
            onChange={(anchor) => patch({ anchor })}
          />
        </Field>

        <Field label="Create the next occurrence">
          <Segmented
            value={rule.trigger}
            options={[
              { value: "on-date", label: "On its date" },
              { value: "on-close", label: "When I close it" },
            ]}
            onChange={(trigger) => patch({ trigger })}
          />
          {rule.trigger === "on-close" && (
            <div className="vf-recurrence-subfield">
              <span className="vf-recurrence-subfield-label">
                Counts as closed when status is
              </span>
              <StatusSelect
                taxonomy={taxonomies.status}
                value={rule.triggerStatus}
                onChange={(triggerStatus) => patch({ triggerStatus })}
              />
              {rule.triggerStatus != null ? (
                <button
                  type="button"
                  className="vf-linkish"
                  onClick={() => patch({ triggerStatus: null })}
                >
                  Use any “done” status instead
                </button>
              ) : (
                <p className="vf-dialog-hint">
                  Any status in the “done” category counts.
                </p>
              )}
            </div>
          )}
          <p className="vf-dialog-hint">
            The schedule above sets each occurrence’s dates — this only sets when
            the next copy appears.
          </p>
        </Field>

        <Field label="Ends">
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
        </Field>

        <div className="vf-recurrence-preview">
          <strong>{describeRecurrence(finalize(), snapshot.workspace.statuses)}</strong>
          <span className="vf-dialog-hint">
            {rule.trigger === "on-close"
              ? `Next occurrence: ${preview[0] ?? "—"} — created once you close this one.`
              : `Next occurrences: ${preview.join(" · ") || "—"}`}
          </span>
        </div>

        {midChain && (
          <p className="vf-dialog-hint">
            This is one occurrence in a series — the change applies to this
            note’s schedule and is carried forward from here.
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
  const base = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[
    freq
  ];
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
