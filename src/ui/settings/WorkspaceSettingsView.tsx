/**
 * Workspace settings: taxonomy configuration (§5) plus the workspace-level
 * toggles from `_workspace.md` (§4.5). Reachable from the sidebar's Settings
 * row, rendered inline like the browse screens — no modal, just another thing
 * the content area shows.
 */

import { workspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { ArchivingSection } from "./ArchivingSection";
import { GeneralSection } from "./GeneralSection";
import { PeopleSection } from "./PeopleSection";
import { TaxonomySection } from "./TaxonomySection";

export function WorkspaceSettingsView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const taxonomies = workspaceTaxonomies(snapshot.workspace);

	return (
		<div className="vf-settings">
			<header className="vf-toolbar">
				<div className="vf-toolbar-title">
					<h2>Settings - {snapshot.workspace.name}</h2>
				</div>
			</header>

			<div className="vf-settings-body">
				<GeneralSection snapshot={snapshot} />

				<TaxonomySection
					title="Statuses"
					description="Fixed categories (backlog, unstarted, started, completed, canceled) drive progress and filtering — names, colours, and order are all yours (§5.1)."
					kind="status"
					taxonomy={taxonomies.status}
					snapshot={snapshot}
				/>

				<TaxonomySection
					title="Priorities"
					description="Fully flexible and ordered — add or remove as many levels as you want (§5.2)."
					kind="priority"
					taxonomy={taxonomies.priority}
					snapshot={snapshot}
				/>

				<TaxonomySection
					title="Task Types"
					description="No fixed order or category — just a name and a colour (§5.3)."
					kind="taskType"
					taxonomy={taxonomies.taskType}
					snapshot={snapshot}
				/>


				<PeopleSection snapshot={snapshot} />
				<ArchivingSection snapshot={snapshot} />
			</div>
		</div>
	);
}
