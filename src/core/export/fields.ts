/**
 * The exportable task fields, grouped for the dialog's opt-in checklist.
 *
 * Four groups (Identity / Context / Dates / Rich data). Identity defaults on;
 * everything else defaults off.
 *
 * iCalendar is special: a `VEVENT` only offers **description** as a toggle.
 * Its identity fields (UID/SUMMARY), dates (DTSTART/DTEND), status and sync
 * stamps (CREATED/LAST-MODIFIED/SEQUENCE) are all required for the file to be
 * meaningful, so the exporter emits them unconditionally and they have no
 * checkbox — `icalEligible` literally means "offered as an iCalendar toggle."
 */

export type ExportFormat = "csv" | "json" | "ics";

export type FieldGroupId = "identity" | "context" | "dates" | "rich";

export type FieldId =
  // identity
  | "id"
  | "title"
  | "status"
  | "priority"
  | "taskType"
  // context
  | "project"
  | "parent"
  | "assignee"
  | "labels"
  // dates
  | "dueDate"
  | "startDate"
  | "createdAt"
  | "updatedAt"
  | "archivedAt"
  | "completedAt"
  // rich data
  | "description"
  | "comments"
  | "estimate"
  | "relations";

export interface FieldSpec {
  id: FieldId;
  label: string;
  group: FieldGroupId;
  /**
   * Offered as a checkbox in the iCalendar field list. Everything a `VEVENT`
   * else carries (identity, dates, status, sync stamps) is emitted
   * unconditionally and never has a checkbox.
   */
  icalEligible: boolean;
  /** Needs a per-task document fetch in the glue layer (not in the index). */
  needsDocument: boolean;
}

export interface FieldGroup {
  id: FieldGroupId;
  label: string;
  /** Whether the group's fields start checked. */
  defaultOn: boolean;
  fields: FieldId[];
}

export const FIELDS: Record<FieldId, FieldSpec> = {
  id: {
    id: "id",
    label: "ID",
    group: "identity",
    icalEligible: false,
    needsDocument: false,
  },
  title: {
    id: "title",
    label: "Title",
    group: "identity",
    icalEligible: false,
    needsDocument: false,
  },
  status: {
    id: "status",
    label: "Status",
    group: "identity",
    icalEligible: false,
    needsDocument: false,
  },
  priority: {
    id: "priority",
    label: "Priority",
    group: "identity",
    icalEligible: false,
    needsDocument: false,
  },
  taskType: {
    id: "taskType",
    label: "Task Type",
    group: "identity",
    icalEligible: false,
    needsDocument: false,
  },

  project: {
    id: "project",
    label: "Project",
    group: "context",
    icalEligible: false,
    needsDocument: false,
  },
  parent: {
    id: "parent",
    label: "Parent",
    group: "context",
    icalEligible: false,
    needsDocument: false,
  },
  assignee: {
    id: "assignee",
    label: "Assignee",
    group: "context",
    icalEligible: false,
    needsDocument: false,
  },
  labels: {
    id: "labels",
    label: "Labels",
    group: "context",
    icalEligible: false,
    needsDocument: false,
  },

  dueDate: {
    id: "dueDate",
    label: "Due Date",
    group: "dates",
    icalEligible: false,
    needsDocument: false,
  },
  startDate: {
    id: "startDate",
    label: "Start Date",
    group: "dates",
    icalEligible: false,
    needsDocument: false,
  },
  createdAt: {
    id: "createdAt",
    label: "Created",
    group: "dates",
    icalEligible: false,
    needsDocument: false,
  },
  updatedAt: {
    id: "updatedAt",
    label: "Updated",
    group: "dates",
    icalEligible: false,
    needsDocument: false,
  },
  archivedAt: {
    id: "archivedAt",
    label: "Archived At",
    group: "dates",
    icalEligible: false,
    needsDocument: false,
  },
  completedAt: {
    id: "completedAt",
    label: "Completed",
    group: "dates",
    icalEligible: false,
    needsDocument: false,
  },

  description: {
    id: "description",
    label: "Description",
    group: "rich",
    icalEligible: true,
    needsDocument: true,
  },
  comments: {
    id: "comments",
    label: "Comments",
    group: "rich",
    icalEligible: false,
    needsDocument: true,
  },
  estimate: {
    id: "estimate",
    label: "Estimate",
    group: "rich",
    icalEligible: false,
    needsDocument: false,
  },
  relations: {
    id: "relations",
    label: "Relations",
    group: "rich",
    icalEligible: false,
    needsDocument: false,
  },
};

export const FIELD_GROUPS: FieldGroup[] = [
  {
    id: "identity",
    label: "Identity",
    defaultOn: true,
    fields: ["id", "title", "status", "priority", "taskType"],
  },
  {
    id: "context",
    label: "Context",
    defaultOn: true,
    fields: ["project", "parent", "assignee", "labels"],
  },
  {
    id: "dates",
    label: "Dates",
    defaultOn: true,
    fields: ["dueDate", "startDate", "createdAt", "updatedAt", "archivedAt", "completedAt"],
  },
  {
    id: "rich",
    label: "Rich data",
    defaultOn: true,
    fields: ["description", "comments", "estimate", "relations"],
  },
];

/** Every field id, in canonical column order. */
export const ALL_FIELDS: FieldId[] = FIELD_GROUPS.flatMap(
  (group) => group.fields,
);

/**
 * The task fields the iCalendar exporter always writes into every `VEVENT`,
 * regardless of the toggles: UID (`id`), SUMMARY (`title`), STATUS (`status`),
 * DTSTART (`startDate`), DTEND (`dueDate`), CREATED (`createdAt`) and
 * LAST-MODIFIED / SEQUENCE (`updatedAt`). Listed in canonical order and shown
 * in the dialog as a read-only "Mandatory data" group so an `.ics` export is
 * transparent about what it carries.
 */
export const ICS_MANDATORY_FIELDS: FieldId[] = [
  "id",
  "title",
  "status",
  "startDate",
  "dueDate",
  "createdAt",
  "updatedAt",
];

/** The default checked set — the Identity group only. */
export const DEFAULT_FIELDS: FieldId[] = FIELD_GROUPS.filter(
  (group) => group.defaultOn,
).flatMap((group) => group.fields);

/**
 * Narrow a selection to the fields the format can actually carry, keeping
 * canonical order. CSV and JSON take everything; iCalendar only offers
 * `description` (its identity, dates and status are required and emitted
 * unconditionally).
 */
export function fieldsForFormat(
  format: ExportFormat,
  selected: readonly FieldId[],
): FieldId[] {
  const set = new Set(selected);
  return ALL_FIELDS.filter((id) => {
    if (!set.has(id)) return false;
    if (format === "ics") return FIELDS[id].icalEligible;
    return true;
  });
}

/** Whether any selected field requires a per-task document read. */
export function needsDocuments(selected: readonly FieldId[]): boolean {
  return selected.some((id) => FIELDS[id].needsDocument);
}
