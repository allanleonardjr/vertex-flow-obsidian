/**
 * A help affordance shown right after the "Type" label in the editor rail when
 * the workspace has no default task type configured. Clicking it opens a small
 * panel that explains a default can be set and links straight to the "Task
 * creation" section of workspace settings.
 *
 * The panel is portaled to `document.body` and positioned from the icon, then
 * clamped to the viewport: the editor rail is an overflow-scroll container, so
 * an in-flow popover anchored to this icon (which sits near the rail's left
 * edge) would be clipped off the left side.
 */

import {
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { useTabs } from "../tabs-context";

/** The `id` on `TaskDefaultsSection`'s `<section>` — the scroll anchor. */
export const TASK_DEFAULTS_ANCHOR = "vf-settings-task-defaults";

const PANEL_WIDTH = 240;
/** Breathing room kept between the panel and the window edge. */
const MARGIN = 8;

export function DefaultTaskTypeHint() {
	const { openScreen } = useTabs();
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const btnRef = useRef<HTMLButtonElement>(null);

	const place = useCallback(() => {
		const rect = btnRef.current?.getBoundingClientRect();
		if (!rect) return;
		const left = Math.min(
			Math.max(MARGIN, rect.left),
			window.innerWidth - PANEL_WIDTH - MARGIN,
		);
		setPos({ top: rect.bottom + 6, left });
	}, []);

	useLayoutEffect(() => {
		if (!open) return;
		place();
		// Follow the anchor rather than close — the editor rail scrolls.
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		const onOutside = () => setOpen(false);
		const id = window.setTimeout(() =>
			window.addEventListener("click", onOutside),
		);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("click", onOutside);
		};
	}, [open, place]);

	return (
		<>
			<button
				ref={btnRef}
				type="button"
				className="vf-inline-help"
				aria-label="About the default task type"
				aria-expanded={open}
				title="No default task type is set for this workspace"
				onClick={(event) => {
					event.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				<CircleHelp size={14} aria-hidden />
			</button>
			{open &&
				pos &&
				createPortal(
					<div
						className="vf-hint-popover"
						role="dialog"
						style={{
							position: "fixed",
							top: pos.top,
							left: pos.left,
							width: PANEL_WIDTH,
						}}
						onClick={(event) => event.stopPropagation()}
					>
						<p>
							New tasks start with no type because this workspace has no
							default task type set.
						</p>
						<button
							type="button"
							className="vf-link-button"
							onClick={() => {
								setOpen(false);
								openScreen("settings", TASK_DEFAULTS_ANCHOR);
							}}
						>
							Set a default in workspace settings
						</button>
					</div>,
					document.body,
				)}
		</>
	);
}
