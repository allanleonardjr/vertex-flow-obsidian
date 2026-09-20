/**
 * Chat history, kept alive across switching away from the AI Chat tab and
 * back, but reset the moment that tab actually closes — "until the tab is
 * closed", not a full session. `AiChatView` only exists while its tab is
 * active (see App.tsx's tab-kind switch), so the state has to live one level
 * up, in a provider that stays mounted for the life of the workspace pane.
 *
 * Switching the selected AI model no longer resets this. Every call sends
 * the full message history regardless of which model is loaded (see
 * `AiChatView.tsx`'s `runTurn`), so a freshly-switched model reads the exact
 * same transcript the previous one would have on its own next turn — there's
 * no "memory" a model switch could lose. The real risk is a smaller-context
 * model failing to fit the already-accumulated history; that's handled at
 * the point of failure (`ContextWindowSizeExceededError`, caught in
 * `beginTurn`'s catch block) rather than by pre-emptively wiping history on
 * every switch, which would throw away a working conversation on a switch
 * that was going to be fine.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ViewFilters } from "../../core/types";
import { useTabs } from "../tabs-context";

/**
 * Enough to re-run a resolved `searchTasks` action's match set later — client
 * side, no model call — for "Load more" pagination on the rendered task list.
 * Metadata about how a bubble's `taskPaths` were produced, not user-facing
 * content: never sent back to the model on a later turn (`runTurn` only ever
 * reads `content`/`role` off history).
 */
export interface AiChatQueryMeta {
	/** The resolved `ViewFilters` `executeQueryAction` matched against — display names already turned into real ids/paths. */
	filters: ViewFilters;
	/** Whether the `overdue` post-filter (not a `ViewFilters` field) was applied on top of `filters`. */
	overdue: boolean;
	/** How many tasks matched in total, before truncation — compared against `taskPaths.length` to decide whether "Load more" has anything left to show. */
	totalMatches: number;
}

export interface AiChatBubble {
	/**
	 * A `crypto.randomUUID()` generated when the message is pushed — stable
	 * React list identity for Copy/Retry/Edit, nothing more. Never needs to
	 * match the app's persisted-entity id scheme, since chat messages are
	 * session-only and never written to disk.
	 */
	id: string;
	role: "user" | "assistant";
	content: string;
	/**
	 * Paths of the tasks a resolved `searchTasks` action matched, set once the
	 * turn settles — never the `Task` objects themselves. Resolved against the
	 * live snapshot at render time (`AiChatView`), so a status change or
	 * deletion after the fact is reflected instead of a frozen result from when
	 * the question was asked, same "computed, never stored" rule as everything
	 * else this plugin renders. Grows in place when "Load more" is clicked —
	 * still just paths, still resolved fresh at render time.
	 */
	taskPaths?: string[];
	/** Set alongside `taskPaths` for a resolved `searchTasks` action — see `AiChatQueryMeta`. */
	queryMeta?: AiChatQueryMeta;
}

interface AiChatSessionValue {
	messages: AiChatBubble[];
	setMessages: React.Dispatch<React.SetStateAction<AiChatBubble[]>>;
}

const AiChatSessionCtx = createContext<AiChatSessionValue | null>(null);

export function AiChatSessionProvider({ children }: { children: ReactNode }) {
	const { tabs } = useTabs();
	const [messages, setMessages] = useState<AiChatBubble[]>([]);

	const tabOpen = tabs.some((tab) => tab.kind === "ai-chat");
	useEffect(() => {
		if (!tabOpen) setMessages([]);
	}, [tabOpen]);

	return (
		<AiChatSessionCtx.Provider value={{ messages, setMessages }}>
			{children}
		</AiChatSessionCtx.Provider>
	);
}

export function useAiChatSession(): AiChatSessionValue {
	const ctx = useContext(AiChatSessionCtx);
	if (!ctx) {
		throw new Error("useAiChatSession must be used inside <AiChatSessionProvider>");
	}
	return ctx;
}
