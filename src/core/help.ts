/**
 * Types + lookup for Help content. The topic tree itself is generated from
 * `src/help-content/**\/*.md` by `scripts/build-help.mjs` — see
 * `help-generated.ts` (gitignored, regenerated on every build/dev run).
 */

export interface HelpTopic {
	id: string;
	title: string;
	icon?: string;
	content?: string;
	children?: HelpTopic[];
}

export { HELP_TOPICS } from "./help-generated";

/** Depth-first lookup by id, anywhere in the tree. */
export function findHelpTopic(topics: HelpTopic[], id: string): HelpTopic | null {
	for (const topic of topics) {
		if (topic.id === id) return topic;
		if (topic.children) {
			const found = findHelpTopic(topic.children, id);
			if (found) return found;
		}
	}
	return null;
}

/**
 * The slug a rendered heading's anchor maps to. Obsidian's MarkdownRenderer
 * doesn't inject heading ids, so deep links have to recompute them from the
 * heading text with the same rules at both test time (walking the raw markdown)
 * and render time (walking the rendered DOM) — one source function so they
 * can't drift apart.
 *
 * Lowercase, whitespace (incl. the markdown `-`/`_` punctuation separators)
 * collapses to a single hyphen, non-alphanumerics are dropped, and diacritics
 * are flattened. A leading `#` from an atx heading, or leading/trailing
 * whitespace, is stripped by the caller before it reaches here.
 */
export function slugifyHeading(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
}

/**
 * The slugs of every `# …` heading in a markdown string, in document order.
 * Used by the deep-link safety test: each `help-links` anchor must exist in its
 * topic's real content, so renaming a heading fails a test instead of
 * silently landing nowhere at render time.
 */
export function findHeadingSlugs(markdown: string): string[] {
	const slugs: string[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
		if (match) slugs.push(slugifyHeading(match[1]));
	}
	return slugs;
}
