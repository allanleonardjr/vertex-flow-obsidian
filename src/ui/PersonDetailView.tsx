/**
 * One person's tab: a plain header (name + usage counts + Edit) above their
 * assigned tasks. Unlike `ProjectDetailView`, there's no backing note — no
 * EditorRail, no description, no raw-source section — because a Person is just
 * an entry in `workspace.people`, not a file. The task list below is the same
 * `TaskViewport` the project screen uses, filtered by `personView`.
 */

import { useState } from "react";
import { findPersonUsage } from "../core/people";
import type { ViewContext } from "../core/views";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import type { WorkspaceSnapshot } from "../core/types";
import { pluralize } from "./browse/shared";
import { PersonDialog } from "./modals/PersonDialog";
import { usePlugin } from "./context";
import { personView } from "./App";
import { TaskViewport } from "./views/TaskViewport";

export function PersonDetailView({
	personId,
	snapshot,
	taxonomies,
	context,
	containerRef,
	active,
	onSelectView,
}: {
	personId: string;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
	containerRef: HTMLElement | null;
	active: boolean;
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const person = snapshot.workspace.people.find((p) => p.id === personId);
	const [editing, setEditing] = useState(false);

	if (!person) return null;

	const usage = findPersonUsage(personId, {
		tasks: snapshot.tasks,
		projects: snapshot.projects,
		commentCount:
			plugin.index.commentCountsByPerson(snapshot.workspace.root)[personId] ??
			0,
	});

	return (
		<div className="vf-browse">
			<header className="vf-toolbar">
				<div className="vf-toolbar-title">
					<h2>
						{person.name}
						<span className="vf-view-title-code">
							({snapshot.workspace.idPrefix})
						</span>
					</h2>
				</div>
				<div className="vf-toolbar-actions">
					<button className="mod-cta" onClick={() => setEditing(true)}>
						Edit
					</button>
				</div>
			</header>

			<div className="vf-browse-meta" style={{ padding: "0 14px 10px" }}>
				<span>{pluralize(usage.assigneeTaskPaths.length, "task")} assigned</span>
				<span>{pluralize(usage.ownerProjectPaths.length, "project")} owned</span>
				<span>{pluralize(usage.commentCount, "comment")}</span>
				<span>{pluralize(usage.mentionTaskPaths.length, "mention")}</span>
			</div>

			<TaskViewport
				snapshot={snapshot}
				view={personView(snapshot, personId)}
				taxonomies={taxonomies}
				context={context}
				containerRef={containerRef}
				active={active}
				onSelectView={onSelectView}
				hideViewTitle
				guardUnsavedEdits={false}
			/>

			{editing && (
				<PersonDialog
					title="Edit person"
					initialName={person.name}
					initialAliases={person.aliases}
					confirmLabel="Save"
					onConfirm={(name, aliases) =>
						plugin.mutations.updatePerson(snapshot, person.id, {
							name,
							aliases,
						})
					}
					onClose={() => setEditing(false)}
				/>
			)}
		</div>
	);
}
