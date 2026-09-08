/**
 * The exportable task fields, grouped for the dialog's opt-in checklist.
 *
 * Four groups (Identity / Context / Dates / Rich data). Identity defaults on;
 * everything else defaults off. iCalendar only carries a subset — `icalEligible`
 * marks which fields survive a `VEVENT` (see `ics.ts`).
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
	// rich data
	| "description"
	| "comments"
	| "estimate"
	| "relations";

export interface FieldSpec {
	id: FieldId;
	label: string;
	group: FieldGroupId;
	/** Can appear in an iCalendar `VEVENT`. */
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
	id: { id: "id", label: "ID", group: "identity", icalEligible: true, needsDocument: false },
	title: { id: "title", label: "Title", group: "identity", icalEligible: true, needsDocument: false },
	status: { id: "status", label: "Status", group: "identity", icalEligible: true, needsDocument: false },
	priority: { id: "priority", label: "Priority", group: "identity", icalEligible: false, needsDocument: false },
	taskType: { id: "taskType", label: "Task Type", group: "identity", icalEligible: false, needsDocument: false },

	project: { id: "project", label: "Project", group: "context", icalEligible: false, needsDocument: false },
	parent: { id: "parent", label: "Parent", group: "context", icalEligible: false, needsDocument: false },
	assignee: { id: "assignee", label: "Assignee", group: "context", icalEligible: false, needsDocument: false },
	labels: { id: "labels", label: "Labels", group: "context", icalEligible: false, needsDocument: false },

	dueDate: { id: "dueDate", label: "Due Date", group: "dates", icalEligible: true, needsDocument: false },
	startDate: { id: "startDate", label: "Start Date", group: "dates", icalEligible: true, needsDocument: false },
	createdAt: { id: "createdAt", label: "Created", group: "dates", icalEligible: true, needsDocument: false },
	updatedAt: { id: "updatedAt", label: "Updated", group: "dates", icalEligible: true, needsDocument: false },
	archivedAt: { id: "archivedAt", label: "Archived At", group: "dates", icalEligible: false, needsDocument: false },

	description: { id: "description", label: "Description", group: "rich", icalEligible: true, needsDocument: true },
	comments: { id: "comments", label: "Comments", group: "rich", icalEligible: false, needsDocument: true },
	estimate: { id: "estimate", label: "Estimate", group: "rich", icalEligible: false, needsDocument: false },
	relations: { id: "relations", label: "Relations", group: "rich", icalEligible: false, needsDocument: false },
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
		defaultOn: false,
		fields: ["project", "parent", "assignee", "labels"],
	},
	{
		id: "dates",
		label: "Dates",
		defaultOn: false,
		fields: ["dueDate", "startDate", "createdAt", "updatedAt", "archivedAt"],
	},
	{
		id: "rich",
		label: "Rich data",
		defaultOn: false,
		fields: ["description", "comments", "estimate", "relations"],
	},
];

/** Every field id, in canonical column order. */
export const ALL_FIELDS: FieldId[] = FIELD_GROUPS.flatMap((group) => group.fields);

/** The default checked set — the Identity group only. */
export const DEFAULT_FIELDS: FieldId[] = FIELD_GROUPS.filter(
	(group) => group.defaultOn,
).flatMap((group) => group.fields);

/**
 * Narrow a selection to the fields the format can actually carry, keeping
 * canonical order. Only iCalendar restricts anything; CSV and JSON take
 * everything.
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
