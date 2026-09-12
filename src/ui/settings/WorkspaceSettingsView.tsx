/**
 * Workspace settings: taxonomy configuration plus the workspace-level
 * toggles from `_workspace.md`. Reachable from the sidebar's Settings
 * row, rendered inline like the browse screens — no modal, just another thing
 * the content area shows.
 */

import { useEffect, useRef } from "react";
import { workspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { useTabs } from "../tabs-context";
import { AiChatSection } from "./AiChatSection";
import { ArchivingSection } from "./ArchivingSection";
import { GeneralSection } from "./GeneralSection";
import { HistorySection } from "./HistorySection";
import { PeopleSection } from "./PeopleSection";
import { TaskDefaultsSection } from "./TaskDefaultsSection";
import { TaxonomySection } from "./TaxonomySection";

export function WorkspaceSettingsView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const taxonomies = workspaceTaxonomies(snapshot.workspace);
	const { pendingScreenAnchor, clearPendingScreenAnchor } = useTabs();
	const bodyRef = useRef<HTMLDivElement | null>(null);

	// A deep-link into a specific section (e.g. the sidebar "me" banner → People).
	// Consumed once; a manual scroll afterwards isn't disturbed.
	useEffect(() => {
		if (!pendingScreenAnchor) return;
		const target = bodyRef.current?.querySelector<HTMLElement>(
			`#${CSS.escape(pendingScreenAnchor)}`,
		);
		target?.scrollIntoView({ block: "start", behavior: "auto" });
		clearPendingScreenAnchor();
	}, [pendingScreenAnchor, clearPendingScreenAnchor]);

	return (
		<div className="vf-settings">
			<header className="vf-toolbar">
				<div className="vf-toolbar-title">
					<h2>Settings - {snapshot.workspace.name}</h2>
				</div>
			</header>

			<div className="vf-settings-body" ref={bodyRef}>
				<GeneralSection snapshot={snapshot} />

				<TaxonomySection
					title="Statuses"
					description="Fixed categories (backlog, unstarted, started, completed, canceled) drive progress and filtering — names, colours, and order are all yours."
					kind="status"
					taxonomy={taxonomies.status}
					snapshot={snapshot}
				/>

				<TaxonomySection
					title="Priorities"
					description="Fully flexible and ordered — add or remove as many levels as you want."
					kind="priority"
					taxonomy={taxonomies.priority}
					snapshot={snapshot}
				/>

				<TaxonomySection
					title="Task Types"
					description="No fixed order or category — just a name and a colour."
					kind="taskType"
					taxonomy={taxonomies.taskType}
					snapshot={snapshot}
				/>

				<TaskDefaultsSection
					snapshot={snapshot}
					id="vf-settings-task-defaults"
				/>

				<PeopleSection snapshot={snapshot} id="vf-settings-people" />
				<ArchivingSection snapshot={snapshot} />
				<AiChatSection />
				<HistorySection snapshot={snapshot} />
			</div>
		</div>
	);
}
