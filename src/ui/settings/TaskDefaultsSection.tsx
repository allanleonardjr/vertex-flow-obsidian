/**
 * Defaults applied whenever a task is created: its starting task type (if
 * any), and which end of its siblings it lands at. Both are ordinary
 * `WorkspaceConfig` scalars, committed the same way as Activity History's
 * toggle.
 *
 * The task-type picker is the same `TypeSelect` the editor rail uses, so a
 * type reads identically here, in the editor, and on List/Board rows.
 */

import { workspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { TypeSelect } from "../components/fields";
import { usePlugin } from "../context";

export function TaskDefaultsSection({
	snapshot,
	id,
}: {
	snapshot: WorkspaceSnapshot;
	/** Scroll anchor for deep-links (e.g. the editor rail's "no default type" hint). */
	id?: string;
}) {
	const plugin = usePlugin();
	const workspace = snapshot.workspace;
	const taskTypes = workspaceTaxonomies(workspace).taskType;

	const commit = (
		patch: Partial<
			Pick<typeof workspace, "defaultNewTaskType" | "newTaskPlacement">
		>,
	) => {
		void plugin.mutations.saveWorkspaceConfig({ ...workspace, ...patch });
	};

	return (
		<section className="vf-settings-section" id={id}>
			<h3>Task creation</h3>
			<p className="vf-settings-description">
				Applied whenever a new task is created in this workspace.
			</p>

			{/* Not `.vf-field` — its broad `span` rule would leak into the
			    ported TypeSelect markup and break the pill's box. */}
			<div className="vf-settings-row">
				<span className="vf-settings-row-label">Default task type</span>
				<div className="vf-settings-select">
					<TypeSelect
						taxonomy={taskTypes}
						value={workspace.defaultNewTaskType}
						onChange={(defaultNewTaskType) => commit({ defaultNewTaskType })}
					/>
				</div>
			</div>

			<label className="vf-field">
				<span>New tasks go to</span>
				<select
					value={workspace.newTaskPlacement}
					onChange={(event) =>
						commit({
							newTaskPlacement: event.target.value as "top" | "bottom",
						})
					}
				>
					<option value="top">Top of the list</option>
					<option value="bottom">Bottom of the list</option>
				</select>
			</label>
		</section>
	);
}
