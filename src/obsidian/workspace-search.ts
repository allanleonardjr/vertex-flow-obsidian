/**
 * The candidate builder + ranking behind the Option/Alt+K workspace-search
 * overlay (`src/ui/WorkspaceSearch.tsx`).
 *
 * This touches Obsidian's own fuzzy matcher (`prepareFuzzySearch`), so it lives
 * under `src/obsidian/`, not `src/core/` — the Golden Rule keeps `prepareFuzzySearch`
 * out of the unit-testable core. Everything else here is a pure function over a
 * `WorkspaceSnapshot` plus the index's description cache.
 */

import { prepareFuzzySearch, type SearchMatches } from "obsidian";
import type { WorkspaceSnapshot } from "../core/types";
import type { VaultIndex } from "./index-store";

export type SearchResultKind =
	| "task"
	| "project"
	| "view"
	| "dashboard"
	| "label"
	| "person";

export interface SearchResultItem {
	kind: SearchResultKind;
	/** task/project path, or view/dashboard/label/person id. */
	id: string;
	title: string;
	titleMatches: SearchMatches | null;
	/** Task's formatted ID (e.g. "PRD-0104"), task kind only. */
	taskId?: string;
	snippet?: string;
	snippetMatches?: SearchMatches | null;
	/** Curated icon id, when the kind carries one. */
	icon?: string;
	/** Label swatch colour. */
	color?: string;
	/** Person name, for the avatar. */
	personName?: string;
	score: number;
}

/** Max rows shown per kind — keeps the overlay compact (mirrors Raycast). */
export const PER_KIND_CAP = 5;

/** One entity, reduced to the fields the matcher and the row renderer need. */
interface Candidate {
	kind: SearchResultKind;
	id: string;
	title: string;
	/** Description / snippet source text; "" when the kind has none. */
	snippetSource: string;
	/** Extra text matched but never displayed (person aliases). */
	extraMatchText?: string;
	/** Task's formatted ID — matched and displayed, task kind only. */
	taskId?: string;
	icon?: string;
	color?: string;
	personName?: string;
}

function buildCandidates(
	snapshot: WorkspaceSnapshot,
	index: VaultIndex,
): Candidate[] {
	const candidates: Candidate[] = [];

	for (const task of snapshot.tasks) {
		if (task.archived || task.projected) continue;
		candidates.push({
			kind: "task",
			id: task.path,
			title: task.title,
			snippetSource: index.taskDescription(task.path),
			taskId: task.id,
			icon: task.taskType ?? undefined,
		});
	}

	for (const project of snapshot.projects) {
		if (project.archived) continue;
		candidates.push({
			kind: "project",
			id: project.path,
			title: project.title,
			snippetSource: index.projectDescription(project.path),
			icon: project.icon,
		});
	}

	for (const view of snapshot.views) {
		candidates.push({
			kind: "view",
			id: view.id,
			title: view.name,
			snippetSource: view.description ?? "",
			icon: view.icon,
		});
	}

	for (const dashboard of snapshot.dashboards) {
		candidates.push({
			kind: "dashboard",
			id: dashboard.id,
			title: dashboard.name,
			snippetSource: dashboard.description ?? "",
			icon: dashboard.icon,
		});
	}

	for (const label of snapshot.workspace.labels) {
		candidates.push({
			kind: "label",
			id: label.id,
			title: label.name,
			snippetSource: label.description ?? "",
			color: label.color,
		});
	}

	for (const person of snapshot.workspace.people) {
		candidates.push({
			kind: "person",
			id: person.id,
			title: person.name,
			snippetSource: "",
			extraMatchText: (person.aliases ?? []).join(" "),
			personName: person.name,
		});
	}

	return candidates;
}

/**
 * Rank every entity in the active workspace against `query`, returning the flat
 * list already sorted by score (descending) and capped at {@link PER_KIND_CAP}
 * per kind. The UI groups by `kind` for rendering. Empty for a blank query.
 */
export function searchWorkspace(
	snapshot: WorkspaceSnapshot,
	index: VaultIndex,
	query: string,
): SearchResultItem[] {
	if (!query.trim()) return [];

	const match = prepareFuzzySearch(query);
	const matched: SearchResultItem[] = [];

	for (const candidate of buildCandidates(snapshot, index)) {
		const titleResult = match(candidate.title);
		const taskIdResult = candidate.taskId ? match(candidate.taskId) : null;
		const snippetResult = candidate.snippetSource
			? match(candidate.snippetSource)
			: null;
		const aliasResult = candidate.extraMatchText
			? match(candidate.extraMatchText)
			: null;

		// Prefer a title hit: show the description as a plain (unhighlighted)
		// snippet. Otherwise a task-ID hit (e.g. "PRD-0104" or a "PRD" prefix,
		// shown plain — highlighting a short ID chip isn't worth the complexity).
		// Otherwise fall back to a description hit (highlighted), then to an
		// alias hit (title shown plain, nothing highlighted).
		let score: number;
		let titleMatches: SearchMatches | null = null;
		let snippetMatches: SearchMatches | null = null;

		if (titleResult) {
			score = titleResult.score;
			titleMatches = titleResult.matches;
		} else if (taskIdResult) {
			score = taskIdResult.score;
		} else if (snippetResult) {
			score = snippetResult.score;
			snippetMatches = snippetResult.matches;
		} else if (aliasResult) {
			score = aliasResult.score;
		} else {
			continue;
		}

		matched.push({
			kind: candidate.kind,
			id: candidate.id,
			title: candidate.title,
			titleMatches,
			taskId: candidate.taskId,
			snippet: candidate.snippetSource || undefined,
			snippetMatches,
			icon: candidate.icon,
			color: candidate.color,
			personName: candidate.personName,
			score,
		});
	}

	matched.sort((a, b) => b.score - a.score);

	const perKind = new Map<SearchResultKind, number>();
	return matched.filter((item) => {
		const seen = perKind.get(item.kind) ?? 0;
		if (seen >= PER_KIND_CAP) return false;
		perKind.set(item.kind, seen + 1);
		return true;
	});
}

/**
 * Slice `text` at each `[start, end]` pair in `matches`, returning alternating
 * unmatched / matched segments in order. Used to wrap matched runs in `<mark>`
 * from React without touching the DOM directly (Obsidian's `renderMatches`
 * mutates an element, which fights React's reconciliation).
 *
 * Empty / absent `matches` yields a single unmatched segment (or nothing, for
 * empty text). Pairs are assumed sorted and non-overlapping, as
 * `prepareFuzzySearch` produces them; out-of-range or malformed pairs are
 * clamped/skipped rather than throwing.
 */
export function splitMatches(
	text: string,
	matches: SearchMatches | null | undefined,
): { text: string; matched: boolean }[] {
	if (!matches || matches.length === 0) {
		return text ? [{ text, matched: false }] : [];
	}

	const segments: { text: string; matched: boolean }[] = [];
	let cursor = 0;

	for (const pair of matches) {
		let [start, end] = pair;
		if (start < cursor) start = cursor;
		if (end > text.length) end = text.length;
		if (end <= start) continue;

		if (start > cursor) {
			segments.push({ text: text.slice(cursor, start), matched: false });
		}
		segments.push({ text: text.slice(start, end), matched: true });
		cursor = end;
	}

	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor), matched: false });
	}

	return segments;
}
