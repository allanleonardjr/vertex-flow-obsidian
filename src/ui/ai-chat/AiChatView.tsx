/**
 * AI Chat: a zero-install, in-browser chat over the active workspace's tasks
 * and projects. No retrieval — the whole (possibly truncated) snapshot is
 * injected as one system message per request. History lives in
 * `AiChatSessionProvider` (an ancestor that survives switching tabs away and
 * back) and is reset when the AI Chat tab is closed — session-only, never
 * persisted to disk (computed, never stored).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	buildAiWorkspaceSnapshot,
	buildPeopleRoster,
	buildTaxonomyLegend,
	estimateTokens,
	type AiProjectSummary,
	type AiTaskSummary,
} from "../../core/ai/snapshot";
import type { WorkspaceTaxonomies } from "../../core/taxonomy";
import type { WorkspaceSnapshot } from "../../core/types";
import { AiEngineService, type AiChatMessage, type AiEngineState } from "../../ai/AiEngineService";
import { EmptyView } from "../components/EmptyView";
import { usePlugin } from "../context";
import { useTabs } from "../tabs-context";
import { useAiChatSession } from "./ai-chat-session";

/** Rough context budget in tokens, left over after the model's own prompt overhead. */
const SNAPSHOT_TOKEN_BUDGET = 2500;

/**
 * Pipe-delimited rows instead of `JSON.stringify` — repeated object keys cost
 * real tokens against a budget that's already stretched thin by the added
 * taxonomy/people fields. Purely a serialization choice for the prompt; the
 * underlying `AiWorkspaceSnapshot` shape (tested in core) is untouched.
 */
function csvField(value: string): string {
	return value.includes("|") || value.includes("\n")
		? value.replace(/\|/g, "/").replace(/\n/g, " ")
		: value;
}

function flattenTasks(tasks: AiTaskSummary[]): string {
	const header =
		"id | title | status | priority | taskType | assignee | project | parent | labels | startDate | dueDate | estimate";
	if (tasks.length === 0) return `${header}\n(none)`;
	const rows = tasks.map((task) =>
		[
			task.id,
			task.title,
			task.status ?? "-",
			task.priority ?? "-",
			task.taskType ?? "-",
			task.assignee ?? "-",
			task.project ?? "-",
			task.parent ?? "-",
			task.labels.length ? task.labels.join(",") : "-",
			task.startDate ?? "-",
			task.dueDate ?? "-",
			task.estimate ?? "-",
		]
			.map((value) => csvField(String(value)))
			.join(" | "),
	);
	return [header, ...rows].join("\n");
}

function flattenProjects(projects: AiProjectSummary[]): string {
	const header = "title | statusCounts | overdueCount | owner | startDate | dueDate";
	if (projects.length === 0) return `${header}\n(none)`;
	const rows = projects.map((project) =>
		[
			project.title,
			Object.entries(project.statusCounts)
				.map(([status, count]) => `${status}:${count}`)
				.join(",") || "-",
			String(project.overdueCount),
			project.owner ?? "-",
			project.startDate ?? "-",
			project.dueDate ?? "-",
		]
			.map((value) => csvField(String(value)))
			.join(" | "),
	);
	return [header, ...rows].join("\n");
}

function buildSystemMessage(
	snapshot: WorkspaceSnapshot,
	taxonomies: WorkspaceTaxonomies,
): { content: string; truncated: boolean; omittedTaskCount: number } {
	const instructions =
		"You are an assistant embedded in the Vertex Flow task manager (an Obsidian plugin). " +
		"Answer questions about the user's active workspace using only the data below — don't " +
		"invent tasks or projects that aren't in it. Status, priority, and task-type meanings are " +
		"specific to this workspace (they're fully user-configurable) and are defined in the " +
		"Workspace configuration section below — use those definitions, not generic assumptions.";
	const legend = buildTaxonomyLegend(taxonomies);
	const roster = buildPeopleRoster(snapshot.workspace.people);
	const configSection = `## Workspace configuration\n${legend}\n${roster}`;

	// Fixed cost that never shrinks — truncation below only ever trims the
	// task list, never the legend/roster the model needs to interpret it.
	const fixedOverheadTokens = estimateTokens(instructions) + estimateTokens(configSection);

	let maxTasks = snapshot.tasks.filter((task) => !task.archived).length;
	let ai = buildAiWorkspaceSnapshot(snapshot, taxonomies, { maxTasks });
	let tasksText = flattenTasks(ai.tasks);
	let projectsText = flattenProjects(ai.projects);

	while (
		fixedOverheadTokens + estimateTokens(tasksText) + estimateTokens(projectsText) >
			SNAPSHOT_TOKEN_BUDGET &&
		maxTasks > 5
	) {
		maxTasks = Math.floor(maxTasks / 2);
		ai = buildAiWorkspaceSnapshot(snapshot, taxonomies, { maxTasks });
		tasksText = flattenTasks(ai.tasks);
		projectsText = flattenProjects(ai.projects);
	}

	const omittedNote = ai.truncated
		? ` Note: ${ai.omittedTaskCount} older task(s) were omitted to fit the model's context window.`
		: "";

	const dataSection = `## Tasks and projects\n### Tasks\n${tasksText}\n\n### Projects\n${projectsText}`;

	return {
		content: `${instructions}${omittedNote}\n\n${configSection}\n\n${dataSection}`,
		truncated: ai.truncated,
		omittedTaskCount: ai.omittedTaskCount,
	};
}

export function AiChatView({
	snapshot,
	taxonomies,
}: {
	snapshot: WorkspaceSnapshot;
	taxonomies: WorkspaceTaxonomies;
}) {
	const plugin = usePlugin();
	const { openScreen } = useTabs();
	const supported = AiEngineService.supportsWebGPU();

	const [engineState, setEngineState] = useState<AiEngineState | "checking">("checking");
	const { messages, setMessages } = useAiChatSession();
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const bodyRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		void plugin.aiEngine.getState().then(async (state) => {
			if (cancelled) return;
			if (state !== "installed") {
				setEngineState(state);
				return;
			}
			// Cached model: this just loads it into the worker, no download.
			const loaded = await plugin.aiEngine.install();
			if (!cancelled) setEngineState(loaded);
		});
		return () => {
			cancelled = true;
		};
	}, [plugin]);

	const system = useMemo(() => buildSystemMessage(snapshot, taxonomies), [snapshot, taxonomies]);

	useEffect(() => {
		bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
	}, [messages]);

	const send = () => {
		const text = input.trim();
		if (!text || sending) return;

		const history = [...messages, { role: "user" as const, content: text }];
		setMessages([...history, { role: "assistant", content: "" }]);
		setInput("");
		setSending(true);

		const request: AiChatMessage[] = [
			{ role: "system", content: system.content },
			...history,
		];

		void plugin.aiEngine
			.chat(request, (token) => {
				setMessages((prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.role === "assistant") last.content += token;
					return next;
				});
			})
			.catch((error: unknown) => {
				console.error("Vertex Flow: AI chat failed", error);
				setMessages((prev) => {
					const next = [...prev];
					const last = next[next.length - 1];
					if (last?.role === "assistant" && last.content === "") {
						last.content = "Something went wrong generating a response.";
					}
					return next;
				});
			})
			.finally(() => setSending(false));
	};

	if (!supported || engineState === "unsupported") {
		return (
			<EmptyView
				icon="bot"
				iconFallback="bot"
				title="AI Chat isn't available here"
				note="This device/browser doesn't support WebGPU, which the in-browser model needs."
			/>
		);
	}

	if (engineState === "not-installed") {
		return (
			<EmptyView
				icon="bot"
				iconFallback="bot"
				title="Install the AI model to start chatting"
				note="It's a one-time, multi-gigabyte download that runs entirely in this browser."
				action={{
					label: "Open Settings",
					onClick: () => openScreen("settings", "vf-settings-ai-chat"),
				}}
			/>
		);
	}

	if (engineState === "checking") {
		return (
			<EmptyView icon="bot" iconFallback="bot" title="Loading the model…" />
		);
	}

	return (
		<div className="vf-settings">
			<header className="vf-toolbar">
				<div className="vf-toolbar-title">
					<h2>AI Chat</h2>
				</div>
			</header>

			<div className="vf-chat-body" ref={bodyRef}>
				{messages.length === 0 ? (
					<p className="vf-empty-note">
						Ask about {snapshot.workspace.name} — e.g. "what's overdue?"
					</p>
				) : (
					messages.map((message, index) => (
						<div key={index} className={`vf-chat-bubble vf-chat-bubble-${message.role}`}>
							{message.content || (sending && index === messages.length - 1 ? "…" : "")}
						</div>
					))
				)}
			</div>

			<div className="vf-chat-input-row">
				<textarea
					className="vf-chat-input"
					value={input}
					placeholder="Ask about this workspace…"
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							send();
						}
					}}
				/>
				<button type="button" className="mod-cta" disabled={sending || !input.trim()} onClick={send}>
					Send
				</button>
			</div>
		</div>
	);
}
