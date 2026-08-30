/**
 * Shared layout for the Projects browse screen.
 *
 * Deliberately *not* a Saved View (those filter Tasks, not Projects) — it's a
 * plain manager list of every Project, with rollup stats and a "New project"
 * button. Clicking a card opens the in-plugin Project editor
 * (`ProjectDetailView`), where status, priority, labels, dates, owner and the
 * description are all edited; "Open note" and the raw-source section there keep
 * the escape hatch to the file.
 */

import { useEffect, type ReactNode } from "react";
import type { Progress } from "../../core/types";
import { ProgressBar } from "../components/TaskBits";

export function BrowseHeader({
	title,
	noun,
	count,
	actionLabel,
	onAction,
}: {
	title: string;
	/** Singular noun, for the count line: "3 projects". */
	noun: string;
	count: number;
	actionLabel: string;
	onAction: () => void;
}) {
	return (
		<header className="vf-toolbar">
			<div className="vf-toolbar-title">
				<h2>{title}</h2>
				<span className="vf-count">{pluralize(count, noun)}</span>
			</div>
			<div className="vf-toolbar-actions">
				<button className="mod-cta" onClick={onAction}>
					{actionLabel}
				</button>
			</div>
		</header>
	);
}

export function BrowseList({ children }: { children: ReactNode }) {
	return <div className="vf-browse-list">{children}</div>;
}

/**
 * Deliberately *not* `.vf-view-empty` (the List/Board empty state, centered
 * mid-page) — that reads fine as "nothing matched this filter," but a browse
 * screen with zero items yet is still a real page, and centering it made the
 * whole screen look off relative to List's normal flush-top-left layout the
 * moment a workspace had no projects.
 */
export function BrowseEmpty({ label, actionLabel }: { label: string; actionLabel: string }) {
	return (
		<div className="vf-browse-empty">
			<p>No {label} yet.</p>
			<p className="vf-empty-note">Click "{actionLabel}" to create one.</p>
		</div>
	);
}

/**
 * A card with a clickable body and an optional trailing slot for a row menu.
 *
 * The card can't be a single `<button>` wrapping everything — the trailing menu
 * trigger is itself a `<button>`, and nesting is invalid. Same split `NavRow`
 * uses in the sidebar: a body button plus a sibling trailing element, with the
 * border / hover treatment on the outer wrapper so a card with no `trailing`
 * still looks identical.
 */
export function BrowseCard({
	onClick,
	trailing,
	children,
}: {
	onClick: () => void;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="vf-browse-card">
			<button className="vf-browse-card-body" onClick={onClick}>
				{children}
			</button>
			{trailing && <div className="vf-browse-card-trailing">{trailing}</div>}
		</div>
	);
}

/**
 * The `⋯` row menu for a browse card — the card equivalent of the sidebar's
 * `RowMenu`. Opens a `.vf-menu` of `.vf-menu-item` buttons; a window click
 * closes it. Each hub screen owns the open/close state.
 */
export function BrowseCardMenu({
	open,
	onToggle,
	onClose,
	children,
}: {
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
	children: ReactNode;
}) {
	useEffect(() => {
		if (!open) return;
		window.addEventListener("click", onClose);
		return () => window.removeEventListener("click", onClose);
	}, [open, onClose]);

	return (
		<div className="vf-browse-card-menu-anchor">
			<button
				className="vf-browse-card-menu"
				title="Options"
				aria-label="Options"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={(event) => {
					event.stopPropagation();
					onToggle();
				}}
			>
				⋯
			</button>
			{open && (
				<div className="vf-menu" onClick={(event) => event.stopPropagation()}>
					{children}
				</div>
			)}
		</div>
	);
}

export function BrowseMeta({ children }: { children: ReactNode }) {
	return <div className="vf-browse-meta">{children}</div>;
}

export function BrowseProgress({ progress }: { progress: Progress }) {
	// `ProgressBar` already renders the "X/Y done" count — this
	// wrapper exists only to give it a little breathing room in a card.
	if (progress.total === 0) return null;
	return (
		<div className="vf-browse-progress">
			<ProgressBar progress={progress} />
		</div>
	);
}

/** `"Aug 20, 2026"` — browse lists can span years, unlike a due-date chip. */
export function formatFullDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export function pluralize(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
