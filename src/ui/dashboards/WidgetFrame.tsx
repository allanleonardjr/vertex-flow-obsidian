/**
 * One dashboard grid cell: a header (editable title + kebab menu) above the
 * chart body. The RGL drag handle is the header — `.vf-dash-widget-head` —
 * declared on the grid via `draggableHandle`.
 */

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { DashboardWidget } from "../../core/types";
import type { WidgetData } from "../../core/dashboards";
import { Popover } from "../components/Popover";
import { useDebouncedSave } from "../components/fields";
import { WidgetChart, type SegmentClick } from "./charts/WidgetChart";

export function WidgetFrame({
	widget,
	data,
	onRename,
	onEditConfig,
	onDuplicate,
	onDelete,
	onSegmentClick,
}: {
	widget: DashboardWidget;
	data: WidgetData;
	onRename: (title: string) => void;
	onEditConfig: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onSegmentClick?: (segment: SegmentClick) => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<div className="vf-dash-widget">
			<div className="vf-dash-widget-head">
				<TitleInput
					key={`${widget.id}:${widget.title}`}
					title={widget.title}
					onRename={onRename}
				/>
				<span className="vf-dash-widget-head-spacer" />
				<div
					className="vf-dash-widget-menu"
					onPointerDown={(e) => e.stopPropagation()}
				>
					<button
						type="button"
						className="vf-icon-button"
						aria-label="Widget options"
						aria-expanded={menuOpen}
						onClick={() => setMenuOpen((v) => !v)}
					>
						<MoreHorizontal size={14} />
					</button>
					{menuOpen && (
						<Popover align="right" onClose={() => setMenuOpen(false)}>
							<div className="vf-option-list">
								<button
									type="button"
									className="vf-menu-item"
									onClick={() => {
										setMenuOpen(false);
										onEditConfig();
									}}
								>
									Edit configuration
								</button>
								<button
									type="button"
									className="vf-menu-item"
									onClick={() => {
										setMenuOpen(false);
										onDuplicate();
									}}
								>
									Duplicate chart
								</button>
								<button
									type="button"
									className="vf-menu-item vf-menu-item-danger"
									onClick={() => {
										setMenuOpen(false);
										onDelete();
									}}
								>
									Delete chart
								</button>
							</div>
						</Popover>
					)}
				</div>
			</div>

			<div className="vf-dash-widget-body">
				<WidgetChart
					widget={widget}
					data={data}
					onSegmentClick={onSegmentClick}
				/>
			</div>
		</div>
	);
}

/** Chrome-less title field: reads as the heading until focused. */
function TitleInput({
	title,
	onRename,
}: {
	title: string;
	onRename: (title: string) => void;
}) {
	const [value, setValue, flush] = useDebouncedSave(title, (next) => {
		const trimmed = next.trim();
		if (trimmed && trimmed !== title) onRename(trimmed);
	});

	return (
		<input
			type="text"
			className="vf-dash-widget-title"
			// `size` is the width fallback where `field-sizing: content` isn't
			// supported — same trick as `EditableTitle`.
			size={Math.max(4, Math.min(value.length + 1, 60))}
			value={value}
			aria-label="Chart title"
			spellCheck={false}
			onPointerDown={(e) => e.stopPropagation()}
			onChange={(e) => setValue(e.target.value)}
			onBlur={flush}
		/>
	);
}
