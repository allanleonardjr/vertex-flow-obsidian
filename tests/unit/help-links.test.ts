/**
 * Help deep-link safety net.
 *
 * `HELP_TOPIC` (in `core/help-links.ts`) points the app's inline help glyphs at
 * real help content. Topic ids are slugs derived from the markdown *path* and
 * anchors are slugs derived from the markdown *headings*, so either a rename or
 * a heading edit can silently break a pointer. These tests walk every entry and
 * assert it still resolves — a content change fails here instead of producing a
 * dead link at runtime.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_TOPICS, findHelpTopic, findHeadingSlugs, slugifyHeading } from "../../src/core/help";
import { HELP_TOPIC } from "../../src/core/help-links";

const CONTENT_DIR = join(__dirname, "../../src/help-content");

function markdownFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return markdownFiles(path);
		return /\.md$/.test(entry) ? [path] : [];
	});
}

describe("slugifyHeading", () => {
	it("lowercases, hyphenates spaces, and drops punctuation", () => {
		expect(slugifyHeading("Query Language")).toBe("query-language");
		expect(slugifyHeading("Hello, World!")).toBe("hello-world");
		expect(slugifyHeading("  Leading and Trailing  ")).toBe("leading-and-trailing");
	});

	it("collapses repeated separators and trims edges", () => {
		expect(slugifyHeading("a  b   c")).toBe("a-b-c");
		expect(slugifyHeading("-a-b-")).toBe("a-b");
	});

	it("flattens diacritics", () => {
		expect(slugifyHeading("Café au Lait")).toBe("cafe-au-lait");
	});

	it("leaves non-breaking hyphen in the markdown heading anchor intact", () => {
		// The `-`/`_` inside an atx heading map to a plain hyphen like any space.
		expect(slugifyHeading("Status — Priority")).toBe("status-priority");
	});
});

describe("findHeadingSlugs", () => {
	it("returns every heading slug in document order", () => {
		const md = "# One\n\n## Two Words\n\n### Café\n";
		expect(findHeadingSlugs(md)).toEqual(["one", "two-words", "cafe"]);
	});

	it("ignores lines that are not headings", () => {
		const md = "## Not a heading?\n\nThis is `# nah` inline.\n### Real";
		expect(findHeadingSlugs(md)).toEqual(["not-a-heading", "real"]);
	});
});

describe("HELP_TOPIC links resolve", () => {
	it("every key resolves to a real topic", () => {
		for (const spec of Object.values(HELP_TOPIC)) {
			const topic = findHelpTopic(HELP_TOPICS, spec.topicId);
			expect(topic, `missing topic "${spec.topicId}"`).not.toBeNull();
		}
	});

	it("every anchor exists as a heading slug in its topic's content", () => {
		for (const [key, spec] of Object.entries(HELP_TOPIC)) {
			if (spec.anchor == null) continue;
			const topic = findHelpTopic(HELP_TOPICS, spec.topicId);
			expect(topic, `missing topic "${spec.topicId}" from "${key}"`).not.toBeNull();
			expect(topic!.content, `topic "${spec.topicId}" has no content`).toBeTruthy();
			const slugs = findHeadingSlugs(topic!.content!);
			expect(slugs, `topic "${spec.topicId}" has no headings`).toContain(spec.anchor);
		}
	});

	it("every markdown file's slug matches how HELP_TOPICS ids are formed", () => {
		// Guard against a subtle drift: the generated id is the path slugified,
		// and this test's own topic lookups rely on that exact mapping. Reading
		// the content tree and confirming each id resolves keeps the two honest.
		for (const file of markdownFiles(CONTENT_DIR)) {
			if (file.endsWith("_category.md")) continue; // not a topic
			const rel = file.replace(CONTENT_DIR, "").replace(/^\/+/, "").replace(/\.md$/, "");
			const id = rel.split("/").join("-").replace(/[^a-zA-Z0-9]+/g, "-");
			expect(findHelpTopic(HELP_TOPICS, id), `unresolvable generated id "${id}"`).not.toBeNull();
		}
	});
});