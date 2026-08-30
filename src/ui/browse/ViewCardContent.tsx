/**
 * The body of a Saved View card — icon, name, and a one-line meta built from
 * real fields only: the layout ("List" / "Board" / …) plus a filter count when
 * the view has any filters set. `SavedView` tracks no created/updated date, so
 * there's none to show.
 */

import type { SavedView } from "../../core/types";
import { layoutIcon } from "../../core/views";
import { Icon } from "../components/Icon";
import { BrowseMeta, pluralize } from "./shared";

/** Number of filter facets the view actually constrains. */
function activeFilterCount(filters: SavedView["filters"]): number {
	return Object.values(filters).filter((value) =>
		Array.isArray(value)
			? value.length > 0
			: value !== undefined && value !== null && value !== "",
	).length;
}

export function ViewCardContent({ view }: { view: SavedView }) {
	const layoutLabel =
		view.viewType.charAt(0).toUpperCase() + view.viewType.slice(1);
	const filterCount = activeFilterCount(view.filters);

	return (
		<>
			<div className="vf-browse-card-top">
				<span className="vf-browse-card-icon" aria-hidden>
					<Icon
						id={view.icon}
						fallback={layoutIcon(view.viewType)}
						size={15}
					/>
				</span>
				<span className="vf-browse-title">{view.name}</span>
			</div>
			<BrowseMeta>
				<span>
					{filterCount > 0
						? `${layoutLabel} · ${pluralize(filterCount, "filter")}`
						: layoutLabel}
				</span>
			</BrowseMeta>
		</>
	);
}
