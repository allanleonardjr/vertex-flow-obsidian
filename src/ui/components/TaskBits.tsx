/**
 * The small shared pieces both List and Board render, so a task looks and reads
 * the same wherever it appears.
 */

import { displayColor, displayName, type WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Person, Progress, Task } from "../../core/types";

export function TaxonomyChip({
	taxonomies,
	kind,
	id,
}: {
	taxonomies: WorkspaceTaxonomies;
	kind: "status" | "priority" | "taskType" | "label";
	id: string | null;
}) {
	if (!id) return null;
	const color = displayColor(taxonomies[kind], id);
	return (
		<span className="vf-chip" style={color ? { borderColor: color, color } : undefined}>
			{displayName(taxonomies[kind], id)}
		</span>
	);
}

export function StatusDot({
	taxonomies,
	status,
}: {
	taxonomies: WorkspaceTaxonomies;
	status: string;
}) {
	const color = displayColor(taxonomies.status, status);
	return (
		<span
			className="vf-status-dot"
			style={color ? { backgroundColor: color } : undefined}
			title={displayName(taxonomies.status, status)}
		/>
	);
}

export function Labels({
	taxonomies,
	labels,
}: {
	taxonomies: WorkspaceTaxonomies;
	labels: string[];
}) {
	if (labels.length === 0) return null;
	return (
		<span className="vf-labels">
			{labels.map((id) => (
				<TaxonomyChip key={id} taxonomies={taxonomies} kind="label" id={id} />
			))}
		</span>
	);
}

export function Assignee({
	people,
	assignee,
}: {
	people: Person[];
	assignee: string | null;
}) {
	if (!assignee) return null;
	const person = people.find((p) => p.id === assignee);
	const name = person?.name ?? assignee;
	return (
		<span className="vf-avatar" title={name}>
			{initials(name)}
		</span>
	);
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Sub-task progress bar (§7.2). Shows completion only — it never completes the
 * parent for you.
 */
export function ProgressBar({ progress }: { progress: Progress }) {
	if (progress.total === 0) return null;
	const countable = progress.total - progress.canceled;
	return (
		<span
			className="vf-progress"
			title={`${progress.completed} of ${countable} sub-tasks done`}
		>
			<span className="vf-progress-fill" style={{ width: `${progress.percent}%` }} />
		</span>
	);
}

/** Due date, flagged when it's today or already gone. */
export function DueDate({ task }: { task: Task }) {
	if (!task.dueDate) return null;

	const today = new Date().toISOString().slice(0, 10);
	const due = task.dueDate.slice(0, 10);
	const state = due < today ? "is-overdue" : due === today ? "is-today" : "";

	return (
		<span className={`vf-due ${state}`} title={`Due ${due}`}>
			{formatDate(due)}
		</span>
	);
}

function formatDate(iso: string): string {
	const [, month, day] = iso.split("-");
	const monthName = [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun",
		"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
	][Number.parseInt(month, 10) - 1];
	return `${monthName} ${Number.parseInt(day, 10)}`;
}

/** Blocked/blocking indicator (§7.3). */
export function RelationBadge({ task }: { task: Task }) {
	const blocked = task.relations.blockedBy.length;
	if (blocked === 0) return null;
	return (
		<span className="vf-blocked" title={`Blocked by ${blocked} task(s)`}>
			blocked
		</span>
	);
}
