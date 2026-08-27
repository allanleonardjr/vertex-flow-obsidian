/**
 * Taxonomy engine public surface (§5).
 *
 * `workspaceTaxonomies()` is the intended entry point everywhere else in the
 * codebase: it turns a raw `WorkspaceConfig` into the four configured engine
 * instances, so no caller ever hand-rolls a taxonomy again.
 */

import type {
	LabelValue,
	PriorityValue,
	StatusValue,
	TaskTypeValue,
	WorkspaceConfig,
} from "../types";
import { createTaxonomy, type Taxonomy } from "./engine";

export * from "./engine";
export * from "./defaults";
export * from "./usage";

export interface WorkspaceTaxonomies {
	status: Taxonomy<StatusValue>;
	priority: Taxonomy<PriorityValue>;
	taskType: Taxonomy<TaskTypeValue>;
	label: Taxonomy<LabelValue>;
}

export function workspaceTaxonomies(
	workspace: WorkspaceConfig,
): WorkspaceTaxonomies {
	return {
		status: createTaxonomy("status", workspace.statuses),
		priority: createTaxonomy("priority", workspace.priorities),
		taskType: createTaxonomy("taskType", workspace.taskTypes),
		label: createTaxonomy("label", workspace.labels),
	};
}

/**
 * Write a modified taxonomy back into a workspace config. Keeps the mapping
 * between `TaxonomyKind` and the config's four value arrays in exactly one
 * place, so the settings UI never has to switch on kind itself.
 */
export function withTaxonomy(
	workspace: WorkspaceConfig,
	taxonomy: Taxonomy,
): WorkspaceConfig {
	switch (taxonomy.schema.kind) {
		case "status":
			return { ...workspace, statuses: taxonomy.values as StatusValue[] };
		case "priority":
			return { ...workspace, priorities: taxonomy.values as PriorityValue[] };
		case "taskType":
			return { ...workspace, taskTypes: taxonomy.values as TaskTypeValue[] };
		case "label":
			return { ...workspace, labels: taxonomy.values as LabelValue[] };
	}
}
