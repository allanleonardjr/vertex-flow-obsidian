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
