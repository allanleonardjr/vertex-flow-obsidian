/**
 * Labels hub — every label in the workspace, as a card with its usage count
 * and description. Reuses the exact same create/edit/delete flow
 * `LabelsSection` already has in the sidebar; this is a second entry point
 * to the same mutations, not new logic.
 */

import { useState } from "react";
import {
	describeUsage,
	findTaxonomyUsage,
	planTaxonomyDeletion,
	workspaceTaxonomies,
	type TaxonomyDeletionPlan,
	type TaxonomyUsage,
} from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { LabelDialog } from "../modals/LabelDialog";
import { ReplaceValueDialog } from "../settings/ReplaceValueDialog";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";
import { LabelCardContent } from "./LabelCardContent";
import {
	BrowseCard,
	BrowseCardMenu,
	BrowseEmpty,
	BrowseHeader,
	BrowseList,
} from "./shared";

export function LabelsBrowseView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { openLabel } = useTabs();
	const labels = workspaceTaxonomies(snapshot.workspace).label;
	const ordered = [...labels.values].sort((a, b) => a.name.localeCompare(b.name));

	const [menuId, setMenuId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [deletion, setDeletion] = useState<{
		plan: TaxonomyDeletionPlan;
		usage: TaxonomyUsage;
	} | null>(null);
	const [confirming, setConfirming] = useState<{
		plan: TaxonomyDeletionPlan;
		usage: TaxonomyUsage;
	} | null>(null);

	const editLabel = ordered.find((l) => l.id === editing);

	const requestDelete = (id: string) => {
		const usage = findTaxonomyUsage("label", id, {
			tasks: snapshot.tasks,
			projects: snapshot.projects,
		});
		const plan = planTaxonomyDeletion(labels, id, usage.count);
		setConfirming({ plan, usage });
	};

	const performDelete = (plan: TaxonomyDeletionPlan, usage: TaxonomyUsage) => {
		setConfirming(null);
		if (!plan.blocked) {
			void plugin.mutations.applyTaxonomyDeletionPlan(snapshot, labels, plan, null);
			return;
		}
		setDeletion({ plan, usage });
	};

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Labels"
				noun="label"
				count={ordered.length}
				actionLabel="New label"
				onAction={() => setCreating(true)}
			/>

			{ordered.length === 0 ? (
				<BrowseEmpty label="labels" actionLabel="New label" />
			) : (
				<BrowseList>
					{ordered.map((label) => (
						<BrowseCard
							key={label.id}
							onClick={() => openLabel(label.id)}
							trailing={
								<BrowseCardMenu
									open={menuId === label.id}
									onToggle={() =>
										setMenuId((m) => (m === label.id ? null : label.id))
									}
									onClose={() => setMenuId(null)}
								>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuId(null);
											setEditing(label.id);
										}}
									>
										Edit
									</button>
									<button
										className="vf-menu-item vf-menu-item-danger"
										onClick={() => {
											setMenuId(null);
											requestDelete(label.id);
										}}
									>
										Delete
									</button>
								</BrowseCardMenu>
							}
						>
							<LabelCardContent snapshot={snapshot} label={label} />
						</BrowseCard>
					))}
				</BrowseList>
			)}

			{creating && (
				<LabelDialog
					title="New label"
					initialName="New label"
					confirmLabel="Create"
					onConfirm={(name, color, description) =>
						plugin.mutations
							.createLabel(snapshot, name, color, description)
							.then(() => {})
					}
					onClose={() => setCreating(false)}
				/>
			)}

			{editLabel && (
				<LabelDialog
					title="Edit label"
					initialName={editLabel.name}
					initialColor={editLabel.color}
					initialDescription={editLabel.description}
					confirmLabel="Save"
					onConfirm={(name, color, description) =>
						plugin.mutations.updateLabel(snapshot, editLabel.id, {
							name,
							color,
							description,
						})
					}
					onClose={() => setEditing(null)}
				/>
			)}

			{confirming && (
				<ConfirmDeleteDialog
					title={`Delete label "${confirming.plan.valueName}"?`}
					body={
						confirming.plan.blocked
							? `It's on ${describeUsage(confirming.usage)} — you'll choose what happens to ${confirming.usage.count === 1 ? "it" : "them"} next.`
							: "This can't be undone."
					}
					onCancel={() => setConfirming(null)}
					onConfirm={() => performDelete(confirming.plan, confirming.usage)}
				/>
			)}

			{deletion && (
				<ReplaceValueDialog
					plan={deletion.plan}
					usage={deletion.usage}
					allowRemoveAll
					onCancel={() => setDeletion(null)}
					onConfirm={(replacementId) => {
						void plugin.mutations.applyTaxonomyDeletionPlan(
							snapshot,
							labels,
							deletion.plan,
							replacementId,
						);
						setDeletion(null);
					}}
				/>
			)}
		</div>
	);
}
