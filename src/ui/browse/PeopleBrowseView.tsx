/**
 * People hub — every person in the workspace, as a card with their usage
 * counts. Second entry point to the same create/edit/delete mutations the
 * sidebar's `PeopleSection` uses, not new logic.
 *
 * Delete is always a single dialog: an unreferenced person goes immediately,
 * a referenced one opens `ReplacePersonDialog` (reassign-or-clear) — never
 * Labels' confirm-then-maybe-reassign two-step, since Person deletion is never
 * simply "blocked".
 *
 * The header carries a fixed, non-configurable 2-up hero chart row (task
 * assignee + status distribution across the whole workspace) behind a
 * show/hide toggle — same pattern as `ProjectsBrowseView`. Plain
 * `DashboardWidget` objects fed through the real `computeWidgetData` /
 * `WidgetChart` pipeline, never persisted to a `DashboardConfig`.
 */

import { useMemo, useState } from "react";
import {
	findPersonUsage,
	planPersonDeletion,
	type PersonDeletionPlan,
} from "../../core/people";
import type { DashboardWidget, Person, WorkspaceSnapshot } from "../../core/types";
import { computeWidgetData } from "../../core/dashboards";
import { snapshotContext } from "../../core/views";
import { WidgetChart } from "../dashboards/charts/WidgetChart";
import { PersonDialog } from "../modals/PersonDialog";
import { ReplacePersonDialog } from "../modals/ReplacePersonDialog";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";
import { PersonCardContent } from "./PersonCardContent";
import {
	BrowseCard,
	BrowseCardMenu,
	BrowseEmpty,
	BrowseHeader,
	BrowseList,
} from "./shared";

/**
 * Fixed hero-chart presets for the People hub header — task-level assignee
 * and status distribution across every task in the workspace. Not
 * user-configurable and never persisted to a `DashboardConfig`; `layout` is
 * unused since these never go through `DashboardGrid`.
 */
const HERO_ASSIGNEE_WIDGET: DashboardWidget = {
	id: "hero-assignee",
	chartType: "bar",
	title: "Tasks by Assignee",
	titleIsCustom: true,
	fieldMapping: { chartType: "bar", groupBy: "assignee" },
	layout: { x: 0, y: 0, w: 0, h: 0 },
};

const HERO_STATUS_WIDGET: DashboardWidget = {
	id: "hero-status",
	chartType: "pie",
	title: "Tasks by Status",
	titleIsCustom: true,
	fieldMapping: { chartType: "pie", groupBy: "status" },
	layout: { x: 0, y: 0, w: 0, h: 0 },
};

export function PeopleBrowseView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { openPerson } = useTabs();
	const people = [...snapshot.workspace.people].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	const [showHeroCharts, setShowHeroCharts] = useState(true);
	const [menuId, setMenuId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<PersonDeletionPlan | null>(null);

	const editPerson = people.find((p) => p.id === editing);

	const requestDelete = (person: Person) => {
		const usage = findPersonUsage(person.id, {
			tasks: snapshot.tasks,
			projects: snapshot.projects,
			commentCount:
				plugin.index.commentCountsByPerson(snapshot.workspace.root)[
					person.id
				] ?? 0,
		});
		if (usage.count === 0) {
			void plugin.mutations.deletePerson(snapshot, person.id, null);
			return;
		}
		setDeleting(planPersonDeletion(person, snapshot.workspace.people, usage));
	};

	const context = useMemo(() => snapshotContext(snapshot), [snapshot]);
	const assigneeData = useMemo(
		() => computeWidgetData(HERO_ASSIGNEE_WIDGET, snapshot.tasks, context),
		[snapshot.tasks, context],
	);
	const statusData = useMemo(
		() => computeWidgetData(HERO_STATUS_WIDGET, snapshot.tasks, context),
		[snapshot.tasks, context],
	);

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="People"
				noun="person"
				plural="people"
				count={people.length}
				idPrefix={snapshot.workspace.idPrefix}
				actionLabel="New person"
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
									{HERO_ASSIGNEE_WIDGET.title}
								</span>
							</div>
							<div className="vf-dash-widget-body">
								<WidgetChart widget={HERO_ASSIGNEE_WIDGET} data={assigneeData} />
							</div>
						</div>
					</div>
					<div className="vf-browse-hero-chart">
						<div className="vf-dash-widget">
							<div className="vf-dash-widget-head">
								<span className="vf-browse-hero-chart-title">
									{HERO_STATUS_WIDGET.title}
								</span>
							</div>
							<div className="vf-dash-widget-body">
								<WidgetChart widget={HERO_STATUS_WIDGET} data={statusData} />
							</div>
						</div>
					</div>
				</div>
			)}

			{people.length === 0 ? (
				<BrowseEmpty label="people" actionLabel="New person" />
			) : (
				<BrowseList>
					{people.map((person) => (
						<BrowseCard
							key={person.id}
							onClick={() => openPerson(person.id)}
							trailing={
								<BrowseCardMenu
									open={menuId === person.id}
									onToggle={() =>
										setMenuId((m) => (m === person.id ? null : person.id))
									}
									onClose={() => setMenuId(null)}
								>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuId(null);
											setEditing(person.id);
										}}
									>
										Edit
									</button>
									<button
										className="vf-menu-item vf-menu-item-danger"
										onClick={() => {
											setMenuId(null);
											requestDelete(person);
										}}
									>
										Delete
									</button>
								</BrowseCardMenu>
							}
						>
							<PersonCardContent snapshot={snapshot} person={person} />
						</BrowseCard>
					))}
				</BrowseList>
			)}

			{creating && (
				<PersonDialog
					title="New person"
					initialName=""
					confirmLabel="Create"
					onConfirm={(name, aliases) =>
						plugin.mutations.createPerson(snapshot, name, aliases).then(() => {})
					}
					onClose={() => setCreating(false)}
				/>
			)}

			{editPerson && (
				<PersonDialog
					title="Edit person"
					initialName={editPerson.name}
					initialAliases={editPerson.aliases}
					confirmLabel="Save"
					onConfirm={(name, aliases) =>
						plugin.mutations.updatePerson(snapshot, editPerson.id, {
							name,
							aliases,
						})
					}
					onClose={() => setEditing(null)}
				/>
			)}

			{deleting && (
				<ReplacePersonDialog
					plan={deleting}
					onCancel={() => setDeleting(null)}
					onConfirm={(replacementId) => {
						void plugin.mutations.deletePerson(
							snapshot,
							deleting.personId,
							replacementId,
						);
						setDeleting(null);
					}}
				/>
			)}
		</div>
	);
}
