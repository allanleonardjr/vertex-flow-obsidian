/**
 * Workspace template registry.
 *
 * One entry per file in this folder. Adding a template later is a two-line
 * change: a new file, and one line here — nothing else in the app needs to
 * know.
 */

import { contentPipelineTemplate } from "./content-pipeline";
import { feedbackRoadmapTemplate } from "./feedback-roadmap";
import { freelanceTemplate } from "./freelance";
import { gettingStartedTemplate } from "./getting-started";
import { personalAdminTemplate } from "./personal-admin";
import { salesPipelineTemplate } from "./sales-pipeline";
import { softwareSprintTemplate } from "./software-sprint";
import type { WorkspaceTemplate } from "./types";

export * from "./types";
export * from "./instantiate";

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
	gettingStartedTemplate,
	softwareSprintTemplate,
	feedbackRoadmapTemplate,
	salesPipelineTemplate,
	contentPipelineTemplate,
	freelanceTemplate,
	personalAdminTemplate,
];

export function templateById(id: string): WorkspaceTemplate | undefined {
	return WORKSPACE_TEMPLATES.find((template) => template.id === id);
}
