/**
 * Projects browse screen. A Project may stand alone or belong to an
 * Initiative (§2) — the card shows which, rather than assuming one.
 */

import { projectProgress, projectTasks, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { useCreateProject } from "../actions";
import { FEATURES } from "../features";
import { TaxonomyChip } from "../components/TaskBits";
import { usePlugin } from "../context";
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
	const plugin = usePlugin();
	const createProject = useCreateProject();
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
						const tasks = projectTasks(scope, project.path);
						// §7.1: progress is computed independently of the project's
						// own status, and never fed back into it.
						const progress = projectProgress(scope, project.path, taxonomies.status);
						const initiative =
							FEATURES.initiatives && project.initiative
								? snapshot.initiatives.find((i) => i.path === project.initiative)
								: null;

						return (
							<BrowseCard
								key={project.path}
								onClick={() => void plugin.mutations.open(project.path)}
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
									{FEATURES.initiatives && (
										<span>{initiative ? initiative.title : "No initiative"}</span>
									)}
									<span>{pluralize(tasks.length, "task")}</span>
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
