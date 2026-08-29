/**
 * The ancestor trail above the task editor: `Project › … › parent › THIS`.
 *
 * Obsidian's native surfaces show a task's ID, never its title, so walking *up*
 * the hierarchy by name matters more here than it does in Linear — hence the
 * full chain (collapsed in the middle past two levels) rather than Linear's
 * single-hop parent chip. The rail's Parent picker is the *editor*; this is
 * navigation.
 *
 * Reads `ancestorTasks` from core (cycle-safe). Renders nothing when the task
 * has neither a parent task nor a project.
 */

import { useState } from "react";
import { ancestorTasks, scopeOf } from "../../core/hierarchy";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { Task, WorkspaceSnapshot } from "../../core/types";
import { basename } from "../../core/links";
import { useTabs } from "../tabs-context";
import { Icon } from "./Icon";
import { StatusDot } from "./TaskBits";

/** Ancestors past this many collapse to a "…" the reader can expand. */
const COLLAPSE_ABOVE = 2;

export function TaskBreadcrumb({
	task,
	snapshot,
	taxonomies,
	onOpenTask,
}: {
	task: Task;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	onOpenTask: (path: string) => void;
}) {
	const { openProject } = useTabs();
	const [expanded, setExpanded] = useState(false);

	if (!task.parent && !task.project) return null;

	// Nearest-first from core; the trail reads root-first.
	const ancestors = [...ancestorTasks(scopeOf(snapshot), task)].reverse();

	const project = task.project
		? snapshot.projects.find((p) => p.path === task.project)
		: undefined;
	const projectLabel = task.project
		? (project?.title ?? basename(task.project))
		: null;

	const collapse = !expanded && ancestors.length > COLLAPSE_ABOVE;
	const shown = collapse ? [ancestors[0], ...ancestors.slice(-1)] : ancestors;

	return (
		<nav className="vf-editor-breadcrumb" aria-label="Task location">
			{projectLabel != null && (
				<>
					<button
						type="button"
						className="vf-crumb"
						onClick={() => task.project && openProject(task.project)}
					>
						<Icon id={project?.icon} fallback="folder" size={12} />
						<span className="vf-crumb-name">{projectLabel}</span>
					</button>
					<Separator />
				</>
			)}

			{shown.map((ancestor, index) => (
				<span key={ancestor.path} className="vf-crumb-seg">
					<button
						type="button"
						className="vf-crumb"
						onClick={() => onOpenTask(ancestor.path)}
					>
						<StatusDot taxonomies={taxonomies} status={ancestor.status} />
						<span className="vf-id">{ancestor.id}</span>
						<span className="vf-crumb-name">{ancestor.title}</span>
					</button>
					{collapse && index === 0 ? (
						<>
							<Separator />
							<button
								type="button"
								className="vf-crumb vf-crumb-ellipsis"
								title={`Show ${ancestors.length - 2} more`}
								onClick={() => setExpanded(true)}
							>
								…
							</button>
						</>
					) : null}
					<Separator />
				</span>
			))}

			<span className="vf-crumb vf-crumb-current">{task.id}</span>
		</nav>
	);
}

function Separator() {
	return (
		<span className="vf-crumb-sep" aria-hidden>
			›
		</span>
	);
}
