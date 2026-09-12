/**
 * Chat history, kept alive across switching away from the AI Chat tab and
 * back, but reset the moment that tab actually closes — "until the tab is
 * closed", not a full session. `AiChatView` only exists while its tab is
 * active (see App.tsx's tab-kind switch), so the state has to live one level
 * up, in a provider that stays mounted for the life of the workspace pane.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTabs } from "../tabs-context";

export interface AiChatBubble {
	role: "user" | "assistant";
	content: string;
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
