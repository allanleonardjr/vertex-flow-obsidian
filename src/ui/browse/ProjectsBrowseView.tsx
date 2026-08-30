/**
 * Projects hub — every Project in the workspace, as a card with its status,
 * task count, and computed progress. Each card carries an Edit / Duplicate row
 * menu, matching what `ProjectsSection` offers in the sidebar.
 *
 * Deliberately *not* a Saved View (those filter Tasks, not Projects) — it's a
 * plain manager list. There is no Delete here: project deletion is explicitly
 * deferred, from both this hub and the sidebar.
 */

import { useState } from "react";
import { isProjectTitleTaken } from "../../core/serialization";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Project, WorkspaceSnapshot } from "../../core/types";
import { withoutExtension } from "../../obsidian/note-io";
import { useCreateProject } from "../actions";
import { usePlugin } from "../context";
import { NamedIconDialog } from "../modals/NamedIconDialog";
import { useTabs } from "../tabs-context";
import { ProjectCardContent } from "./ProjectCardContent";
import {
	BrowseCard,
	BrowseCardMenu,
	BrowseEmpty,
	BrowseHeader,
	BrowseList,
} from "./shared";

export function ProjectsBrowseView({
	snapshot,
	taxonomies,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	const plugin = usePlugin();
	const createProject = useCreateProject();
	const tabs = useTabs();

	const [menuPath, setMenuPath] = useState<string | null>(null);
	const [editing, setEditing] = useState<Project | null>(null);

	const duplicate = (project: Project) => {
		void plugin.mutations
			.duplicateProject(snapshot, project)
			.then((file) => tabs.openProject(withoutExtension(file.path)));
	};

	return (
		<div className="vf-browse">
			<BrowseHeader
				title="Projects"
				noun="project"
				count={snapshot.projects.length}
				actionLabel="New project"
				onAction={() => void createProject(snapshot)}
			/>

			{snapshot.projects.length === 0 ? (
				<BrowseEmpty label="projects" actionLabel="New project" />
			) : (
				<BrowseList>
					{snapshot.projects.map((project) => (
						<BrowseCard
							key={project.path}
							onClick={() => tabs.openProject(project.path)}
							trailing={
								<BrowseCardMenu
									open={menuPath === project.path}
									onToggle={() =>
										setMenuPath((p) =>
											p === project.path ? null : project.path,
										)
									}
									onClose={() => setMenuPath(null)}
								>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuPath(null);
											setEditing(project);
										}}
									>
										Edit
									</button>
									<button
										className="vf-menu-item"
										onClick={() => {
											setMenuPath(null);
											duplicate(project);
										}}
									>
										Duplicate
									</button>
								</BrowseCardMenu>
							}
						>
							<ProjectCardContent
								snapshot={snapshot}
								taxonomies={taxonomies}
								project={project}
							/>
						</BrowseCard>
					))}
				</BrowseList>
			)}

			{editing && (
				<NamedIconDialog
					title="Edit project"
					initialName={editing.title}
					initialIcon={editing.icon}
					iconFallback="folder"
					confirmLabel="Save"
					validateName={(name) =>
						isProjectTitleTaken(snapshot.projects, name, editing.path)
							? `A project named "${name.trim()}" already exists`
							: null
					}
					onConfirm={(name, icon) =>
						void plugin.mutations.updateProject(editing, {
							title: name,
							icon,
						})
					}
					onClose={() => setEditing(null)}
				/>
			)}
		</div>
	);
}
