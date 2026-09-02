/**
 * Semantic keys for the help deep-link targets sprinkled across the UI.
 *
 * Topic ids are slugs derived from the markdown file's path (e.g.
 * `views/saved-views.md` → `views-saved-views`), so renaming or moving a help
 * doc silently breaks any raw string hardcoded in the UI. Call sites go through
 * `HELP_TOPIC.*` instead of typing ids by hand, and a Vitest test walks every
 * entry — resolving the id against the real topic tree and, when an `anchor`
 * is set, asserting the heading slug still exists in that topic's content — so
 * a content change fails a test rather than quietly producing a dead link.
 */

export interface HelpLinkTarget {
	/** A topic id from the generated HELP_TOPICS tree. */
	topicId: string;
	/** A `slugifyHeading` slug of a heading inside the topic's content. */
	anchor?: string;
}

/**
 * `as const satisfies Record<...>` keeps the literal key (`savedViewsQuery`)
 * in the type so `HELP_TOPIC[key]` resolves to a value whose fields are fully
 * known — a `Record<string, ...>` annotation would widen `keyof` to `string`
 * and make every lookup look like opaque, `any`-adjacent indexing to lint.
 */
export const HELP_TOPIC = {
	/** The Saved Views topic — hosts the "Query Language" section. */
	savedViewsQuery: { topicId: "views-saved-views", anchor: "query-language" },
} as const satisfies Record<string, HelpLinkTarget>;
