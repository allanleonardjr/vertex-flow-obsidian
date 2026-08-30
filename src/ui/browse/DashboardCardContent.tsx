/**
 * The body of a Dashboard card — icon, name, and a widget count using the same
 * wording `ConfirmDeleteDialog` uses for dashboards ("…and its N charts").
 */

import type { DashboardConfig } from "../../core/types";
import { Icon } from "../components/Icon";
import { BrowseMeta, pluralize } from "./shared";

export function DashboardCardContent({
	dashboard,
}: {
	dashboard: DashboardConfig;
}) {
	const chartCount = dashboard.widgets.length;

	return (
		<>
			<div className="vf-browse-card-top">
				<span className="vf-browse-card-icon" aria-hidden>
					<Icon
						id={dashboard.icon}
						fallback="layout-dashboard"
						size={15}
					/>
				</span>
				<span className="vf-browse-title">{dashboard.name}</span>
			</div>
			<BrowseMeta>
				<span>
					{chartCount === 0
						? "No charts yet"
						: pluralize(chartCount, "chart")}
				</span>
			</BrowseMeta>
		</>
	);
}
