/**
 * Workspace settings: taxonomy configuration plus the workspace-level
 * toggles from `_workspace.md`. Reachable from the sidebar's Settings
 * row, rendered inline like the browse screens — no modal, just another thing
 * the content area shows.
 */

import { useLayoutEffect, useRef } from "react";
import { workspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { useTabs } from "../tabs-context";
import { AiChatSection } from "./AiChatSection";
import { ArchivingSection } from "./ArchivingSection";
import { GeneralSection } from "./GeneralSection";
import { HistorySection } from "./HistorySection";
import { McpSection } from "./McpSection";
import { PeopleSection } from "./PeopleSection";
import { TaskDefaultsSection } from "./TaskDefaultsSection";
import { TaxonomySection } from "./TaxonomySection";

export function WorkspaceSettingsView({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const taxonomies = workspaceTaxonomies(snapshot.workspace);
	const { pendingScreenAnchor, clearPendingScreenAnchor, getSettingsScrollTop, setSettingsScrollTop } =
		useTabs();
	const bodyRef = useRef<HTMLDivElement | null>(null);

	// Restore where the user left off on remount (this screen fully unmounts on
	// tab switch — see `App.tsx`'s tab-kind ternary). A pending deep-link anchor
	// (e.g. the sidebar "me" banner → People) takes priority and is consumed
	// once; a manual scroll afterwards isn't disturbed. Runs before paint so
	// neither path shows a visible scroll jump.
	useLayoutEffect(() => {
		if (pendingScreenAnchor) {
			const target = bodyRef.current?.querySelector<HTMLElement>(
				`#${CSS.escape(pendingScreenAnchor)}`,
			);
			target?.scrollIntoView({ block: "start", behavior: "auto" });
			clearPendingScreenAnchor();
			return;
		}
		if (bodyRef.current) bodyRef.current.scrollTop = getSettingsScrollTop();
	}, [pendingScreenAnchor, clearPendingScreenAnchor, getSettingsScrollTop]);

	// Keep the scroll position current for the next remount. Lightly throttled
	// via rAF — this fires on every scroll tick, and only needs to be roughly
	// current, not per-pixel-exact.
	const scrollRafRef = useRef<number | null>(null);
	const handleScroll = () => {
		if (scrollRafRef.current != null) return;
		scrollRafRef.current = window.requestAnimationFrame(() => {
			scrollRafRef.current = null;
			if (bodyRef.current) setSettingsScrollTop(bodyRef.current.scrollTop);
		});
	};

	return (
		<div className="vf-settings">
			<header className="vf-toolbar">
				<div className="vf-toolbar-title">
					<h2>Settings - {snapshot.workspace.name}</h2>
				</div>
			</header>

			<div className="vf-settings-body" ref={bodyRef} onScroll={handleScroll}>
				<GeneralSection snapshot={snapshot} />

				<TaxonomySection
					title="Statuses"
					description="Fixed categories (backlog, unstarted, started, completed, canceled) drive progress and filtering — names, colours, and order are all yours."
					kind="status"
					taxonomy={taxonomies.status}
					snapshot={snapshot}
				/>

				<TaxonomySection
					title="Priorities"
					description="Fully flexible and ordered — add or remove as many levels as you want."
					kind="priority"
					taxonomy={taxonomies.priority}
					snapshot={snapshot}
				/>

				<TaxonomySection
					title="Task Types"
					description="No fixed order or category — just a name and a colour."
					kind="taskType"
					taxonomy={taxonomies.taskType}
					snapshot={snapshot}
				/>

				<TaskDefaultsSection
					snapshot={snapshot}
					id="vf-settings-task-defaults"
				/>

				<PeopleSection snapshot={snapshot} id="vf-settings-people" />
				<ArchivingSection snapshot={snapshot} />
				<AiChatSection />
				<McpSection id="vf-settings-mcp" />
				<HistorySection snapshot={snapshot} />
			</div>
		</div>
	);
}
