/**
 * Wikilink helpers.
 *
 * Hierarchy lives in frontmatter links (Golden Rule), so every parent/child
 * reference in this codebase passes through here. Links are stored in
 * frontmatter as `"[[Tasks/PRD-0104]]"` and normalized internally to the bare
 * target `"Tasks/PRD-0104"` — no brackets, no alias, no `.md`, no heading or
 * block anchor.
 */

import type { LinkTarget } from "./types";

const WIKILINK_RE = /^\s*\[\[([^\]]+)\]\]\s*$/;

/**
 * Normalize any of `[[A/B]]`, `[[A/B|Alias]]`, `[[A/B#Heading]]`, `A/B.md`,
 * or `A/B` down to `A/B`. Returns `null` for empty/absent input.
 */
export function parseLink(raw: unknown): LinkTarget | null {
	if (typeof raw !== "string") return null;
	let value = raw.trim();
	if (!value) return null;

	const match = WIKILINK_RE.exec(value);
	if (match) value = match[1];

	// Strip alias, then heading/block anchors.
	const pipe = value.indexOf("|");
	if (pipe !== -1) value = value.slice(0, pipe);
	const anchor = value.search(/[#^]/);
	if (anchor !== -1) value = value.slice(0, anchor);

	value = value.trim().replace(/\.md$/i, "");
	return value || null;
}

/** Parse a list of links, dropping anything unparseable. */
export function parseLinkList(raw: unknown): LinkTarget[] {
	if (raw == null) return [];
	const items = Array.isArray(raw) ? raw : [raw];
	const out: LinkTarget[] = [];
	for (const item of items) {
		const link = parseLink(item);
		if (link && !out.includes(link)) out.push(link);
	}
	return out;
}

/** Render a target back into frontmatter form: `[[Tasks/PRD-0104]]`. */
export function formatLink(target: LinkTarget | null): string | null {
	if (!target) return null;
	return `[[${target}]]`;
}

export function formatLinkList(targets: LinkTarget[]): string[] {
	return targets.map((t) => `[[${t}]]`);
}

/** The final path segment — `Tasks/PRD-0104` → `PRD-0104`. */
export function basename(target: LinkTarget): string {
	const slash = target.lastIndexOf("/");
	return slash === -1 ? target : target.slice(slash + 1);
}

/** The containing folder — `Tasks/PRD-0104` → `Tasks`, top level → `""`. */
export function dirname(target: LinkTarget): string {
	const slash = target.lastIndexOf("/");
	return slash === -1 ? "" : target.slice(0, slash);
}

/** Join path segments, tolerating empty ones. */
export function joinPath(...segments: string[]): string {
	return segments
		.filter((s) => s && s.length > 0)
		.join("/")
		.replace(/\/+/g, "/");
}

/**
 * Whether `target` lives inside `root` (or is `root` itself). Used to scope
 * index queries to a single Workspace in a multi-workspace vault.
 */
export function isWithin(target: LinkTarget, root: string): boolean {
	if (!root) return true;
	return target === root || target.startsWith(`${root}/`);
}

/**
 * Compare two link targets tolerantly. Obsidian permits short-form links
 * (`[[PRD-0104]]`) that resolve to a full path, so a stored short form must
 * still match the indexed full path. This is exactly why ID prefixes have to
 * be unique vault-wide (§3) — otherwise this comparison is ambiguous.
 */
export function linksMatch(a: LinkTarget | null, b: LinkTarget | null): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	return basename(a) === basename(b) && (!dirname(a) || !dirname(b));
}
