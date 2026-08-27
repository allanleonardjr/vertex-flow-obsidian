/**
 * Comments and @mentions (§4.1, §5.5).
 *
 * Comments live in the note *body*, inside an HTML-comment-delimited block, not
 * in frontmatter. Two reasons: frontmatter is a bad place for prose (YAML
 * escaping of multi-line text is miserable to hand-edit), and the delimiters let
 * the plugin rewrite the comment block without touching a single character of
 * the user's own writing above it.
 *
 * Comments are flat — no threading.
 */

import type { Comment, Person } from "../types";

export const COMMENTS_START = "<!-- PLUGIN_COMMENTS_START -->";
export const COMMENTS_END = "<!-- PLUGIN_COMMENTS_END -->";

const COMMENT_TAG_RE =
	/<comment\s+([^>]*?)>\n?([\s\S]*?)\n?<\/comment>/g;
const ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;

export interface SplitBody {
	/** Everything the user wrote, above the comment block. */
	description: string;
	/** The raw comment block, or null when the note has none yet. */
	commentsBlock: string | null;
	/** Anything after the end delimiter — preserved verbatim on rewrite. */
	trailing: string;
}

export function splitBody(body: string): SplitBody {
	const start = body.indexOf(COMMENTS_START);
	const end = body.indexOf(COMMENTS_END);

	if (start === -1 || end === -1 || end < start) {
		return { description: body, commentsBlock: null, trailing: "" };
	}

	return {
		description: body.slice(0, start),
		commentsBlock: body.slice(start + COMMENTS_START.length, end),
		trailing: body.slice(end + COMMENTS_END.length),
	};
}

function decodeReactions(raw: string | undefined): Record<string, number> {
	const reactions: Record<string, number> = {};
	if (!raw) return reactions;
	// `👍:2,🚀:1` — split on the *last* colon of each pair so emoji containing
	// no colon stay intact.
	for (const pair of raw.split(",")) {
		const trimmed = pair.trim();
		if (!trimmed) continue;
		const split = trimmed.lastIndexOf(":");
		if (split <= 0) continue;
		const emoji = trimmed.slice(0, split).trim();
		const count = Number.parseInt(trimmed.slice(split + 1), 10);
		if (emoji && Number.isFinite(count) && count > 0) reactions[emoji] = count;
	}
	return reactions;
}

function encodeReactions(reactions: Record<string, number>): string {
	return Object.entries(reactions)
		.filter(([, count]) => count > 0)
		.map(([emoji, count]) => `${emoji}:${count}`)
		.join(",");
}

export function parseComments(body: string): Comment[] {
	const { commentsBlock } = splitBody(body);
	if (commentsBlock == null) return [];

	const comments: Comment[] = [];
	COMMENT_TAG_RE.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = COMMENT_TAG_RE.exec(commentsBlock)) !== null) {
		const attrs: Record<string, string> = {};
		ATTR_RE.lastIndex = 0;
		let attr: RegExpExecArray | null;
		while ((attr = ATTR_RE.exec(match[1])) !== null) {
			attrs[attr[1]] = attr[2];
		}

		comments.push({
			id: attrs.id ?? `cmt_${comments.length + 1}`,
			author: attrs.author ?? "",
			date: attrs.date ?? "",
			body: match[2].trim(),
			reactions: decodeReactions(attrs.reactions),
		});
	}

	return comments;
}

export function serializeComments(comments: Comment[]): string {
	if (comments.length === 0) return "";

	const rendered = comments
		.map((comment) => {
			const reactions = encodeReactions(comment.reactions);
			const attrs = [
				`id="${comment.id}"`,
				`author="${comment.author}"`,
				`date="${comment.date}"`,
				reactions ? `reactions="${reactions}"` : null,
			]
				.filter(Boolean)
				.join(" ");
			return `<comment ${attrs}>\n${comment.body}\n</comment>`;
		})
		.join("\n");

	return `${COMMENTS_START}\n## Comments\n${rendered}\n${COMMENTS_END}`;
}

/**
 * Replace a note's comment block, leaving the user's own prose untouched.
 * Removing every comment removes the block entirely rather than leaving an
 * empty scaffold behind.
 */
export function withComments(body: string, comments: Comment[]): string {
	const { description, trailing } = splitBody(body);
	const block = serializeComments(comments);
	const prose = description.replace(/\s+$/, "");

	if (!block) return `${prose}${trailing ? `\n${trailing.trim()}` : ""}\n`;
	return `${prose}\n\n${block}${trailing ? `\n${trailing.trimEnd()}` : ""}\n`;
}

export function nextCommentId(comments: Comment[]): string {
	let max = 0;
	for (const comment of comments) {
		const match = /^cmt_(\d+)$/.exec(comment.id);
		if (match) max = Math.max(max, Number.parseInt(match[1], 10));
	}
	return `cmt_${String(max + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// @mentions
// ---------------------------------------------------------------------------

const MENTION_RE = /(^|[\s(\[])@([A-Za-z0-9_.-]+)/g;

/** Every `@handle` in a piece of text, lowercased, de-duplicated. */
export function extractMentionHandles(text: string): string[] {
	const handles: string[] = [];
	MENTION_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MENTION_RE.exec(text)) !== null) {
		const handle = match[2].toLowerCase().replace(/[.]+$/, "");
		if (handle && !handles.includes(handle)) handles.push(handle);
	}
	return handles;
}

function handlesFor(person: Person): string[] {
	const handles = [person.id, person.name, ...(person.aliases ?? [])];
	return handles
		.filter(Boolean)
		.map((handle) => handle.toLowerCase().replace(/\s+/g, ""));
}

/**
 * Resolve `@handle`s against the People register (§5.5).
 *
 * Matching is deliberately loose — `@JR`, `@jr-leonard` and `@JRLeonard` should
 * all find the same person, because nobody typing a comment is going to check
 * the exact spelling of an id first. Unresolvable handles are simply dropped:
 * there's no auth here, so an unknown `@someone` is just text.
 */
export function resolveMentions(text: string, people: Person[]): string[] {
	const handles = extractMentionHandles(text);
	if (handles.length === 0) return [];

	const resolved: string[] = [];
	for (const handle of handles) {
		for (const person of people) {
			const candidates = handlesFor(person);
			const hit =
				candidates.includes(handle) ||
				// Allow a prefix match so `@JR` finds `jr-leonard`, but only when
				// it's unambiguous enough to be a real handle rather than a letter.
				(handle.length >= 2 &&
					candidates.some((candidate) => candidate.startsWith(handle)));
			if (hit && !resolved.includes(person.id)) {
				resolved.push(person.id);
				break;
			}
		}
	}
	return resolved;
}

/** All mentions across a note's description and its comments. */
export function mentionsInNote(body: string, people: Person[]): string[] {
	const comments = parseComments(body);
	const text = [
		splitBody(body).description,
		...comments.map((comment) => comment.body),
	].join("\n");
	return resolveMentions(text, people);
}
