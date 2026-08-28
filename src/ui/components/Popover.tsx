/**
 * A lightweight anchored popover — the pattern the workspace switcher in
 * `Sidebar.tsx` open-codes, lifted out so the view-controls Display and Filter
 * panels reuse it. Any click outside closes it; clicks inside don't bubble to
 * that listener or to whatever sits behind the panel.
 */

import { useEffect, type ReactNode } from "react";

export function Popover({
	align = "left",
	onClose,
	children,
}: {
	align?: "left" | "right";
	onClose: () => void;
	children: ReactNode;
}) {
	useEffect(() => {
		const close = () => onClose();
		// Deferred so the same click that opened the popover doesn't immediately
		// close it.
		const id = window.setTimeout(() => window.addEventListener("click", close));
		return () => {
			window.clearTimeout(id);
			window.removeEventListener("click", close);
		};
	}, [onClose]);

	return (
		<div
			className={`vf-popover vf-popover-${align}`}
			role="dialog"
			onClick={(event) => event.stopPropagation()}
		>
			{children}
		</div>
	);
}
