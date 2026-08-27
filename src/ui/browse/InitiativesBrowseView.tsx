/**
 * Initiatives browse screen — the top of the hierarchy (§2).
 */

import { computeProgress, initiativeProjects, initiativeTasks, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { useCreateInitiative } from "../actions";
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

export function InitiativesBrowseView({
	snapshot,
	taxonomies,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	const plugin = usePlugin();
	const createInitiative = useCreateInitiative();
	const scope = scopeOf(snapshot);

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Initiatives"
				noun="initiative"
				count={snapshot.initiatives.length}
				actionLabel="New initiative"
				onAction={() => void createInitiative(snapshot)}
			/>

			{snapshot.initiatives.length === 0 ? (
				<BrowseEmpty label="initiatives" actionLabel="New initiative" />
			) : (
				<BrowseList>
					{snapshot.initiatives.map((initiative) => {
						const projects = initiativeProjects(scope, initiative.path);
						const tasks = initiativeTasks(scope, initiative.path);
						const progress = computeProgress(tasks, taxonomies.status);

						return (
							<BrowseCard
								key={initiative.path}
								onClick={() => void plugin.mutations.open(initiative.path)}
							>
								<div className="vf-browse-card-top">
									<TaxonomyChip
										taxonomies={taxonomies}
										kind="status"
										id={initiative.status}
									/>
									<span className="vf-browse-title">{initiative.title}</span>
								</div>
								<BrowseMeta>
									<span>{pluralize(projects.length, "project")}</span>
									<span>{pluralize(tasks.length, "task")}</span>
									<span>Created {formatFullDate(initiative.createdAt)}</span>
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
