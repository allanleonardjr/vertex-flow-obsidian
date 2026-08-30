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
	plural,
	count,
	actionLabel,
	onAction,
}: {
	title: string;
	/** Singular noun, for the count line: "3 projects". */
	noun: string;
	/** Irregular plural, when `noun + "s"` is wrong ("people", not "persons"). */
	plural?: string;
	count: number;
	/** Omitted — like the Trash hub — the header shows just the title + count. */
	actionLabel?: string;
	onAction?: () => void;
}) {
	return (
		<header className="vf-toolbar">
			<div className="vf-toolbar-title">
				<h2>{title}</h2>
				<span className="vf-count">
					{count === 1 ? `1 ${noun}` : `${count} ${plural ?? `${noun}s`}`}
				</span>
			</div>
			{actionLabel && onAction && (
				<div className="vf-toolbar-actions">
					<button className="mod-cta" onClick={onAction}>
						{actionLabel}
					</button>
				</div>
			)}
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
export function BrowseEmpty({
	label,
	actionLabel,
}: {
	label: string;
	/** Omitted — like the Trash hub — drops the "click … to create one" line. */
	actionLabel?: string;
}) {
	return (
		<div className="vf-browse-empty">
			<p>No {label} yet.</p>
			{actionLabel && (
				<p className="vf-empty-note">Click "{actionLabel}" to create one.</p>
			)}
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
	/**
	 * Omitted — like a Trash card, where the item isn't live and there's
	 * nothing to open — the body renders as a plain `<div>` rather than a
	 * `<button>`. The `trailing` slot works either way.
	 */
	onClick?: () => void;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="vf-browse-card">
			{onClick ? (
				<button className="vf-browse-card-body" onClick={onClick}>
					{children}
				</button>
			) : (
				<div className="vf-browse-card-body vf-browse-card-body-static">
					{children}
				</div>
			)}
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

/**
 * A generic label + count header for a browse group — the Trash hub stacks one
 * per Item Kind. Reuses the Task List view's `GroupHeader` classes for visual
 * consistency, but stays a separate component so `BrowseList` never has to know
 * about grouping.
 */
export function BrowseGroupHeader({
	label,
	count,
}: {
	label: string;
	count: number;
}) {
	return (
		<div className="vf-list-group">
			<span>{label}</span>
			<span className="vf-count">{count}</span>
		</div>
	);
}

/**
 * `"3h ago"`, `"2d ago"`, `"just now"` — a compact past-relative time for the
 * Trash hub's "Trashed …" line. Returns `"recently"` for a missing/unparseable
 * stamp so the line still reads.
 */
export function formatRelativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "recently";

	const minutes = Math.round((Date.now() - then) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d ago`;
	if (days < 30) return `${Math.round(days / 7)}w ago`;
	if (days < 365) return `${Math.round(days / 30)}mo ago`;
	return `${Math.round(days / 365)}y ago`;
}
