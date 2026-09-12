/**
 * Chat history, kept alive across switching away from the AI Chat tab and
 * back, but reset the moment that tab actually closes — "until the tab is
 * closed", not a full session. `AiChatView` only exists while its tab is
 * active (see App.tsx's tab-kind switch), so the state has to live one level
 * up, in a provider that stays mounted for the life of the workspace pane.
 *
 * Also resets when the selected AI model changes (`plugin.settings.selectedAiModelId`)
 * — a different model has no memory of the old one's conversation, so
 * carrying history across a switch would be misleading. `justSwitchedModel`
 * lets `AiChatView` say so explicitly in its empty state rather than the
 * history just silently vanishing.
 */

import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";

export interface AiChatBubble {
	role: "user" | "assistant";
	content: string;
}

interface AiChatSessionValue {
	messages: AiChatBubble[];
	setMessages: React.Dispatch<React.SetStateAction<AiChatBubble[]>>;
	/** True right after a model switch reset the history — cleared once the tab is closed or another message starts. */
	justSwitchedModel: boolean;
}

const AiChatSessionCtx = createContext<AiChatSessionValue | null>(null);

export function AiChatSessionProvider({ children }: { children: ReactNode }) {
	const plugin = usePlugin();
	const { tabs } = useTabs();
	const [messages, setMessages] = useState<AiChatBubble[]>([]);
	const [justSwitchedModel, setJustSwitchedModel] = useState(false);

	const tabOpen = tabs.some((tab) => tab.kind === "ai-chat");
	useEffect(() => {
		if (!tabOpen) {
			setMessages([]);
			setJustSwitchedModel(false);
		}
	}, [tabOpen]);

	const modelId = plugin.settings.selectedAiModelId;
	const prevModelIdRef = useRef(modelId);
	useEffect(() => {
		if (prevModelIdRef.current === modelId) return;
		prevModelIdRef.current = modelId;
		setMessages([]);
		setJustSwitchedModel(true);
	}, [modelId]);

	return (
		<AiChatSessionCtx.Provider
			value={{
				messages,
				setMessages: (update) => {
					setJustSwitchedModel(false);
					setMessages(update);
				},
				justSwitchedModel,
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
