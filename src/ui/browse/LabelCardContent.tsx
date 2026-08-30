/**
 * The body of a Label card — colour chip, name, task-usage count, and its
 * description when set. Mirrors `ProjectCardContent`.
 */

import { findTaxonomyUsage } from "../../core/taxonomy";
import type { LabelValue, WorkspaceSnapshot } from "../../core/types";
import { LabelChip } from "../components/TaskBits";
import { BrowseMeta, pluralize } from "./shared";

export function LabelCardContent({
	snapshot,
	label,
}: {
	snapshot: WorkspaceSnapshot;
	label: LabelValue;
}) {
	const usage = findTaxonomyUsage("label", label.id, {
		tasks: snapshot.tasks,
		projects: snapshot.projects,
	});

	return (
		<>
			<div className="vf-browse-card-top">
				<LabelChip name={label.name} color={label.color} />
			</div>
			<BrowseMeta>
				<span>{pluralize(usage.count, "task")}</span>
			</BrowseMeta>
			{label.description && (
				<p className="vf-browse-card-description">{label.description}</p>
			)}
		</>
	);
}
