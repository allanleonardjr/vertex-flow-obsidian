/**
 * The body of a Project card — status chip, title, task count, created date and
 * computed progress. Extracted from `ProjectsBrowseView` so the same card
 * renders identically wherever a Project is listed (the hub now, workspace
 * Trash in Phase 3).
 */

import { projectProgress, projectTaskBreakdown, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Project, WorkspaceSnapshot } from "../../core/types";
import { TaxonomyChip } from "../components/TaskBits";
import { BrowseMeta, BrowseProgress, formatFullDate, pluralize } from "./shared";

export function ProjectCardContent({
	snapshot,
	taxonomies,
	project,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	project: Project;
}) {
	const scope = scopeOf(snapshot);
	// All active work in the project (top-level + sub-tasks); the detail header
	// breaks this down further.
	const counts = projectTaskBreakdown(scope, project.path);
	const taskCount = counts.tasks + counts.subtasks;
	// Progress is computed independently of the project's own status, and never
	// fed back into it.
	const progress = projectProgress(scope, project.path, taxonomies.status);

	return (
		<>
			<div className="vf-browse-card-top">
				<TaxonomyChip taxonomies={taxonomies} kind="status" id={project.status} />
				<span className="vf-browse-title">{project.title}</span>
			</div>
			<BrowseMeta>
				<span>{pluralize(taskCount, "task")}</span>
				<span>Created {formatFullDate(project.createdAt)}</span>
			</BrowseMeta>
			<BrowseProgress progress={progress} />
		</>
	);
}
