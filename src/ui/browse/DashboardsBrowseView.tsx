/**
 * Dashboards hub — every Dashboard in the workspace as a card, with an
 * Edit / Duplicate / Delete row menu mirroring `DashboardsSection` in the
 * sidebar exactly. No System-Item filtering — dashboards have no permanent
 * members.
 */

import { useState } from "react";
import { newDashboard } from "../../core/dashboards";
import { newConfigId } from "../../core/ids";
import type { DashboardConfig, WorkspaceSnapshot } from "../../core/types";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { usePlugin } from "../context";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useTabs } from "../tabs-context";
import { DashboardCardContent } from "./DashboardCardContent";
import {
	BrowseCard,
	BrowseCardMenu,
	BrowseEmpty,
	BrowseHeader,
	BrowseList,
} from "./shared";

type DialogState = { mode: "edit"; dashboard: DashboardConfig } | null;

export function DashboardsBrowseView({
	snapshot,
}: {
	snapshot: WorkspaceSnapshot;
}) {
	const plugin = usePlugin();
	const { openDashboard } = useTabs();

	const [menuId, setMenuId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [deleting, setDeleting] = useState<DashboardConfig | null>(null);

	const dashboards = [...snapshot.dashboards].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	const duplicate = (dashboard: DashboardConfig) => {
		const copy: DashboardConfig = {
			...dashboard,
			id: newConfigId("dashboard"),
			name: `${dashboard.name} copy`,
			widgets: dashboard.widgets.map((w) => ({ ...w })),
		};
		void plugin.mutations
			.addDashboard(snapshot, copy)
			.then(() => openDashboard(copy.id));
	};

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Dashboards"
				noun="dashboard"
				count={dashboards.length}
				idPrefix={snapshot.workspace.idPrefix}
				actionLabel="New dashboard"
				onAction={() => setCreating(true)}
			/>

			{dashboards.length === 0 ? (
				<BrowseEmpty label="dashboards" actionLabel="New dashboard" />
			) : (
				<BrowseList>
					{dashboards.map((dashboard) => (
						<BrowseCard
							key={dashboard.id}
							onClick={() => openDashboard(dashboard.id)}
							trailing={
								<BrowseCardMenu
									open={menuId === dashboard.id}
									onToggle={() =>
										setMenuId((m) =>
											m === dashboard.id ? null : dashboard.id,
										)
									}
									onClose={() => setMenuId(null)}
								>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuId(null);
											setDialog({ mode: "edit", dashboard });
										}}
									>
										Edit
									</button>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuId(null);
											duplicate(dashboard);
										}}
									>
										Duplicate
									</button>
									<button
										className="vf-menu-item vf-menu-item-danger"
										onClick={() => {
											setMenuId(null);
											setDeleting(dashboard);
										}}
									>
										Move to Trash
									</button>
								</BrowseCardMenu>
							}
						>
							<DashboardCardContent dashboard={dashboard} />
						</BrowseCard>
					))}
				</BrowseList>
			)}

			{creating && (
				<NamedIconDialog
					title="New dashboard"
					initialName="New dashboard"
					initialIcon="layout-dashboard"
					initialDescription=""
					descriptionSourcePath={`${snapshot.workspace.root}/Untitled`}
					iconFallback="layout-dashboard"
					confirmLabel="Create"
					onConfirm={(name, icon, description) => {
						const dashboard = {
							...newDashboard(newConfigId("dashboard"), "New dashboard"),
							name,
							icon,
							description: description?.trim() || undefined,
						};
						void plugin.mutations
							.addDashboard(snapshot, dashboard)
							.then(() => openDashboard(dashboard.id));
					}}
					onClose={() => setCreating(false)}
				/>
			)}

			{dialog && (
				<NamedIconDialog
					title="Edit dashboard"
					initialName={dialog.dashboard.name}
					initialIcon={dialog.dashboard.icon}
					iconFallback="layout-dashboard"
					confirmLabel="Save"
					onConfirm={(name, icon) =>
						void plugin.mutations.updateDashboard(snapshot, {
							...dialog.dashboard,
							name,
							icon,
						})
					}
					onClose={() => setDialog(null)}
				/>
			)}

			{deleting && (
				<ConfirmDeleteDialog
					title={`Delete dashboard "${deleting.name}"?`}
					body={`Removes the dashboard and its ${deleting.widgets.length} chart${deleting.widgets.length === 1 ? "" : "s"}. Tasks are not affected. You can restore it anytime from the Trash view.`}
					onCancel={() => setDeleting(null)}
					onConfirm={() => {
						void plugin.mutations.deleteDashboard(snapshot, deleting.id);
						setDeleting(null);
					}}
				/>
			)}
		</div>
	);
}
