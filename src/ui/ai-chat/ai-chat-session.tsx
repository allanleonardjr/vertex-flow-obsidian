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
 *
 * Switching the AI *provider* (built-in ↔ local model server) does reset it,
 * through `resetConversation()`: the two keep different history shapes (the
 * local server replays each turn's tool exchange via `wire`). The local
 * server mode's own state lives here too, for the same survive-a-tab-switch
 * reason — the chat's own workspace (`chatWorkspaceRoot`, independent of the
 * pane's) and its private in-process MCP bridge, created lazily on the first
 * local-server turn and closed whenever the conversation resets.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createMcpBridge, type McpBridge } from "../../ai/mcp-bridge";
import type { LocalChatWireMessage, ToolResultRows } from "../../core/ai/local-server";
import type { ProjectFilters } from "../../core/views/filter";
import type { ViewFilters } from "../../core/types";
import { usePlugin } from "../context";
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

/** The Project-scoped analogue of `AiChatQueryMeta`, for a resolved `searchProjects` action — same "re-run client-side, never sent back to the model" role. */
export interface AiChatProjectQueryMeta {
	/** The resolved `ProjectFilters` `executeProjectQueryAction` matched against — display names already turned into real ids. */
	filters: ProjectFilters;
	/** How many projects matched in total, before truncation — compared against `projectPaths.length` to decide whether "Load more" has anything left to show. */
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
	/** The Project-scoped analogue of `taskPaths`, set once a resolved `searchProjects` action settles. Same "paths, resolved fresh at render time" rule. */
	projectPaths?: string[];
	/** Set alongside `projectPaths` for a resolved `searchProjects` action — see `AiChatProjectQueryMeta`. */
	projectQueryMeta?: AiChatProjectQueryMeta;
	/** Local server only: every tool this turn called, in order, for the "Used: …" note. */
	toolCalls?: { name: string; isError: boolean }[];
	/**
	 * Local server only: the assistant-with-`tool_calls` and `tool` messages
	 * this turn produced, in order, excluding the final answer (`content`).
	 * Only ever used to replay history to the server (`bubblesToWireMessages`).
	 */
	wire?: LocalChatWireMessage[];
	/**
	 * Local server only: the last row-producing tool result of the turn, as
	 * paths — resolved against the live index at render time, same "computed,
	 * never stored" rule as `taskPaths`. `shown` grows with "Load more".
	 */
	resultRows?: ToolResultRows & { shown: number };
	/** Local server only: the last response's `usage.total_tokens`, when the server reported it. */
	tokens?: number;
	/** Local server only: this bubble is a connection/server error, shown but never replayed to the model. */
	error?: boolean;
}

interface AiChatSessionValue {
	messages: AiChatBubble[];
	setMessages: React.Dispatch<React.SetStateAction<AiChatBubble[]>>;
	/** Local server only: the chat's own workspace root — `null` until the view seeds it from the pane. Never changes the pane or sidebar. */
	chatWorkspaceRoot: string | null;
	setChatWorkspaceRoot: (root: string | null) => void;
	/** Local server only: the conversation's MCP bridge (created on first use), with `set_active_workspace` applied for `root` if it isn't already. */
	ensureBridge: (root: string) => Promise<McpBridge>;
	/** Clears the messages and the chat workspace, and closes the bridge. Used on tab close and on a provider switch. */
	resetConversation: () => void;
}

interface BridgeEntry {
	bridge: Promise<McpBridge>;
	/** The root `set_active_workspace` was last applied for through `ensureBridge`. */
	appliedRoot: string | null;
}

const AiChatSessionCtx = createContext<AiChatSessionValue | null>(null);

export function AiChatSessionProvider({ children }: { children: ReactNode }) {
	const plugin = usePlugin();
	const { tabs } = useTabs();
	const [messages, setMessages] = useState<AiChatBubble[]>([]);
	const [chatWorkspaceRoot, setChatWorkspaceRoot] = useState<string | null>(null);
	// Read by the bridge's `activeWorkspace` fallback at call time, so the
	// bridge never needs rebuilding when the chat workspace changes.
	const chatRootRef = useRef(chatWorkspaceRoot);
	chatRootRef.current = chatWorkspaceRoot;
	const bridgeRef = useRef<BridgeEntry | null>(null);

	const closeBridge = useCallback(() => {
		const entry = bridgeRef.current;
		bridgeRef.current = null;
		void entry?.bridge.then(
			(bridge) => bridge.close(),
			() => undefined,
		);
	}, []);

	const ensureBridge = useCallback(
		async (root: string): Promise<McpBridge> => {
			let entry = bridgeRef.current;
			if (!entry) {
				const bridge = createMcpBridge(
					plugin.mcpToolDeps(() =>
						chatRootRef.current != null ? plugin.index.get(chatRootRef.current) : null,
					),
				);
				const created: BridgeEntry = { bridge, appliedRoot: null };
				entry = created;
				bridgeRef.current = created;
				// A failed creation isn't cached — the next turn tries again.
				bridge.catch(() => {
					if (bridgeRef.current === created) bridgeRef.current = null;
				});
			}
			const bridge = await entry.bridge;
			if (entry.appliedRoot !== root) {
				const result = await bridge.callTool("set_active_workspace", { workspace: root });
				if (!result.isError) entry.appliedRoot = root;
			}
			return bridge;
		},
		[plugin],
	);

	const resetConversation = useCallback(() => {
		setMessages([]);
		setChatWorkspaceRoot(null);
		closeBridge();
	}, [closeBridge]);

	const tabOpen = tabs.some((tab) => tab.kind === "ai-chat");
	useEffect(() => {
		if (!tabOpen) resetConversation();
	}, [tabOpen, resetConversation]);

	// The pane itself closing — nothing else will ever close this bridge.
	useEffect(() => closeBridge, [closeBridge]);

	return (
		<AiChatSessionCtx.Provider
			value={{
				messages,
				setMessages,
				chatWorkspaceRoot,
				setChatWorkspaceRoot,
				ensureBridge,
				resetConversation,
			}}
		>
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
