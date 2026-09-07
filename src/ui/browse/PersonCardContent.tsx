/**
 * The body of a Person card — name and three usage counts (assigned / owned /
 * comments). No colour chip; a Person carries no colour. Mirrors
 * `LabelCardContent`.
 */

import { findPersonUsage } from "../../core/people";
import type { Person, WorkspaceSnapshot } from "../../core/types";
import { usePlugin } from "../context";
import { useMePersonId } from "../useMe";
import { BrowseMeta, pluralize } from "./shared";

export function PersonCardContent({
	snapshot,
	person,
}: {
	snapshot: WorkspaceSnapshot;
	person: Person;
}) {
	const plugin = usePlugin();
	const mePersonId = useMePersonId(snapshot.workspace.root);
	const usage = findPersonUsage(person.id, {
		tasks: snapshot.tasks,
		projects: snapshot.projects,
		commentCount:
			plugin.index.commentCountsByPerson(snapshot.workspace.root)[person.id] ??
			0,
	});

	return (
		<>
			<div className="vf-browse-card-top">
				<span className="vf-browse-title" title={person.name}>
					{person.name}
				</span>
				{mePersonId === person.id && (
					<span className="vf-you-badge">You</span>
				)}
			</div>
			<BrowseMeta>
				<span>{pluralize(usage.assigneeTaskPaths.length, "task")}</span>
				<span>{pluralize(usage.ownerProjectPaths.length, "project")}</span>
				<span>{pluralize(usage.commentCount, "comment")}</span>
			</BrowseMeta>
		</>
	);
}
