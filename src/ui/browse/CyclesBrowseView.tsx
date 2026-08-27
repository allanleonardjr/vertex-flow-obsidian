/**
 * Cycles browse screen. Only reachable once a workspace has turned cycles on
 * (§7.5) — the sidebar gates the nav entry the same way.
 */

import { cycleProgress, cycleTasks, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { useCreateCycle } from "../actions";
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

export function CyclesBrowseView({
	snapshot,
	taxonomies,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	const plugin = usePlugin();
	const createCycle = useCreateCycle();
	const scope = scopeOf(snapshot);
	const term = snapshot.workspace.cycles.termLabel;

	return (
		<div className="vf-browse">
			<BrowseHeader
				title={`${term}s`}
				noun={term.toLowerCase()}
				count={snapshot.cycles.length}
				actionLabel={`New ${term.toLowerCase()}`}
				onAction={() => void createCycle(snapshot)}
			/>

			{snapshot.cycles.length === 0 ? (
				<BrowseEmpty
					label={`${term.toLowerCase()}s`}
					actionLabel={`New ${term.toLowerCase()}`}
				/>
			) : (
				<BrowseList>
					{snapshot.cycles.map((cycle) => {
						const tasks = cycleTasks(scope, cycle.path);
						const progress = cycleProgress(scope, cycle.path, taxonomies.status);

						return (
							<BrowseCard
								key={cycle.path}
								onClick={() => void plugin.mutations.open(cycle.path)}
							>
								<div className="vf-browse-card-top">
									<span className={`vf-chip vf-cycle-status is-${cycle.status}`}>
										{cycle.status}
									</span>
									<span className="vf-browse-title">{cycle.title}</span>
								</div>
								<BrowseMeta>
									<span>
										{cycle.startDate ? formatFullDate(cycle.startDate) : "—"} –{" "}
										{cycle.endDate ? formatFullDate(cycle.endDate) : "—"}
									</span>
									<span>{pluralize(tasks.length, "task")}</span>
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
