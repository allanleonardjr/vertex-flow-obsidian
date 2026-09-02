/**
 * Labels hub — every label in the workspace, as a card with its usage count
 * and description. Reuses the exact same create/edit/delete flow
 * `LabelsSection` already has in the sidebar; this is a second entry point
 * to the same mutations, not new logic.
 *
 * The header carries a fixed, non-configurable 2-up hero chart row (task
 * label + priority distribution across the whole workspace) behind a
 * show/hide toggle — same pattern as `ProjectsBrowseView`. Plain
 * `DashboardWidget` objects fed through the real `computeWidgetData` /
 * `WidgetChart` pipeline, never persisted to a `DashboardConfig`.
 */

import { useMemo, useState } from "react";
import {
	describeUsage,
	findTaxonomyUsage,
	planTaxonomyDeletion,
	workspaceTaxonomies,
	type TaxonomyDeletionPlan,
	type TaxonomyUsage,
} from "../../core/taxonomy";
import type { DashboardWidget, WorkspaceSnapshot } from "../../core/types";
import { computeWidgetData } from "../../core/dashboards";
import { snapshotContext } from "../../core/views";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { WidgetChart } from "../dashboards/charts/WidgetChart";
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

/**
 * Fixed hero-chart presets for the Labels hub header — task-level label and
 * priority distribution across every task in the workspace. Not
 * user-configurable and never persisted to a `DashboardConfig`; `layout` is
 * unused since these never go through `DashboardGrid`.
 */
const HERO_LABEL_WIDGET: DashboardWidget = {
	id: "hero-label",
	chartType: "bar",
	title: "Tasks by Label",
	titleIsCustom: true,
	fieldMapping: { chartType: "bar", groupBy: "label" },
	layout: { x: 0, y: 0, w: 0, h: 0 },
};

const HERO_PRIORITY_WIDGET: DashboardWidget = {
	id: "hero-priority",
	chartType: "pie",
	title: "Tasks by Priority",
	titleIsCustom: true,
	fieldMapping: { chartType: "pie", groupBy: "priority" },
	layout: { x: 0, y: 0, w: 0, h: 0 },
};

export function LabelsBrowseView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { openLabel } = useTabs();
	const labels = workspaceTaxonomies(snapshot.workspace).label;
	const ordered = [...labels.values].sort((a, b) => a.name.localeCompare(b.name));

	const [showHeroCharts, setShowHeroCharts] = useState(true);
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

	const context = useMemo(() => snapshotContext(snapshot), [snapshot]);
	const labelData = useMemo(
		() => computeWidgetData(HERO_LABEL_WIDGET, snapshot.tasks, context),
		[snapshot.tasks, context],
	);
	const priorityData = useMemo(
		() => computeWidgetData(HERO_PRIORITY_WIDGET, snapshot.tasks, context),
		[snapshot.tasks, context],
	);

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Labels"
				noun="label"
				count={ordered.length}
				idPrefix={snapshot.workspace.idPrefix}
				actionLabel="New label"
				onAction={() => setCreating(true)}
			>
				<button
					type="button"
					className={`vf-bar-item${showHeroCharts ? " is-on" : ""}`}
					onClick={() => setShowHeroCharts((prev) => !prev)}
				>
					{showHeroCharts ? "Hide charts" : "Show charts"}
				</button>
			</BrowseHeader>

			{showHeroCharts && (
				<div className="vf-browse-hero">
					<div className="vf-browse-hero-chart">
						<div className="vf-dash-widget">
							<div className="vf-dash-widget-head">
								<span className="vf-browse-hero-chart-title">
									{HERO_LABEL_WIDGET.title}
								</span>
							</div>
							<div className="vf-dash-widget-body">
								<WidgetChart widget={HERO_LABEL_WIDGET} data={labelData} />
							</div>
						</div>
					</div>
					<div className="vf-browse-hero-chart">
						<div className="vf-dash-widget">
							<div className="vf-dash-widget-head">
								<span className="vf-browse-hero-chart-title">
									{HERO_PRIORITY_WIDGET.title}
								</span>
							</div>
							<div className="vf-dash-widget-body">
								<WidgetChart widget={HERO_PRIORITY_WIDGET} data={priorityData} />
							</div>
						</div>
					</div>
				</div>
			)}

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
