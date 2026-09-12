/**
 * Semantic keys for the help deep-link targets sprinkled across the UI.
 *
 * Topic IDs are slugs derived from the markdown file's path (for example,
 * `views/saved-views.md` becomes `views-saved-views`). Renaming or moving a
 * help document would silently break raw IDs hardcoded in the UI, so call
 * sites use `HELP_TOPIC.*` instead.
 *
 * The help-links Vitest test walks each entry, resolves its topic ID against
 * the real generated topic tree, and—when an anchor is provided—verifies that
 * its heading slug still exists in the topic content.
 */

export interface HelpLinkTarget {
  /** A topic ID from the generated HELP_TOPICS tree. */
  topicId: string;
  /** A `slugifyHeading` slug of a heading inside the topic's content. */
  anchor?: string;
}

/**
 * `as const satisfies Record<...>` retains the literal key and value types
 * while still verifying every entry conforms to HelpLinkTarget. In particular,
 * `keyof typeof HELP_TOPIC` remains the finite union of semantic keys rather
 * than widening to `string`.
 */
export const HELP_TOPIC = {
  /** The Saved Views topic — hosts the Query Language section. */
  savedViewsQuery: {
    topicId: "views-saved-views",
    anchor: "query-language",
  },
} as const satisfies Record<string, HelpLinkTarget>;
