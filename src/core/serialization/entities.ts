/**
 * Project frontmatter ↔ domain object.
 *
 * Unlike Tasks, a Project note is named by *title*, so the filename is the
 * human-readable identity and `title` in frontmatter is the display override.
 */

import { basename } from "../links";
import type { Project } from "../types";
import {
	asBoolean,
	asDate,
	asDateTime,
	asString,
	asStringArray,
	asRecord,
	compact,
	nowIso,
	type ParseResult,
} from "./coerce";

export interface EntityParseOptions {
	path: string;
	/** Used when the note omits `status`, same as for Tasks. */
	defaultStatus: string;
}

export function parseProject(
	raw: unknown,
	options: EntityParseOptions,
): ParseResult<Project> {
	const fm = asRecord(raw);
	const createdAt = asDateTime(fm.createdAt);
	const archivedAt = asDateTime(fm.archivedAt);

	return {
		value: {
			type: "project",
			title: asString(fm.title) ?? basename(options.path),
			icon: asString(fm.icon) ?? undefined,
			status: asString(fm.status) ?? options.defaultStatus,
			// Priority/labels reuse the Task taxonomies — same forgiving coercion.
			priority: asString(fm.priority),
			labels: asStringArray(fm.labels),
			// Dates parsed independently, no start-before-due rule — Task doesn't
			// enforce one either, so this stays the same forgiving parse.
			startDate: asDate(fm.startDate),
			dueDate: asDate(fm.dueDate),
			owner: asString(fm.owner),
			archived: asBoolean(fm.archived, false) || archivedAt != null,
			archivedAt,
			createdAt: createdAt ?? nowIso(),
			updatedAt: asDateTime(fm.updatedAt) ?? createdAt ?? nowIso(),
			path: options.path,
		},
		issues: [],
	};
}

export function serializeProject(project: Project): Record<string, unknown> {
	const base = compact({
		type: "project",
		title: project.title,
		icon: project.icon,
		status: project.status,
		priority: project.priority,
		owner: project.owner,
		labels: project.labels,
		startDate: project.startDate,
		dueDate: project.dueDate,
	});
	// `archived` is written explicitly even when false — an absent field reads as
	// "unknown" rather than "no" (same reasoning as `serializeTask`).
	base.archived = project.archived;
	if (project.archivedAt) base.archivedAt = project.archivedAt;
	base.createdAt = project.createdAt;
	base.updatedAt = project.updatedAt;
	return base;
}

/** Field order for the writer, so notes stay diff-stable across edits. */
export const PROJECT_FIELD_ORDER: readonly string[] = [
	"type",
	"title",
	"icon",
	"status",
	"priority",
	"owner",
	"labels",
	"startDate",
	"dueDate",
	"archived",
	"archivedAt",
	"createdAt",
	"updatedAt",
] as const;

// ---------------------------------------------------------------------------
// Project note body ↔ `ProjectDocument.description`
// ---------------------------------------------------------------------------

/**
 * A Project note's body *is* its description — there's no comments block to
 * split around, so this is far simpler than the Task equivalent.
 *
 * A lone leading `## Overview` heading (what older projects and the create
 * template seeded) is dropped so it doesn't show up as literal text in the
 * editor.
 */
export function extractProjectDescription(body: string): string {
	return body
		.replace(/\r\n/g, "\n")
		.replace(/^\s*##\s+overview\s*\n?/i, "")
		.trim();
}

/** Serialize a description back to a note body — trimmed, one trailing newline. */
export function withProjectDescription(text: string): string {
	const content = text.replace(/\r\n/g, "\n").trim();
	return content ? `${content}\n` : "";
}

// ---------------------------------------------------------------------------
// Title uniqueness (per workspace)
// ---------------------------------------------------------------------------
//
// Project notes are title-based files, so two projects in one workspace sharing
// a `title` produces ambiguous `project:` filters and links (the query bar
// falls back to printing the raw vault path). Titles are unique per workspace —
// the same "nothing shared across workspaces" scoping taxonomies and people
// follow — and compared case-insensitively, matching the taxonomy engine.

function titleKey(title: string): string {
	return title.trim().toLowerCase();
}

/**
 * Whether another project in this workspace already uses `title`
 * (case-insensitive). `excludePath` lets a project keep (or re-case) its own
 * name on rename without tripping the check — mirrors `updateValue` in the
 * taxonomy engine.
 */
export function isProjectTitleTaken(
	projects: readonly Project[],
	title: string,
	excludePath?: string,
): boolean {
	const key = titleKey(title);
	if (!key) return false;
	return projects.some(
		(project) => project.path !== excludePath && titleKey(project.title) === key,
	);
}

export interface ProjectTitleCollision {
	path: string;
	title: string;
}

/**
 * Projects in one workspace whose titles collide case-insensitively — one entry
 * per affected project, so each note gets its own issue. Same shape and spirit
 * as `detectPrefixCollisions`: a real correctness problem, surfaced as a
 * non-fatal note issue rather than blocking vault load, since an existing vault
 * may already contain duplicates from before the rule existed.
 */
export function detectProjectTitleCollisions(
	projects: readonly Project[],
): ProjectTitleCollision[] {
	const groups = new Map<string, Project[]>();
	for (const project of projects) {
		const key = titleKey(project.title);
		if (!key) continue;
		const group = groups.get(key) ?? [];
		group.push(project);
		groups.set(key, group);
	}

	const out: ProjectTitleCollision[] = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		for (const project of group) {
			out.push({ path: project.path, title: project.title });
		}
	}
	return out;
}
