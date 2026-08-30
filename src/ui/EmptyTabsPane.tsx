/**
 * What the shell shows when *no tab is open at all* (A4) — distinct from "a view
 * is open but has zero tasks", which `EmptyView` still handles. Reachable now
 * that every tab, All Tasks and Inbox included, is closable.
 *
 * `BrowseHubPane` (B3) reuses the same visual for the Dashboards / Views hub
 * placeholders — real, reachable singleton tabs, just with nothing built behind
 * them yet.
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
				<kbd>g</kbd> <kbd>a</kbd> All Tasks
				<span aria-hidden> · </span>
				<kbd>g</kbd> <kbd>i</kbd> Inbox
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

const HUB: Record<"dashboards" | "views", { icon: string; title: string }> = {
	dashboards: { icon: "layout-dashboard", title: "Dashboards hub — coming soon" },
	views: { icon: "list", title: "Views hub — coming soon" },
};

export function BrowseHubPane({ kind }: { kind: "dashboards" | "views" }) {
	const { icon, title } = HUB[kind];
	return (
		<div className="vf-app-background vf-view-empty">
			<span className="vf-view-empty-icon" aria-hidden>
				<Icon id={icon} fallback="list" size={33} />
			</span>
			<p className="vf-view-empty-title">{title}</p>
			<p className="vf-empty-note">
				For now, {kind === "dashboards" ? "dashboards" : "views"} live in the
				sidebar.
			</p>
		</div>
	);
}
