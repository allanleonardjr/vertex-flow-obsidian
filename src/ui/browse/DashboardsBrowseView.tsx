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

type DialogState =
	| { mode: "create"; dashboard: DashboardConfig }
	| { mode: "edit"; dashboard: DashboardConfig }
	| null;

export function DashboardsBrowseView({
	snapshot,
}: {
	snapshot: WorkspaceSnapshot;
}) {
	const plugin = usePlugin();
	const { openDashboard } = useTabs();

	const [menuId, setMenuId] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [deleting, setDeleting] = useState<DashboardConfig | null>(null);

	const dashboards = [...snapshot.dashboards].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	const create = () => {
		const dashboard = newDashboard(newConfigId("dashboard"), "New dashboard");
		void plugin.mutations.addDashboard(snapshot, dashboard).then(() => {
			openDashboard(dashboard.id);
			setDialog({ mode: "create", dashboard });
		});
	};

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
				actionLabel="New dashboard"
				onAction={create}
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

			{dialog && (
				<NamedIconDialog
					title={
						dialog.mode === "create"
							? "Name your dashboard"
							: "Edit dashboard"
					}
					initialName={dialog.dashboard.name}
					initialIcon={dialog.dashboard.icon}
					iconFallback="layout-dashboard"
					confirmLabel={dialog.mode === "create" ? "Create" : "Save"}
					onConfirm={(name, icon) =>
						void plugin.mutations.updateDashboard(snapshot, {
							...dialog.dashboard,
							name,
							icon,
						})
					}
					// Cancelling the "name your new dashboard" step discards the
					// dashboard that was auto-created to open it; App's
					// `pruneDashboards` then closes its tab.
					onCancel={
						dialog.mode === "create"
							? () =>
									void plugin.mutations.deleteDashboard(
										snapshot,
										dialog.dashboard.id,
									)
							: undefined
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
