/**
 * Retrieval over the bundled Help topic tree (`HELP_TOPICS`, see `../help.ts`)
 * for AI Chat — a small, dependency-free scorer, deliberately not
 * `prepareFuzzySearch` (that's Obsidian API; `workspace-search.ts`'s domain,
 * not this one — see the Golden Rule that `src/core/` never imports Obsidian).
 *
 * This is a separate concern from `query-action.ts`'s task/project data
 * retrieval: that answers "what does this workspace contain", this answers
 * "how does the app work" — the two never interact, and `AiChatView` injects
 * their results as two independent system messages.
 */

import type { HelpTopic } from "../help";

/** Depth-first: every topic (leaf or category) that has content of its own to match against and inject. A childless-content category (`_category.md` overview) qualifies same as a leaf. */
export function flattenHelpTopics(topics: HelpTopic[]): HelpTopic[] {
	const flat: HelpTopic[] = [];
	for (const topic of topics) {
		if (topic.content && topic.content.trim().length > 0) flat.push(topic);
		if (topic.children) flat.push(...flattenHelpTopics(topic.children));
	}
	return flat;
}

// `HELP_TOPICS` is a static generated constant for the process's whole
// lifetime — flatten it once rather than walking the tree on every message.
let cachedFlatTopics: HelpTopic[] | null = null;
let cachedFlatTopicsSource: HelpTopic[] | null = null;

function flattenHelpTopicsCached(topics: HelpTopic[]): HelpTopic[] {
	if (cachedFlatTopicsSource !== topics) {
		cachedFlatTopics = flattenHelpTopics(topics);
		cachedFlatTopicsSource = topics;
	}
	return cachedFlatTopics!;
}

/** Dropped from scoring — too short or too common to signal relevance either way. */
const STOPWORDS = new Set([
	"a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
	"is", "are", "was", "were", "be", "been", "being", "do", "does", "did",
	"can", "could", "would", "should", "will", "shall", "may", "might", "must",
	"i", "you", "he", "she", "it", "we", "they", "my", "your", "its", "our",
	"this", "that", "these", "those", "what", "how", "why", "when", "where",
	"who", "which", "at", "by", "from", "up", "down", "out", "so", "as",
	"if", "than", "then", "not", "no", "yes", "just", "get", "got", "into",
]);

/**
 * A crude plural-to-singular fold ("projects" → "project", "statuses" →
 * "status") — not real stemming, just enough that a query and a topic title
 * written in different grammatical number still overlap. Without it,
 * "how do I create a new project?" wouldn't score against a topic titled
 * "Projects" at all.
 */
function foldPlural(token: string): string {
	if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
	if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
	if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
	return token;
}

/** Lowercase, split on non-alphanumerics, fold plurals, drop stopwords and anything shorter than 2 chars. */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 1 && !STOPWORDS.has(token))
		.map(foldPlural);
}

/**
 * A title hit counts far more than a body hit — a question naming something
 * close to a topic's actual title should win over one that happens to share a
 * common word buried in a long body.
 */
const TITLE_WEIGHT = 5;
const BODY_WEIGHT = 1;

/**
 * Term-overlap score between a query and one topic, based on term *presence*
 * (does this query term appear at all in the title / body), not raw
 * occurrence counts. A long, thorough topic (the bundled Changelog is tens of
 * thousands of words) would otherwise win almost every query outright just by
 * containing more repetitions of common words — presence keeps a five-line
 * topic that names the query's terms once each competitive with a huge one
 * that happens to repeat them.
 *
 * The fraction of the query's terms found anywhere in the topic (`coverage`)
 * is added on top of the weighted hits, as a tie-breaking bonus rather than a
 * multiplier: a topic whose title directly names what's being asked about
 * should still win over a longer, more generic topic that happens to contain
 * every query word once each in its body — a multiplicative coverage penalty
 * would crush that single strong title hit before it ever got a chance.
 */
export function scoreHelpTopic(query: string, topic: HelpTopic): number {
	const queryTerms = [...new Set(tokenize(query))];
	if (queryTerms.length === 0) return 0;

	const titleTerms = new Set(tokenize(topic.title));
	const bodyTerms = new Set(tokenize(topic.content ?? ""));

	let hits = 0;
	let weighted = 0;
	for (const term of queryTerms) {
		if (titleTerms.has(term)) {
			weighted += TITLE_WEIGHT;
			hits++;
		} else if (bodyTerms.has(term)) {
			weighted += BODY_WEIGHT;
			hits++;
		}
	}

	return weighted + hits / queryTerms.length;
}

/**
 * Minimum score to trust a match enough to inject it. Tuned empirically
 * against real Help content: hitting only a couple of common words in a long
 * body (no title hit) lands well below it; a single title hit — the case a
 * genuinely on-topic question should produce — clears it outright. Errs
 * toward `null` on a weak/ambiguous match rather than injecting a
 * barely-relevant topic.
 */
const MIN_RELEVANCE_SCORE = TITLE_WEIGHT;

/**
 * The single best-matching help topic for a query, or `null` if nothing
 * clears the relevance threshold (including on a genuine tie at the top,
 * since a tie between two topics is itself evidence the match is ambiguous
 * rather than confidently about either one).
 */
export function matchHelpTopic(query: string, topics: HelpTopic[]): HelpTopic | null {
	const flat = flattenHelpTopicsCached(topics);
	let best: HelpTopic | null = null;
	let bestScore = 0;
	let tied = false;

	for (const topic of flat) {
		const score = scoreHelpTopic(query, topic);
		if (score > bestScore) {
			best = topic;
			bestScore = score;
			tied = false;
		} else if (score === bestScore && score > 0) {
			tied = true;
		}
	}

	if (bestScore < MIN_RELEVANCE_SCORE || tied) return null;
	return best;
}
