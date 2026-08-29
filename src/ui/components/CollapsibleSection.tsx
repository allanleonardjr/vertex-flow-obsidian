/**
 * A task-editor section (Sub-tasks, Relations, Comments) with a collapsible
 * header, matching the Description section's toggle. Each section remembers its
 * own open/closed state per install, keyed by `id`.
 */

import { useState, type ReactNode } from "react";
import { usePlugin } from "../context";

export function CollapsibleSection({
	id,
	title,
	aside,
	children,
}: {
	/** Stable key for persisting the collapsed state. */
	id: string;
	title: string;
	/** Optional trailing content in the header — e.g. a progress bar. */
	aside?: ReactNode;
	children: ReactNode;
}) {
	const plugin = usePlugin();
	const [collapsed, setCollapsed] = useState(
		plugin.settings.editorSectionsCollapsed[id] === true,
	);

	const toggle = () => {
		const next = !collapsed;
		setCollapsed(next);
		plugin.settings.editorSectionsCollapsed = {
			...plugin.settings.editorSectionsCollapsed,
			[id]: next,
		};
		void plugin.saveSettings();
	};

	return (
		<section className="vf-editor-section">
			<button
				type="button"
				className="vf-rail-section-toggle vf-editor-section-toggle"
				aria-expanded={!collapsed}
				onClick={toggle}
			>
				<span
					className={`vf-section-chevron${collapsed ? "" : " is-open"}`}
					aria-hidden
				>
					›
				</span>
				{title}
				{aside}
			</button>
			{!collapsed && children}
		</section>
	);
}
