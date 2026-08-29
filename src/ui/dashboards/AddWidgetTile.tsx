/**
 * The dotted-border "+" tile shown when a dashboard has no widgets yet.
 * Clicking it opens the widget config flow.
 */

import { Plus } from "lucide-react";

export function AddWidgetTile({ onClick }: { onClick: () => void }) {
	return (
		<button type="button" className="vf-dash-add-tile" onClick={onClick}>
			<span className="vf-dash-add-tile-plus" aria-hidden>
				<Plus size={28} />
			</span>
			<span>Add a chart</span>
		</button>
	);
}
