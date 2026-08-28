/**
 * Workspace templates (§13).
 *
 * A template is the *only* way to create a workspace: the plainest option
 * ("Getting Started") is just one entry in the gallery, not a separate "blank"
 * path. Each template carries enough metadata to render its gallery card
 * without generating anything, plus a `buildExampleContent()` that is only
 * called when the user opts to populate the new workspace with sample notes.
 *
 * Nothing in this folder may import the Obsidian API (Golden Rule) — templates
 * describe note *content*, and the Obsidian glue layer writes the files.
 */

import type {
	Comment,
	Person,
	Project,
	SavedView,
	Task,
	WorkspaceConfig,
} from "../types";

/** Taxonomy/people overrides a template applies to the new `WorkspaceConfig`. */
export type TemplateWorkspaceOverrides = Partial<
	Pick<
		WorkspaceConfig,
		"statuses" | "priorities" | "taskTypes" | "labels" | "people"
	>
>;

export interface TemplateSettingValue {
	name: string;
	/** Hex color. Present for Status/Priority/Task Type/Label values; omitted
	 *  for settings that have no color (e.g. "Default view"). */
	color?: string;
}

export interface TemplateSetting {
	/** e.g. "Statuses", "Priorities", "Task Types", "Labels", "Default view" */
	label: string;
	values: TemplateSettingValue[];
}

export interface TemplateMeta {
	id: string; // stable kebab-case id, e.g. "sales-pipeline"
	name: string;
	description: string; // one or two sentences, shown on the card
	icon?: string; // Obsidian icon name
	defaultIdPrefix: string;
	/** Lightweight preview for the card — must NOT require calling
	 *  buildExampleContent(). Derived from the same arrays the template feeds
	 *  its taxonomy from, via settingsFromValues(). */
	settings: TemplateSetting[];
}

export interface TemplateBuildContext {
	root: string;
	idPrefix: string;
	now: Date;
	iso(offsetDays: number): string;
	day(offsetDays: number): string;
	taskPath(n: number): string;
}

export interface TemplateContent {
	workspace?: TemplateWorkspaceOverrides;
	views?: SavedView[]; // appended after defaultViews()[0], never replacing it
	projects: Project[];
	tasks: Task[];
	comments?: Map<string, Comment[]>;
	descriptions?: Map<string, string>;
}

export interface WorkspaceTemplate extends TemplateMeta {
	/** Taxonomy/people overrides, applied whether or not example content is
	 *  included. A template that doesn't override a taxonomy omits it here and
	 *  the workspace defaults are used. */
	workspace?: TemplateWorkspaceOverrides;
	/** Extra Saved Views, appended after the built-in "All Tasks" view. Applied
	 *  whether or not example content is included. */
	views?: SavedView[];
	/** Called only when the user opts to populate with example content. */
	buildExampleContent(ctx: TemplateBuildContext): TemplateContent;
}

/** Turns a taxonomy value array into card-preview settings. Used in every
 *  template file instead of hand-typing `settings` — the single place that
 *  keeps the card in sync with `workspace.statuses` / `.priorities` /
 *  `.taskTypes` / `.labels`. */
export function settingsFromValues(
	label: string,
	values: { name: string; color?: string }[],
): TemplateSetting {
	return {
		label,
		values: values.map((v) => ({ name: v.name, color: v.color })),
	};
}

/** A plain (colorless) card row, e.g. "Default view: Board (grouped by Status)". */
export function plainSetting(label: string, ...values: string[]): TemplateSetting {
	return { label, values: values.map((name) => ({ name })) };
}
