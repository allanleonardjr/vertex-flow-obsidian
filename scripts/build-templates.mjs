/**
 * Generates `src/core/templates/generated.ts` from the markdown tree in
 * `templates/`. Runs automatically on every build/dev session (see
 * `esbuild.config.mjs`); never edit the generated file by hand.
 *
 * Unlike `build-help.mjs`, this script deliberately does **not** understand the
 * files it reads. Template markdown is parsed by `parseTemplateMarkdown()` in
 * `src/core/templates/markdown/` — one parser, shared by the build-time
 * templates baked in here and (later) user-authored ones discovered in a vault.
 * All this script does is inline each file's raw text so the plugin bundle can
 * reach it without a filesystem.
 *
 * It still *validates* every template by running that parser, so an authoring
 * mistake fails the build with a file/field/value pointer rather than surfacing
 * as a mystery at workspace-creation time.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, "../templates");
const OUT_FILE = join(__dirname, "../src/core/templates/generated.ts");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Validation runs the *real* parser, not a second copy of the grammar.
 *
 * `parseTemplateMarkdown` / `resolveTemplateContent` are TypeScript and this
 * script is plain ESM run before `tsc`, so they're bundled to a throwaway
 * module here and imported. That's a few hundred milliseconds, and it buys the
 * thing a duplicated validator could never give: every rule in the grammar —
 * unresolvable anchors, contradictory relations, unknown taxonomy names, bad
 * `query:` strings — enforced at build time, from one implementation.
 *
 * Without this the parser would only run when the plugin loads, which means a
 * typo'd anchor would ship green and fail in someone's vault.
 */
async function loadParser() {
	// Bundled inside the repo, not the OS temp dir, so `yaml` stays external
	// and resolves from node_modules the normal way — bundling it produces
	// `require()` calls an ESM import can't execute.
	const outfile = join(
		mkdtempSync(join(__dirname, "..", ".template-validate-")),
		"parser.mjs",
	);
	await esbuild.build({
		entryPoints: [join(__dirname, "../src/core/templates/markdown/index.ts")],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		external: ["yaml"],
		logLevel: "silent",
	});
	return { module: await import(pathToFileURL(outfile).href), outfile };
}

/** A stand-in build context: validation only needs resolution to *run*, and
 *  nothing it checks depends on the real workspace root or clock. */
function validationContext() {
	const now = new Date("2026-01-01T00:00:00Z");
	const iso = (offset) => new Date(now.getTime() + offset * 86400000).toISOString();
	return {
		root: "Validation",
		idPrefix: "VAL",
		now,
		iso,
		day: (offset) => iso(offset).slice(0, 10),
		taskPath: (n) => `Validation/Tasks/VAL-${String(n).padStart(4, "0")}`,
	};
}

const SUPPORTED_SCHEMA = 1;

function problem(fileName, message) {
	console.error(`\n[templates] templates/${fileName} — ${message}\n`);
	process.exit(1);
}

/** The one check the parser can't make, because it never sees the filename. */
function validateFileName(fileName, raw) {
	const match = FRONTMATTER_RE.exec(raw.replace(/^\ufeff/, ""));
	if (!match) {
		problem(fileName, `has no YAML frontmatter (it must start with a "---" line)`);
	}

	let data;
	try {
		data = parseYaml(match[1]);
	} catch (error) {
		problem(fileName, `frontmatter is not valid YAML: ${error.message}`);
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		problem(fileName, `frontmatter must be a YAML map`);
	}

	const expectedId = fileName.replace(/\.md$/, "");
	if (data.id !== undefined && data.id !== expectedId) {
		problem(
			fileName,
			`declares "id: ${data.id}" but the file is named "${expectedId}.md" — they must match`,
		);
	}
	return expectedId;
}

const files = readdirSync(TEMPLATE_DIR)
	.filter((name) => name.endsWith(".md"))
	.sort();

const { module: parser, outfile } = await loadParser();
const ctx = validationContext();
const entries = [];

try {
	for (const name of files) {
		const raw = readFileSync(join(TEMPLATE_DIR, name), "utf8");
		const id = validateFileName(name, raw);

		try {
			const parsed = parser.parseTemplateMarkdown(raw);
			if (parsed.meta.id !== id) {
				problem(
					name,
					`declares "id: ${parsed.meta.id}" but the file is named "${id}.md" — they must match`,
				);
			}
			for (const warning of parsed.warnings) {
				console.warn(`[templates] templates/${name} — ${warning}`);
			}
			parser.resolveTemplateContent(parsed, ctx);
		} catch (error) {
			// A grammar error already says which field and value is wrong, and
			// often which line — prefix the file and print that, not a stack.
			if (error?.name === "TemplateParseError") {
				const at = error.line !== undefined ? `:${error.line}` : "";
				problem(name.replace(/\.md$/, `.md${at}`), error.message);
			}
			throw error;
		}

		// JSON.stringify rather than a template literal: template markdown is full
		// of backticks (fenced code) and `${`, and hand-escaping either is a bug
		// waiting to happen.
		entries.push(`\t${JSON.stringify(id)}: ${JSON.stringify(raw)},`);
	}
} finally {
	rmSync(dirname(outfile), { recursive: true, force: true });
}

const source = `/*
 * GENERATED FILE — do not edit by hand.
 * Source: the markdown files under templates/
 * Regenerated automatically by esbuild.config.mjs (or run
 * \\\`node scripts/build-templates.mjs\\\` directly).
 */

/** Template id → the raw text of \\\`templates/<id>.md\\\`. */
export const TEMPLATE_SOURCES: Record<string, string> = {
${entries.join("\n")}
};
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, source);
console.log(
	`[templates] Generated ${OUT_FILE} (${files.length} template${files.length === 1 ? "" : "s"})`,
);
