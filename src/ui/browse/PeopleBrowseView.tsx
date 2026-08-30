/**
 * People hub — every person in the workspace, as a card with their usage
 * counts. Second entry point to the same create/edit/delete mutations the
 * sidebar's `PeopleSection` uses, not new logic.
 *
 * Delete is always a single dialog: an unreferenced person goes immediately,
 * a referenced one opens `ReplacePersonDialog` (reassign-or-clear) — never
 * Labels' confirm-then-maybe-reassign two-step, since Person deletion is never
 * simply "blocked".
 */

import { useState } from "react";
import {
	findPersonUsage,
	planPersonDeletion,
	type PersonDeletionPlan,
} from "../../core/people";
import type { Person, WorkspaceSnapshot } from "../../core/types";
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

export function PeopleBrowseView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { openPerson } = useTabs();
	const people = [...snapshot.workspace.people].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

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

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="People"
				noun="person"
				plural="people"
				count={people.length}
				actionLabel="New person"
				onAction={() => setCreating(true)}
			/>

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
