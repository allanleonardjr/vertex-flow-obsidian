/**
 * Help: a Docusaurus-style master/detail pane. The left rail is a topic tree
 * (unlimited nesting — a topic can carry its own content, its own children,
 * both, or neither); the right pane renders whichever topic is selected.
 *
 * Reachable from the sidebar's Help row, rendered inline like the other
 * browse screens — no modal. Content lives in `core/help.ts`, not the vault.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { HELP_TOPICS, findHelpTopic, slugifyHeading, type HelpTopic } from "../../core/help";
import { Icon } from "../components/Icon";
import { MarkdownContent } from "../components/Markdown";
import { useTabs } from "../tabs-context";
import { usePlugin, useSettingsWriter } from "../context";

const MIN_WIDTH = 180;
const MAX_WIDTH = 420;

/** Not a vault note — relative links/embeds in help content resolve from the
 * vault root against this placeholder path. */
const HELP_SOURCE_PATH = "Vertex Flow Help.md";

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/** First topic (depth-first) that actually has content, for the initial pane. */
function firstContentTopic(topics: HelpTopic[]): HelpTopic | null {
	for (const topic of topics) {
		if (topic.content) return topic;
		const nested = firstContentTopic(topic.children ?? []);
		if (nested) return nested;
	}
	return null;
}

/** Every ancestor id of `id`, so a deep topic can expand its whole chain
 * instead of sitting invisible inside collapsed parents. */
function ancestorIds(topics: HelpTopic[], id: string, trail: string[] = []): string[] | null {
	for (const topic of topics) {
		if (topic.id === id) return trail;
		if (topic.children) {
			const found = ancestorIds(topic.children, id, [...trail, topic.id]);
			if (found) return found;
		}
	}
	return null;
}

/** The ancestor topics of `topicId` in order — root first, closest last —
 * for the breadcrumb trail. Empty for a top-level topic. */
function ancestorTopics(topics: HelpTopic[], topicId: string): HelpTopic[] {
	const ids = ancestorIds(topics, topicId) ?? [];
	const chain: HelpTopic[] = [];
	for (const id of ids) {
		const topic = findHelpTopic(topics, id);
		if (topic) chain.push(topic);
	}
	return chain;
}

export function HelpView() {
	const plugin = usePlugin();
	const writeSettings = useSettingsWriter();
	const { pendingHelpTarget, clearPendingHelpTarget } = useTabs();

	const initial = useMemo(() => firstContentTopic(HELP_TOPICS), []);

	const [selectedId, setSelectedId] = useState<string | null>(() => {
		const target = pendingHelpTarget;
		if (target && findHelpTopic(HELP_TOPICS, target.topicId)) {
			return target.topicId;
		}
		return initial?.id ?? null;
	});
	const [expanded, setExpanded] = useState<Set<string>>(
		() => new Set(initial ? ancestorIds(HELP_TOPICS, initial.id) ?? [] : []),
	);
	// The anchor to scroll to after the current topic's markdown has rendered.
	// Held locally so it survives from selection until the DOM is actually
	// there to scroll to; the TabsProvider copy is cleared on first read.
	const [pendingAnchor, setPendingAnchor] = useState<string | null>(() =>
		pendingHelpTarget?.anchor ?? null,
	);

	// A deep link (via `openHelp`) lands on a specific topic: consume the
	// provider's copy on first read and align selection to it. If the topic is
	// unmodified it's our own selection; if it changed (the tab was already
	// open and the user had navigated elsewhere) we still jump to the target.
	useEffect(() => {
		const target = pendingHelpTarget;
		if (!target) return;
		clearPendingHelpTarget();
		const topic = findHelpTopic(HELP_TOPICS, target.topicId);
		if (!topic) return;
		setSelectedId(topic.id);
		setPendingAnchor(target.anchor ?? null);
		if (topic.children?.length) {
			setExpanded((current) => new Set(current).add(topic.id));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingHelpTarget]);

	// After the selected topic's markdown has rendered, scroll the pending
	// anchor into view. Obsidian's `MarkdownRenderer.render` fills the container
	// asynchronously, after React's own commit — so instead of a plain effect on
	// `selectedId` (which would run before the DOM exists), watch the container
	// for the injected headings and scroll when they appear. `pendingAnchor`
	// clears itself once consumed so a later manual re-render never re-scrolls.
	const contentRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!pendingAnchor) return;
		const container = contentRef.current;
		if (!container) return;
		const tryScroll = () => {
			const heading = Array.from(
				container.querySelectorAll("h1, h2, h3, h4, h5, h6"),
			).find((h) => slugifyHeading(h.textContent ?? "") === pendingAnchor);
			if (!heading) return false;
			heading.scrollIntoView({ block: "start" });
			setPendingAnchor(null);
			return true;
		};
		if (tryScroll()) return; // already painted on this commit
		const observer = new MutationObserver(() => {
			if (tryScroll()) observer.disconnect();
		});
		observer.observe(container, { childList: true, subtree: true });
		return () => observer.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingAnchor, selectedId]);

	const width = clamp(plugin.settings.helpSidebarWidth, MIN_WIDTH, MAX_WIDTH);
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);

	const select = (topic: HelpTopic) => {
		setSelectedId(topic.id);
		setPendingAnchor(null);
		if (topic.children?.length) {
			setExpanded((current) => new Set(current).add(topic.id));
		}
	};

	const toggle = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const selected = selectedId ? findHelpTopic(HELP_TOPICS, selectedId) : null;
	const breadcrumbs = selected ? ancestorTopics(HELP_TOPICS, selected.id) : [];

	return (
		<div className="vf-help">
			<nav className="vf-help-toc" style={{ width, flexBasis: width }} aria-label="Help topics">
				<div className="vf-help-toc-title">Help</div>
				{HELP_TOPICS.map((topic) => (
					<HelpTopicRow
						key={topic.id}
						topic={topic}
						depth={0}
						selectedId={selectedId}
						expanded={expanded}
						onSelect={select}
						onToggle={toggle}
					/>
				))}
			</nav>

			<div
				className="vf-help-resize"
				role="separator"
				aria-orientation="vertical"
				aria-valuenow={width}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					drag.current = { startX: event.clientX, startWidth: width };
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					if (!drag.current) return;
					const next = clamp(
						drag.current.startWidth + (event.clientX - drag.current.startX),
						MIN_WIDTH,
						MAX_WIDTH,
					);
					writeSettings({ helpSidebarWidth: next });
				}}
				onPointerUp={(event) => {
					if (!drag.current) return;
					drag.current = null;
					event.currentTarget.releasePointerCapture(event.pointerId);
				}}
				onDoubleClick={() => writeSettings({ helpSidebarWidth: 240 })}
				title="Drag to resize — double-click to reset"
			/>

			<div className="vf-help-content" ref={contentRef}>
				{selected ? (
					<>
						<header className="vf-help-header">
							{breadcrumbs.length > 0 && (
								<nav
									className="vf-help-breadcrumbs"
									aria-label="Breadcrumb"
								>
									{breadcrumbs.map((crumb, index) => (
										<span key={crumb.id} className="vf-help-crumb">
											{index > 0 && <span className="vf-help-crumb-arrow">/</span>}
											<button
												type="button"
												className="vf-help-crumb-link"
												onClick={() => select(crumb)}
											>
												{crumb.title}
											</button>
										</span>
									))}
								</nav>
							)}
							<h2 className="vf-help-title">
								{selected.icon && <Icon id={selected.icon} size={16} />}
								<span>{selected.title}</span>
							</h2>
						</header>
						{selected.content && (
							<MarkdownContent text={selected.content} sourcePath={HELP_SOURCE_PATH} />
						)}
						{selected.children && selected.children.length > 0 && (
							<div className="vf-help-index">
								<span className="vf-help-index-label">In this section</span>
								{selected.children.map((child) => (
									<button
										key={child.id}
										type="button"
										className="vf-help-index-item"
										onClick={() => select(child)}
									>
										<span className="vf-help-index-item-main">
											{child.icon && <Icon id={child.icon} size={15} />}
											<span>{child.title}</span>
										</span>
										<ChevronRight
											className="vf-help-index-item-chevron"
											size={15}
										/>
									</button>
								))}
							</div>
						)}
					</>
				) : (
					<p className="vf-help-empty">Select a topic to get started.</p>
				)}
			</div>
		</div>
	);
}

function HelpTopicRow({
	topic,
	depth,
	selectedId,
	expanded,
	onSelect,
	onToggle,
}: {
	topic: HelpTopic;
	depth: number;
	selectedId: string | null;
	expanded: Set<string>;
	onSelect: (topic: HelpTopic) => void;
	onToggle: (id: string) => void;
}) {
	const hasChildren = (topic.children?.length ?? 0) > 0;
	const isOpen = expanded.has(topic.id);
	const isActive = topic.id === selectedId;

	return (
		<>
			<div className="vf-help-topic-row" style={{ paddingLeft: depth * 14 }}>
				<button
					type="button"
					className={`vf-help-topic-toggle${isOpen ? " is-open" : ""}${hasChildren ? "" : " is-spacer"}`}
					aria-label={hasChildren ? (isOpen ? "Collapse" : "Expand") : undefined}
					aria-hidden={!hasChildren}
					tabIndex={hasChildren ? 0 : -1}
					onClick={(event) => {
						event.stopPropagation();
						if (hasChildren) onToggle(topic.id);
					}}
				>
					{hasChildren && <ChevronRight size={13} />}
				</button>
				<button
					type="button"
					className={`vf-help-topic-label${isActive ? " is-active" : ""}`}
					aria-current={isActive ? "page" : undefined}
					onClick={() => onSelect(topic)}
				>
					{topic.icon && <Icon id={topic.icon} size={13} />}
					<span>{topic.title}</span>
				</button>
			</div>

			{hasChildren && isOpen && (
				<>
					{topic.children!.map((child) => (
						<HelpTopicRow
							key={child.id}
							topic={child}
							depth={depth + 1}
							selectedId={selectedId}
							expanded={expanded}
							onSelect={onSelect}
							onToggle={onToggle}
						/>
					))}
				</>
			)}
		</>
	);
}
