/**
 * Project frontmatter ↔ domain object (§4.2).
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
 * split around (§4.2), so this is far simpler than the Task equivalent.
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
