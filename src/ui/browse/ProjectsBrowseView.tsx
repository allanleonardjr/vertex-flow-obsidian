/**
 * Projects browse screen — every Project in the workspace, as a card with its
 * status, task count, and computed progress.
 */

import { projectProgress, projectTaskBreakdown, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { useCreateProject } from "../actions";
import { TaxonomyChip } from "../components/TaskBits";
import { useTabs } from "../tabs-context";
import {
	BrowseCard,
	BrowseEmpty,
	BrowseHeader,
	BrowseList,
	BrowseMeta,
	BrowseProgress,
	formatFullDate,
	pluralize,
} from "./shared";

export function ProjectsBrowseView({
	snapshot,
	taxonomies,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	const createProject = useCreateProject();
	const tabs = useTabs();
	const scope = scopeOf(snapshot);

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Projects"
				noun="project"
				count={snapshot.projects.length}
				actionLabel="New project"
				onAction={() => void createProject(snapshot)}
			/>

			{snapshot.projects.length === 0 ? (
				<BrowseEmpty label="projects" actionLabel="New project" />
			) : (
				<BrowseList>
					{snapshot.projects.map((project) => {
						// All active work in the project (top-level + sub-tasks); the
						// detail header breaks this down further.
						const counts = projectTaskBreakdown(scope, project.path);
						const taskCount = counts.tasks + counts.subtasks;
						// §7.1: progress is computed independently of the project's
						// own status, and never fed back into it.
						const progress = projectProgress(scope, project.path, taxonomies.status);

						return (
							<BrowseCard
								key={project.path}
								onClick={() => tabs.openProject(project.path)}
							>
								<div className="vf-browse-card-top">
									<TaxonomyChip
										taxonomies={taxonomies}
										kind="status"
										id={project.status}
									/>
									<span className="vf-browse-title">{project.title}</span>
								</div>
								<BrowseMeta>
									<span>{pluralize(taskCount, "task")}</span>
									<span>Created {formatFullDate(project.createdAt)}</span>
								</BrowseMeta>
								<BrowseProgress progress={progress} />
							</BrowseCard>
						);
					})}
				</BrowseList>
			)}
		</div>
	);
}
