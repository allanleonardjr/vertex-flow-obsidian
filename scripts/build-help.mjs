/**
 * Generates `src/core/help-generated.ts` from the markdown tree in
 * `src/help-content/`. Runs automatically on every build/dev session (see
 * `esbuild.config.mjs`); never edit the generated file by hand.
 *
 * Content authoring rules:
 *   - Any `.md` file is a topic. Frontmatter may set `title`, `icon`, and
 *     `order` (number, lower sorts first — leave gaps like 10/20/30 so
 *     inserting a topic later doesn't require renumbering). Falls back to
 *     the first `# Heading`, then the filename.
 *   - Any folder is a category (a topic with children). Give it its own
 *     `title`/`icon`/`order`, and optional overview content, via a
 *     `_category.md` file inside it; without one it falls back to the
 *     folder name, title-cased, unordered.
 *   - Within a folder, ordered items sort by `order` first, then everything
 *     else, alphabetically by title.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, "../src/help-content");
const OUT_FILE = join(__dirname, "../src/core/help-generated.ts");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Minimal frontmatter parser: flat `key: value` pairs only — plenty for
 * `title`/`icon`/`order`, and keeps this script dependency-free. */
function parseFrontmatter(raw) {
	const match = FRONTMATTER_RE.exec(raw);
	if (!match) return { data: {}, body: raw };

	const data = {};
	for (const line of match[1].split(/\r?\n/)) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
		data[key] = value;
	}
	return { data, body: raw.slice(match[0].length) };
}

function titleCase(slug) {
	return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstHeading(body) {
	return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
}

function slugId(relPath) {
	return relPath
		.split(sep)
		.join("/")
		.replace(/\.md$/, "")
		.replace(/[^a-zA-Z0-9/]+/g, "-")
		.replace(/\/+/g, "-");
}

function sortEntries(entries) {
	return entries.sort((a, b) => {
		const ao = a.order ?? Infinity;
		const bo = b.order ?? Infinity;
		return ao !== bo ? ao - bo : a.title.localeCompare(b.title);
	});
}

function readTopicFile(absPath, relPath) {
	const { data, body } = parseFrontmatter(readFileSync(absPath, "utf8"));
	const fallbackName = relPath.replace(/\.md$/, "").split(sep).pop();
	return {
		id: slugId(relPath),
		title: data.title || firstHeading(body) || titleCase(fallbackName),
		icon: data.icon || undefined,
		order: data.order !== undefined ? Number(data.order) : undefined,
		content: body.trim(),
	};
}

function readCategoryMeta(dirAbs, dirRel) {
	try {
		const { data, body } = parseFrontmatter(readFileSync(join(dirAbs, "_category.md"), "utf8"));
		return {
			title: data.title || titleCase(dirRel.split(sep).pop()),
			icon: data.icon || undefined,
			order: data.order !== undefined ? Number(data.order) : undefined,
			content: body.trim() || undefined,
		};
	} catch {
		return { title: titleCase(dirRel.split(sep).pop() || dirRel), icon: undefined, order: undefined, content: undefined };
	}
}

function walk(dirAbs, dirRel) {
	const entries = [];

	for (const name of readdirSync(dirAbs)) {
		if (name === "_category.md") continue;
		const absPath = join(dirAbs, name);
		const relPath = dirRel ? join(dirRel, name) : name;

		if (statSync(absPath).isDirectory()) {
			const meta = readCategoryMeta(absPath, relPath);
			entries.push({ id: slugId(relPath), ...meta, children: walk(absPath, relPath) });
		} else if (name.endsWith(".md")) {
			entries.push(readTopicFile(absPath, relPath));
		}
	}

	return sortEntries(entries).map(({ order, ...topic }) => topic);
}

function emit(topics) {
	const source = `/*
 * GENERATED FILE — do not edit by hand.
 * Source: the markdown tree under src/help-content/
 * Regenerated automatically by esbuild.config.mjs (or run
 * \`node scripts/build-help.mjs\` directly).
 */

import type { HelpTopic } from "./help";

export const HELP_TOPICS: HelpTopic[] = ${JSON.stringify(topics, null, "\t")};
`;
	mkdirSync(dirname(OUT_FILE), { recursive: true });
	writeFileSync(OUT_FILE, source);
}

emit(walk(CONTENT_DIR, ""));
console.log(`[help] Generated ${OUT_FILE}`);
