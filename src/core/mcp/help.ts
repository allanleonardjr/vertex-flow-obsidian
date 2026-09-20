/**
 * Help-document lookup for the MCP tools.
 *
 * The plugin's bundled Help pane is real, searchable documentation — ideal fodder
 * for a local LLM that needs to know how the query language, taxonomy engine and
 * views work before it talks about them. Two tools live on this:
 *
 *  - `search_help_docs(term)` — an LLM-facing search: the top ranked topic
 *    titles for a query, using the same scorer the AI Chat "relevant docs"
 *    injection uses (`scoreHelpTopic`), so the MCP layer and the in-app
 *    assistant agree on what's relevant.
 *
 *  - `get_help_topic(topicId)` — one topic's full markdown, so an LLM can read
 *    the actual documentation rather than a paraphrase.
 *
 * Pure over the bundled topic tree: no Obsidian, fully unit-testable.
 */

import { findHelpTopic, HELP_TOPICS, type HelpTopic } from "../help";
import { flattenHelpTopics, scoreHelpTopic } from "../ai/help-retrieval";

export interface McpHelpHit {
	topicId: string;
	title: string;
	/** The topic's nearest-ancestor section, for disambiguation. */
	section?: string;
}

export interface McpHelpTopicDetail {
	topicId: string;
	title: string;
	section?: string;
	content: string;
}

/** The topic's parent section title (e.g. "Views" for `views-saved-views`). */
function topicSection(topics: readonly HelpTopic[], topic: HelpTopic): string | undefined {
	for (const t of topics) {
		if (t.id === topic.id) return undefined;
		if (t.children?.some((child) => child.id === topic.id)) return t.title;
		const nested = topicSection(t.children ?? [], topic);
		if (nested) return nested;
	}
	return undefined;
}

/** Ranked topic titles for a free-text query. Empty when nothing clears the bar. */
export function searchHelp(
	query: string,
	maxResults = 8,
): McpHelpHit[] {
	const terms = query.trim();
	if (!terms) return [];
	const scored = flattenHelpTopics(HELP_TOPICS)
		.map((topic) => ({
			topic,
			score: scoreHelpTopic(terms, topic),
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults);
	return scored.map(({ topic }) => ({
		topicId: topic.id,
		title: topic.title,
		...(topicSection(HELP_TOPICS, topic)
			? { section: topicSection(HELP_TOPICS, topic) }
			: {}),
	}));
}

/** One topic's full content, or `null` when the id isn't found in the tree. */
export function getHelpTopic(topicId: string): McpHelpTopicDetail | null {
	const topic = findHelpTopic(HELP_TOPICS, topicId);
	if (!topic) return null;
	return {
		topicId: topic.id,
		title: topic.title,
		...(topicSection(HELP_TOPICS, topic)
			? { section: topicSection(HELP_TOPICS, topic) }
			: {}),
		content: topic.content ?? "",
	};
}