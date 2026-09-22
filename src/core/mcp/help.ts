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
 * Every result carries the topic's breadcrumb and a deep-link URI, so a client
 * can both *tell* a user where a fact lives and *open* it on command.
 *
 * Pure over the bundled topic tree: no Obsidian, fully unit-testable.
 */

import {
	findHelpTopic,
	findHeadingSlugs,
	HELP_TOPICS,
	topicAncestors,
} from "../help";
import { flattenHelpTopics, scoreHelpTopic } from "../ai/help-retrieval";
import { buildVaultUri } from "./uris";

export interface McpHelpHit {
	topicId: string;
	title: string;
	/**
	 * Ancestor topic titles, outermost first — the breadcrumb rendered as
	 * "Help / Views / Saved views", where "Help" is the pane itself and never
	 * an entry on the path. Empty for a top-level topic.
	 */
	path: string[];
	/** `obsidian://vertex-flow?help=<topicId>` — opens the topic in the Help pane. */
	vaultUri: string;
}

export interface McpHelpTopicDetail {
	topicId: string;
	title: string;
	path: string[];
	vaultUri: string;
	/**
	 * Heading slugs in this topic's markdown, in document order. Append one to
	 * `vaultUri`'s `anchor` param (`…&anchor=<slug>`) to deep-link straight to
	 * a section — e.g. anchor `query-language` on the Saved Views topic.
	 */
	anchors: string[];
	content: string;
}

/**
 * A single topic, reduced for MCP responses. Returns `null` when `topicId`
 * isn't in the tree — the same contract `findHelpTopic` has, so callers never
 * synthesize a breadcrumb for an id they haven't looked up.
 */
export function helpTopicRef(topicId: string): McpHelpHit | null {
	const topic = findHelpTopic(HELP_TOPICS, topicId);
	if (!topic) return null;
	return {
		topicId: topic.id,
		title: topic.title,
		path: topicAncestors(HELP_TOPICS, topicId) ?? [],
		vaultUri: buildVaultUri({ action: "help", topicId: topic.id }),
	};
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
	return scored.flatMap(({ topic }) => {
		const ref = helpTopicRef(topic.id);
		return ref ? [ref] : [];
	});
}

/** One topic's full content, or `null` when the id isn't found in the tree. */
export function getHelpTopic(topicId: string): McpHelpTopicDetail | null {
	const summary = helpTopicRef(topicId);
	if (!summary) return null;
	const topic = findHelpTopic(HELP_TOPICS, topicId)!;
	const content = topic.content ?? "";
	return {
		...summary,
		anchors: findHeadingSlugs(content),
		content,
	};
}