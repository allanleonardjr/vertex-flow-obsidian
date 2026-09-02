/**
 * Keyboard tab navigation, mounted once near the app root next to `PrefixEngine`.
 *
 * The modifier is a *platform thing, not a key*: it reads as **Option** on macOS
 * and **Alt** on Windows/Linux — the same code path, one physical key each. It
 * sits on `altKey` for both because Cmd (mac) / Ctrl (Windows) are Obsidian's
 * own tab-modifier on each platform and must be left alone.
 *
 *   Option/Alt + Tab — the Arc/Dia-style hold-to-cycle. While the modifier is
 *     held, a lightweight overlay lists the open tabs; each Tab key press walks
 *     the highlight forward (or backward with Shift), and releasing the
 *     modifier commits the highlighted tab. Escape aborts without switching.
 *     The highlight starts on the tab neighbouring the one in front, so the
 *     first press lands like Cmd+Tab on macOS. **macOS only**: on Windows/Linux
 *     this key is the OS app switcher and never reaches the app, so cycling is
 *     unsupported there — users jump with Option/Alt+1..9 instead.
 *
 *   Option/Alt + 1..9 — jump straight to the tab at that position in the strip.
 *     Option/Alt + 0 jumps to the last tab.
 *
 *   Option/Alt + W / + Shift + W — close the active tab / close every tab,
 *     mirroring a browser's Cmd+W / Cmd+Shift+W but under the free modifier
 *     (Cmd+W / Ctrl+W is how you close an entire Obsidian pane, so we avoid it).
 *     Escape never closes a tab (it clears focus instead, see `App.tsx`); these
 *     are the deliberate close actions.
 *
 * Modifier combos are deliberately *not* registered as Obsidian commands: they
 * are view-state navigation within the plugin's own tab strip (per-pane, in
 * memory), not global workspace actions — the same policy that keeps the `j`/`k`
 * view nav out of the command palette. The bare `g` prefix chords already live
 * in `PrefixEngine`; this holds the modifier-key surface so neither touches the
 * other's key space.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Platform } from "obsidian";
import type { WorkspaceSnapshot } from "../core/types";
import { usePlugin } from "./context";
import { useTabs } from "./tabs-context";
import {
	duplicateSystemViews,
	duplicateTaskTitles,
	tabContent,
} from "./TabStrip";

/** macOS only. Detectable via Obsidian's Platform API instead of navigator. */
const IS_MAC = Platform.isMacOS;

function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return Boolean(
		el?.isContentEditable ||
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLSelectElement,
	);
}

/**
 * The tab modifier is the same key position on every platform but goes by two
 * names: Option (macOS) and Alt (Windows/Linux). Both report as `altKey`, and
 * neither Cmd nor Ctrl enters the picture (those are Obsidian's modifiers).
 */
function isTabModifier(event: KeyboardEvent): boolean {
	return event.altKey && !event.metaKey && !event.ctrlKey;
}

/** The position a "number" shortcut maps to (0 is the *last* tab, like Cmd+0). */
function numberToIndex(digit: string, length: number): number {
	const n = digit === "0" ? 10 : +digit;
	if (Number.isNaN(n) || n < 1) return -1;
	return n <= 9 ? n - 1 : length - 1;
}

export function TabSwitcher({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const plugin = usePlugin();
	const { tabs, activeId, activate, closeActive, closeAllTabs } = useTabs();

	// The hold-to-cycle overlay's live state: null when idle, otherwise the
	// index currently highlighted. Entered on the first Option+Tab, advanced on
	// each subsequent Tab while Option is held, committed on release of Option.
	const [highlight, setHighlight] = useState<number | null>(null);
	const highlightRef = useRef<number | null>(null);
	highlightRef.current = highlight;

	// Latest tabs for the commit handler, without re-binding the listeners.
	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;
	const activeIdRef = useRef(activeId);
	activeIdRef.current = activeId;

	// The two task/system disambiguation sets for tab labels, matching the strip.
	const taskDup = useMemo(() => duplicateTaskTitles(plugin, tabs), [plugin, tabs]);
	const sysDup = useMemo(() => duplicateSystemViews(tabs), [tabs]);

	// The handler mutates the ref synchronously (Tab auto-repeat can fire several
	// keydowns before a re-render lands) and mirrors it to state for rendering.
	const moveHighlight = useCallback(
		(dir: 1 | -1) => {
			const length = tabsRef.current.length;
			if (length === 0) return;
			let next: number;
			if (highlightRef.current == null) {
				// Enter on the first Option+Tab: start on the tab neighbouring the
				// active one (after it, or before it with `dir`), like Cmd+Tab.
				const start = Math.max(
					0,
					tabsRef.current.findIndex(
						(t) => t.id === activeIdRef.current,
					),
				);
				next = (start + dir + length) % length;
			} else {
				next = (highlightRef.current + dir + length) % length;
			}
			highlightRef.current = next;
			setHighlight(next);
		},
		[],
	);

	const commit = useCallback(() => {
		const h = highlightRef.current;
		highlightRef.current = null;
		setHighlight(null);
		if (h != null && h >= 0 && h < tabsRef.current.length) {
			void activate(tabsRef.current[h].id);
		}
	}, [activate]);

	const abort = useCallback(() => {
		highlightRef.current = null;
		setHighlight(null);
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// Typing in a field — never hijack Tab/numbers there.
			if (isTypingTarget(event.target)) return;

			// Option/Alt+1..9 (and Option/Alt+0 for the last tab): jump to the
			// tab at that position. The modifier reads as Option on macOS, Alt on
			// Windows — same `altKey` flag — because Cmd/Ctrl are Obsidian's own
			// "select tab" modifier on each platform. Matches on `event.code`
			// (Digit*) because holding Option makes `event.key` report a symbol
			// (Option+1 → ¡) on macOS.
			if (
				isTabModifier(event) &&
				!event.shiftKey &&
				/^Digit\d$/.test(event.code)
			) {
				const digit = event.code.slice(5); // "1".."9", "0"
				const index = numberToIndex(digit, tabsRef.current.length);
				if (index >= 0 && index < tabsRef.current.length) {
					event.preventDefault();
					event.stopPropagation();
					void activate(tabsRef.current[index].id);
				}
				return;
			}

			// Option/Alt+W closes the active tab; Option/Alt+Shift+W closes every
			// tab. Mirrors a browser's Cmd+W / Cmd+Shift+W, but under the free
			// modifier (Cmd+W / Ctrl+W is how you close an entire Obsidian pane,
			// so we avoid it). `event.code` stays "KeyW" under Option/Alt (which
			// changes `event.key` to a symbol on macOS).
			if (event.code === "KeyW" && isTabModifier(event)) {
				event.preventDefault();
				event.stopPropagation();
				if (event.shiftKey) closeAllTabs();
				else closeActive();
				return;
			}

			// Escape aborts the overlay without switching.
			if (event.key === "Escape" && highlightRef.current != null) {
				event.preventDefault();
				event.stopPropagation();
				abort();
				return;
			}

			// Option+Tab cycles; each press walks the highlight forward (or
			// backward with Shift). macOS only: on Windows/Linux this key is the
			// OS app switcher and never reaches the renderer.
			if (IS_MAC && event.key === "Tab" && isTabModifier(event)) {
				event.preventDefault();
				event.stopPropagation();
				moveHighlight(event.shiftKey ? -1 : 1);
				return;
			}
		};

		// Releasing the modifier commits the overlay. Can also arrive with the
		// window blurring mid-hold; the ref already holds the target.
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === "Alt" && highlightRef.current != null) commit();
		};

		window.addEventListener("keydown", onKey, true);
		window.addEventListener("keyup", onKeyUp, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keyup", onKeyUp, true);
		};
	}, [commit, abort, moveHighlight, closeActive, closeAllTabs]);

	if (highlight == null) return null;

	return createPortal(
		<div
			className="vf-tab-switcher"
			role="tablist"
			aria-label="Switch tabs"
		>
			{tabs.map((tab, index) => {
				const content = tabContent(
					tab,
					snapshot,
					taskDup,
					sysDup,
					plugin,
				);
				if (!content) return null;
				return (
					<div
						key={tab.id}
						role="tab"
						aria-selected={index === highlight}
						className={`vf-tab-switcher-item${
							index === highlight ? " is-active" : ""
						}`}
					>
						<span className="vf-tab-switcher-icon">
							{content.icon}
						</span>
						<span className="vf-tab-switcher-title">
							{content.label}
						</span>
						<span className="vf-tab-switcher-number">
							{index < 9 ? index + 1 : "0"}
						</span>
					</div>
				);
			})}
			<div className="vf-tab-switcher-hint">
				Option+Tab to keep cycling · release Option to switch · Escape to
				cancel
			</div>
		</div>,
		document.body,
	);
}
