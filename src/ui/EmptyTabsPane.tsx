/**
 * What the shell shows when *no tab is open at all* (A4) — distinct from "a view
 * is open but has zero tasks", which `EmptyView` still handles. Reachable now
 * that every tab, All Tasks and Untriaged included, is closable.
 */

import { Icon } from "./components/Icon";

export function EmptyTabsPane() {
	return (
		<div className="vf-app-background vf-view-empty vf-empty-tabs">
			<span className="vf-view-empty-icon" aria-hidden>
				<Icon id="layout-grid" fallback="list" size={33} />
			</span>
			<p className="vf-view-empty-title">No tabs open</p>
			<p className="vf-empty-note vf-empty-tabs-hints">
				<kbd>g</kbd> <kbd>i</kbd> Untriaged
				<span aria-hidden> · </span>
				<kbd>g</kbd> <kbd>a</kbd> All Tasks
				<span aria-hidden> · </span>
				<kbd>c</kbd> <kbd>t</kbd> New task
				<span aria-hidden> · </span>
				<kbd>c</kbd> <kbd>p</kbd> New project
				<span aria-hidden> · </span>
				<kbd>?</kbd> All shortcuts
			</p>
		</div>
	);
}
