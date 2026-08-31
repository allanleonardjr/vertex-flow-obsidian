/**
 * Views hub — every user Saved View in the workspace as a card, with an
 * Edit / Duplicate / Delete row menu mirroring `ViewsSection` in the sidebar
 * exactly. The two System Views (All Tasks, Untriaged) are filtered out — they
 * have a permanent home as bare sidebar rows and none of these actions apply.
 */

import { useState } from "react";
import { newConfigId } from "../../core/ids";
import type { SavedView, WorkspaceSnapshot } from "../../core/types";
import { isSystemViewId, layoutIcon, newView } from "../../core/views";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { usePlugin } from "../context";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useTabs } from "../tabs-context";
import { ViewCardContent } from "./ViewCardContent";
import {
	BrowseCard,
	BrowseCardMenu,
	BrowseEmpty,
	BrowseHeader,
	BrowseList,
} from "./shared";

type DialogState =
	| { mode: "create"; view: SavedView }
	| { mode: "edit"; view: SavedView }
	| null;

export function ViewsBrowseView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { openView } = useTabs();

	const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [deleting, setDeleting] = useState<SavedView | null>(null);

	const views = snapshot.views.filter((v) => !isSystemViewId(v.id));

	const create = () => {
		const view = newView(newConfigId("view"), "New view", "list");
		void plugin.mutations.addView(snapshot, view).then(() => {
			openView(view.id);
			setDialog({ mode: "create", view });
		});
	};

	const duplicate = (view: SavedView) => {
		const copy: SavedView = {
			...view,
			id: newConfigId("view"),
			name: `${view.name} copy`,
		};
		void plugin.mutations.addView(snapshot, copy).then(() => openView(copy.id));
	};

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Views"
				noun="view"
				count={views.length}
				actionLabel="New view"
				onAction={create}
			/>

			{views.length === 0 ? (
				<BrowseEmpty label="views" actionLabel="New view" />
			) : (
				<BrowseList>
					{views.map((view) => (
						<BrowseCard
							key={view.id}
							onClick={() => openView(view.id)}
							trailing={
								<BrowseCardMenu
									open={menuOpenId === view.id}
									onToggle={() =>
										setMenuOpenId((current) =>
											current === view.id ? null : view.id,
										)
									}
									onClose={() => setMenuOpenId(null)}
								>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuOpenId(null);
											setDialog({ mode: "edit", view });
										}}
									>
										Edit
									</button>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuOpenId(null);
											duplicate(view);
										}}
									>
										Duplicate
									</button>
									<button
										className="vf-menu-item vf-menu-item-danger"
										onClick={() => {
											setMenuOpenId(null);
											setDeleting(view);
										}}
									>
										Move to Trash
									</button>
								</BrowseCardMenu>
							}
						>
							<ViewCardContent view={view} />
						</BrowseCard>
					))}
				</BrowseList>
			)}

			{deleting && (
				<ConfirmDeleteDialog
					title={`Delete view "${deleting.name}"?`}
					body="The view definition is removed. Tasks are not affected. You can restore it anytime from the Trash view."
					onCancel={() => setDeleting(null)}
					onConfirm={() => {
						void plugin.mutations.deleteView(snapshot, deleting.id);
						setDeleting(null);
					}}
				/>
			)}

			{dialog && (
				<NamedIconDialog
					title={dialog.mode === "create" ? "Name your view" : "Edit view"}
					initialName={dialog.view.name}
					initialIcon={dialog.view.icon}
					iconFallback={layoutIcon(dialog.view.viewType)}
					confirmLabel={dialog.mode === "create" ? "Create" : "Save"}
					onConfirm={(name, icon) =>
						void plugin.mutations.updateView(snapshot, {
							...dialog.view,
							name,
							icon,
						})
					}
					// Cancelling the "name your new view" step discards the view that
					// was auto-created to open it; App's `pruneViews` then closes its
					// tab.
					onCancel={
						dialog.mode === "create"
							? () =>
									void plugin.mutations.deleteView(
										snapshot,
										dialog.view.id,
									)
							: undefined
					}
					onClose={() => setDialog(null)}
				/>
			)}
		</div>
	);
}
