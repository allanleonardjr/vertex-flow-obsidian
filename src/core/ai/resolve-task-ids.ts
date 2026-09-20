/**
 * Deterministic resolution of a bare task-ID number fragment in an AI Chat
 * message ("task 0040", "task 40", or just "40") to the real task(s) it
 * refers to — the same principle `query-action.ts` already applies to filter
 * values: a small local model isn't reliable at exact numeric matching
 * against padded/unpadded strings buried in a data table, so this is resolved
 * in code and handed to the model as a fact, never asked of the model itself.
 *
 * A full ID like `TSK-0040` needs none of this — it already appears verbatim
 * in the facts the model sees, so it matches directly. This only covers the
 * bare-number case.
 */

import { parseTaskId } from "../ids";
import type { Task } from "../types";

export interface TaskIdFragmentMatch {
	/** The exact numeric substring as it appeared in the message (e.g. `"0040"` or `"40"`). */
	fragment: string;
	/** Every non-archived task whose id's sequence equals this fragment (usually one; more than one only on a genuine sequence collision). */
	matches: Task[];
}

/**
 * Standalone 2–4 digit runs, word-boundary matched, so "0040" and "40" both
 * count but a longer number like "20480" doesn't (its digits share no
 * boundary at any 2–4-digit slice). A bare single digit ("5") is excluded by
 * the `{2,4}` floor — too likely to be an ordinary number in conversation
 * ("show me 5 tasks") rather than an ID reference, and it's excluded
 * unconditionally, not just when nothing matches, since a coincidental
 * sequence-number hit on a single digit is more likely a false anchor than a
 * real reference.
 */
const ID_FRAGMENT_RE = /\b\d{2,4}\b/g;

/**
 * Finds every numeric ID fragment in `message` that resolves to a real task
 * in `tasks`. A fragment with no matching task is dropped entirely — this is
 * the only filter against ordinary numbers in conversation, deliberately
 * simple rather than a smarter heuristic. Archived tasks are never matched,
 * consistent with them being excluded from AI Chat's default view of a
 * workspace. Scoped to the tasks passed in (the active workspace's own) —
 * this never reaches across workspaces.
 */
export function resolveTaskIdFragments(message: string, tasks: Task[]): TaskIdFragmentMatch[] {
	const fragments = [...new Set(message.match(ID_FRAGMENT_RE) ?? [])];
	if (fragments.length === 0) return [];

	const active = tasks.filter((task) => !task.archived);

	const results: TaskIdFragmentMatch[] = [];
	for (const fragment of fragments) {
		// Strips leading zeros for free — Number.parseInt("0040", 10) === 40.
		const sequence = Number.parseInt(fragment, 10);
		const matches = active.filter((task) => parseTaskId(task.id)?.sequence === sequence);
		if (matches.length > 0) results.push({ fragment, matches });
	}
	return results;
}
