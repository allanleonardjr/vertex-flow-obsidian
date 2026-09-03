/**
 * One label's tab: a collapsible description (the label's own free-text, edited
 * through the same mutation as the create/edit dialog) above the task viewport
 * filtered to that label. A label's description lives in the workspace taxonomy,
 * not a note, so there is no raw-source/`open note` escape hatch here — but the
 * description collapsible behaves exactly like the Project and Saved View ones.
 */

import { useEffect, useState } from "react";
import type { ViewContext } from "../core/views";
import type { WorkspaceTaxonomies } from "../core/taxonomy";
import { findTaxonomyUsage, workspaceTaxonomies } from "../core/taxonomy";
import type { WorkspaceSnapshot } from "../core/types";
import { DescriptionSection } from "./components/DescriptionSection";
import { LabelChip } from "./components/TaskBits";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import { labelView } from "./App";
import { TaskViewport } from "./views/TaskViewport";

export function LabelDetailView({
	labelId,
	snapshot,
	taxonomies,
	context,
	containerRef,
	active,
	onSelectView,
}: {
	labelId: string;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
	containerRef: HTMLElement | null;
	active: boolean;
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const { closeActive } = useTabs();

	const label =
		workspaceTaxonomies(snapshot.workspace).label.values.find(
			(v) => v.id === labelId,
		) ?? null;

	const gone = !label;
	useEffect(() => {
		if (gone) closeActive();
	}, [gone, closeActive]);

	if (!label) return null;

	const usage = findTaxonomyUsage("label", label.id, {
		tasks: snapshot.tasks,
		projects: snapshot.projects,
	});

	return (
		<LabelEditor
			key={label.id}
			labelId={label.id}
			labelName={label.name}
			labelColor={label.color}
			labelDescription={label.description ?? ""}
			taskCount={usage.count}
			snapshot={snapshot}
			taxonomies={taxonomies}
			context={context}
			containerRef={containerRef}
			active={active}
			onSelectView={onSelectView}
		/>
	);
}

function LabelEditor({
	labelId,
	labelName,
	labelColor,
	labelDescription,
	taskCount,
	snapshot,
	taxonomies,
	context,
	containerRef,
	active,
	onSelectView,
}: {
	labelId: string;
	labelName: string;
	labelColor: string;
	labelDescription: string;
	taskCount: number;
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
	context: ViewContext;
	containerRef: HTMLElement | null;
	active: boolean;
	onSelectView: (id: string) => void;
}) {
	const plugin = usePlugin();
	const [descCollapsed, setDescCollapsed] = useState(
		plugin.settings.descriptionCollapsed,
	);
	const [descSourceMode, setDescSourceMode] = useState(
		plugin.settings.descriptionSourceMode,
	);

	const toggleDescription = () => {
		const next = !descCollapsed;
		setDescCollapsed(next);
		plugin.settings.descriptionCollapsed = next;
		void plugin.saveSettings();
	};

	const toggleSourceMode = () => {
		const next = !descSourceMode;
		setDescSourceMode(next);
		plugin.settings.descriptionSourceMode = next;
		void plugin.saveSettings();
	};

	return (
		<>
			<header className="vf-editor-header vf-label-editor-header">
				<LabelChip name={labelName} color={labelColor} className="vf-label-editor-chip" />
				<span className="vf-count">
					{taskCount} {taskCount === 1 ? "task" : "tasks"}
				</span>
				<span className="vf-editor-spacer" />
			</header>

			<div className="vf-editor-body">
				<div className="vf-editor-main-col">
					<div
						className={`vf-label-editor-info${descCollapsed ? " is-collapsed" : ""}`}
					>
						<DescriptionSection
							collapsed={descCollapsed}
							onToggleCollapsed={toggleDescription}
							sourceMode={descSourceMode}
							onToggleSourceMode={toggleSourceMode}
							value={labelDescription}
							editorKey={labelId}
							sourcePath={`${snapshot.workspace.root}/Untitled`}
							onSave={(text) =>
								void plugin.mutations.updateLabel(snapshot, labelId, {
									description: text.trim() || undefined,
								})
							}
						/>
					</div>
					<div className="vf-label-editor-tasks">
						<TaskViewport
							snapshot={snapshot}
							view={labelView(snapshot, labelId)}
							taxonomies={taxonomies}
							context={context}
							containerRef={containerRef}
							active={active}
							onSelectView={onSelectView}
							hideViewTitle
							guardUnsavedEdits={false}
						/>
					</div>
				</div>
			</div>
		</>
	);
}