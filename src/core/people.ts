/**
 * Person usage and deletion — parallel to `core/taxonomy/usage.ts`, not built
 * on it. `assignee`/`owner` are plain nullable fields (not a taxonomy value,
 * no color, not part of the four-kind engine), so unlike a required
 * single-select taxonomy, deleting a person is never truly blocked: the
 * fallback is always "clear the field", never "impossible".
 */

import type { Person, Project, Task } from "./types";

export interface PersonUsage {
	count: number;
	assigneeTaskPaths: string[];
	ownerProjectPaths: string[];
	/** Total comments authored by this person (see `VaultIndex.commentCountsByPerson`). */
	commentCount: number;
	mentionTaskPaths: string[];
}

export function findPersonUsage(
	personId: string,
	scope: { tasks: Task[]; projects: Project[]; commentCount: number },
): PersonUsage {
	const assigneeTaskPaths = scope.tasks
		.filter((t) => t.assignee === personId)
		.map((t) => t.path);
	const ownerProjectPaths = scope.projects
		.filter((p) => p.owner === personId)
		.map((p) => p.path);
	const mentionTaskPaths = scope.tasks
		.filter((t) => t.mentions.includes(personId))
		.map((t) => t.path);

	return {
		count: assigneeTaskPaths.length + ownerProjectPaths.length,
		assigneeTaskPaths,
		ownerProjectPaths,
		commentCount: scope.commentCount,
		mentionTaskPaths,
	};
}

/**
 * Short summary for dialog copy: `"3 tasks and 1 project"`. Mentions/comments
 * aren't "usage" that blocks deletion (they're historical, not a live
 * reference), so they're deliberately left out of this count/summary.
 */
export function describePersonUsage(usage: PersonUsage): string {
	const parts: string[] = [];
	const push = (n: number, singular: string) => {
		if (n > 0) parts.push(`${n} ${n === 1 ? singular : `${singular}s`}`);
	};
	push(usage.assigneeTaskPaths.length, "task");
	push(usage.ownerProjectPaths.length, "project");

	if (parts.length === 0) return "nothing";
	if (parts.length === 1) return parts[0];
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface PersonDeletionPlan {
	personId: string;
	personName: string;
	usage: PersonUsage;
	/** Every other person, for the reassign dropdown. */
	replacementCandidates: Person[];
}

export function planPersonDeletion(
	person: Person,
	people: Person[],
	usage: PersonUsage,
): PersonDeletionPlan {
	return {
		personId: person.id,
		personName: person.name,
		usage,
		replacementCandidates: people.filter((p) => p.id !== person.id),
	};
}

/**
 * Sum several per-note comment tallies (each keyed by author id) into one map.
 * The vault-wide roll-up behind `VaultIndex.commentCountsByPerson`, kept here
 * as a pure function so it stays unit-testable.
 */
export function mergeCommentCounts(
	tallies: Iterable<Record<string, number>>,
): Record<string, number> {
	const total: Record<string, number> = {};
	for (const tally of tallies) {
		for (const [id, n] of Object.entries(tally)) {
			total[id] = (total[id] ?? 0) + n;
		}
	}
	return total;
}
