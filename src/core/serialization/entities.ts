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
	asDateTime,
	asString,
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
		archivedAt: project.archivedAt,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
	});
	base.archived = project.archived;
	return base;
}
