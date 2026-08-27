/**
 * Project / Initiative / Cycle frontmatter ↔ domain objects (§4.2–4.4).
 *
 * Unlike Tasks, these notes are named by *title*, so the filename is the
 * human-readable identity and `title` in frontmatter is the display override.
 */

import { basename, formatLink, parseLink } from "../links";
import type { Cycle, Initiative, Project } from "../types";
import {
	asBoolean,
	asDate,
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
			status: asString(fm.status) ?? options.defaultStatus,
			initiative: parseLink(fm.initiative),
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
		status: project.status,
		initiative: formatLink(project.initiative),
		archivedAt: project.archivedAt,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
	});
	base.archived = project.archived;
	return base;
}

export function parseInitiative(
	raw: unknown,
	options: EntityParseOptions,
): ParseResult<Initiative> {
	const fm = asRecord(raw);
	const createdAt = asDateTime(fm.createdAt);
	const archivedAt = asDateTime(fm.archivedAt);

	return {
		value: {
			type: "initiative",
			title: asString(fm.title) ?? basename(options.path),
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

export function serializeInitiative(
	initiative: Initiative,
): Record<string, unknown> {
	const base = compact({
		type: "initiative",
		title: initiative.title,
		status: initiative.status,
		archivedAt: initiative.archivedAt,
		createdAt: initiative.createdAt,
		updatedAt: initiative.updatedAt,
	});
	base.archived = initiative.archived;
	return base;
}

export function parseCycle(
	raw: unknown,
	options: EntityParseOptions,
): ParseResult<Cycle> {
	const fm = asRecord(raw);
	const createdAt = asDateTime(fm.createdAt);

	return {
		value: {
			type: "cycle",
			title: asString(fm.title) ?? basename(options.path),
			startDate: asDate(fm.startDate),
			endDate: asDate(fm.endDate),
			status: asString(fm.status) ?? "active",
			createdAt: createdAt ?? nowIso(),
			updatedAt: asDateTime(fm.updatedAt) ?? createdAt ?? nowIso(),
			path: options.path,
		},
		issues: [],
	};
}

export function serializeCycle(cycle: Cycle): Record<string, unknown> {
	return compact({
		type: "cycle",
		title: cycle.title,
		startDate: cycle.startDate,
		endDate: cycle.endDate,
		status: cycle.status,
		createdAt: cycle.createdAt,
		updatedAt: cycle.updatedAt,
	});
}
