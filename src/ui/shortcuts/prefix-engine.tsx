/**
 * Linear-style `g` / `c` prefix chords.
 *
 *   g <key>  — navigate: reveal-or-open a destination, never duplicating a tab
 *   c <key>  — create: always two keys, no instant bare-`c` action
 *   ?        — open the shortcuts overlay
 *
 * Mounted once near the app root. This engine only ever intercepts **bare,
 * unmodified single-key chords** — it must never `preventDefault` or
 * `stopPropagation` anything involving Cmd/Ctrl/Alt (those stay real Obsidian
 * commands, rebindable in Obsidian's own hotkey settings — Cmd+P / Cmd+O /
 * Cmd+K are untouched). It also never fires while the user is typing in a
 * field, using the same guard as `useShortcuts`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "../../core/types";
import { SYSTEM_VIEW_ALL_TASKS_ID, SYSTEM_VIEW_UNTRIAGED_ID } from "../../core/views";
import {
	useCreateDashboard,
	useCreateProject,
	useCreateTask,
	useCreateView,
} from "../actions";
import { useTabs } from "../tabs-context";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";

/** How long a lone `g` / `c` waits for its second key before lapsing. */
const CHORD_TIMEOUT_MS = 1000;

function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return Boolean(
		el?.isContentEditable ||
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLSelectElement,
	);
}

export function PrefixEngine({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const tabs = useTabs();
	const createTask = useCreateTask();
	const createProject = useCreateProject();
	const createDashboard = useCreateDashboard();
	const createView = useCreateView();

	const [helpOpen, setHelpOpen] = useState(false);
	const helpOpenRef = useRef(helpOpen);
	helpOpenRef.current = helpOpen;

	// Pending prefix + its expiry timer, in refs so the listener identity is
	// stable and doesn't churn on every keystroke.
	const pending = useRef<"g" | "c" | null>(null);
	const timer = useRef<number | null>(null);

	const clearPending = useCallback(() => {
		pending.current = null;
		if (timer.current != null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
	}, []);

	// Latest snapshot for the create actions, without re-binding the listener.
	const snapshotRef = useRef(snapshot);
	snapshotRef.current = snapshot;

	const runChord = useCallback(
		(prefix: "g" | "c", key: string): boolean => {
			const snap = snapshotRef.current;
			if (prefix === "g") {
				switch (key) {
					case "a":
						void tabs.openView(SYSTEM_VIEW_ALL_TASKS_ID);
						return true;
					case "i":
						void tabs.openView(SYSTEM_VIEW_UNTRIAGED_ID);
						return true;
					case "p":
						void tabs.openScreen("projects");
						return true;
					case "d":
						void tabs.openScreen("dashboards");
						return true;
					case "v":
						void tabs.openScreen("views");
						return true;
					case "t":
						void tabs.openScreen("trash");
						return true;
					case "h":
						void tabs.openScreen("help");
						return true;
					case "s":
						void tabs.openScreen("settings");
						return true;
					default:
						return false;
				}
			}
			switch (key) {
				case "t":
					void createTask(snap);
					return true;
				case "w":
					void tabs.openScreen("new-workspace");
					return true;
				case "p":
					void createProject(snap);
					return true;
				case "d":
					void createDashboard(snap);
					return true;
				case "v":
					void createView(snap);
					return true;
				default:
					return false;
			}
		},
		[tabs, createTask, createProject, createDashboard, createView],
	);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// Never touch modifier combinations — those are (or should be) real
			// Obsidian commands.
			if (event.metaKey || event.ctrlKey || event.altKey) {
				clearPending();
				return;
			}
			if (isTypingTarget(event.target)) {
				clearPending();
				return;
			}

			// `?` (Shift + /) — the shortcuts overlay. Shift is required to type
			// it, so it's allowed here; it stays a single, unmodified chord.
			if (event.key === "?") {
				event.preventDefault();
				event.stopPropagation();
				clearPending();
				setHelpOpen((open) => !open);
				return;
			}

			// The shortcuts overlay owns the keyboard while it's up.
			if (helpOpenRef.current) {
				clearPending();
				return;
			}

			const armPrefix = (key: "g" | "c") => {
				pending.current = key;
				if (timer.current != null) window.clearTimeout(timer.current);
				timer.current = window.setTimeout(clearPending, CHORD_TIMEOUT_MS);
				// Not prevented: a lone `g`/`c` outside a field does nothing else,
				// and swallowing it would be surprising if the chord lapses.
			};

			if (pending.current) {
				const prefix = pending.current;
				// Any single printable key resolves (or lapses) the chord.
				if (event.key.length === 1) {
					const handled = runChord(prefix, event.key.toLowerCase());
					if (handled) {
						event.preventDefault();
						event.stopPropagation();
						clearPending();
						return;
					}
					// `g g` / `c c` (or a switch between them) re-arms rather than
					// dropping the chord entirely.
					if (event.key === "g" || event.key === "c") {
						armPrefix(event.key);
						return;
					}
				}
				// Anything else cancels the chord.
				clearPending();
				return;
			}

			if (event.key === "g" || event.key === "c") {
				armPrefix(event.key);
			}
		};

		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			clearPending();
		};
	}, [runChord, clearPending]);

	return helpOpen ? (
		<ShortcutsHelpDialog onClose={() => setHelpOpen(false)} />
	) : null;
}
