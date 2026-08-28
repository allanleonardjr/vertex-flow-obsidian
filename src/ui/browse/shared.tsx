/**
 * Shared layout for the Projects browse screen.
 *
 * These three are deliberately *not* Saved Views (§8.3 is a Task-filtering
 * concept) — they're a plain manager list for the other three entity kinds,
 * each with its own rollup stats and a "New X" button. There's no in-plugin
 * editor for them (only Tasks get one, §4.1–4.4): clicking a row opens the
 * real Obsidian note, since these are meant to be written in by hand.
 */

import type { ReactNode } from "react";
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
 * Deliberately *not* `.vf-empty-view` (the List/Board empty state, centered
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

export function BrowseCard({
	onClick,
	children,
}: {
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button className="vf-browse-card" onClick={onClick}>
			{children}
		</button>
	);
}

export function BrowseMeta({ children }: { children: ReactNode }) {
	return <div className="vf-browse-meta">{children}</div>;
}

export function BrowseProgress({ progress }: { progress: Progress }) {
	// `ProgressBar` already renders the "X/Y done" count (§7.1/§7.2) — this
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
