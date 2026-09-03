/**
 * Error paths in the markdown template parser.
 *
 * Deliberately narrow. The happy path — every taxonomy shorthand, every date
 * form, both comment forms, both dashboard layout forms, relation synthesis,
 * `query:` resolution — is carried by the two real templates in `templates/`,
 * which the whole-gallery suite in `templates.test.ts` already instantiates and
 * inspects. Re-asserting the same ground here would be a second copy of the
 * grammar to keep in sync.
 *
 * What a working template *can't* cover is what happens when it's broken. Those
 * are the cases below: each one is a mistake an author will make eventually,
 * and each must fail with a pointer rather than a wrong workspace.
 */

import { describe, expect, it } from "vitest";
import { parseTemplateMarkdown } from "../../src/core/templates/markdown/parse";
import { resolveTemplateContent } from "../../src/core/templates/markdown/resolve";
import { TemplateParseError } from "../../src/core/templates/markdown/types";
import type { TemplateBuildContext } from "../../src/core/templates/types";
import { formatTaskId } from "../../src/core/ids";
import { joinPath } from "../../src/core/links";

const HEADER = [
	"templateSchema: 1",
	"kind: template",
	"id: fixture",
	"name: Fixture",
	"description: A fixture.",
].join("\n");

/** Assembles a template file from frontmatter lines plus a body. */
function template(frontmatter: string, body = "\n# Projects\n\n# Tasks\n"): string {
	return `---\n${frontmatter}\n---\n${body}`;
}

const DAY = 24 * 60 * 60 * 1000;

function context(): TemplateBuildContext {
	const now = new Date("2026-08-26T12:00:00Z");
	const iso = (offset: number) => new Date(now.getTime() + offset * DAY).toISOString();
	return {
		root: "WS",
		idPrefix: "FIX",
		now,
		iso,
		day: (offset) => iso(offset).slice(0, 10),
		taskPath: (n) => joinPath("WS", "Tasks", formatTaskId("FIX", n)),
	};
}

/** Parses and resolves, so errors raised in either phase are caught the same
 *  way — an author doesn't care which pass rejected their file. */
function build(source: string): void {
	resolveTemplateContent(parseTemplateMarkdown(source), context());
}

function expectFailure(source: string, matcher: RegExp): TemplateParseError {
	let caught: unknown;
	try {
		build(source);
	} catch (error) {
		caught = error;
	}
	expect(caught, "expected the template to be rejected").toBeInstanceOf(
		TemplateParseError,
	);
	expect((caught as TemplateParseError).message).toMatch(matcher);
	return caught as TemplateParseError;
}

describe("template markdown — schema gate", () => {
	it("rejects a file with no templateSchema", () => {
		expectFailure(
			template(
				["kind: template", "id: fixture", "name: Fixture", "description: x"].join("\n"),
			),
			/missing "templateSchema"/,
		);
	});

	it("rejects a schema version newer than this parser understands", () => {
		const error = expectFailure(
			template(HEADER.replace("templateSchema: 1", "templateSchema: 99")),
			/needs templateSchema 99.*understands up to 1/s,
		);
		// The message has to say what to do about it, not just that it failed.
		expect(error.message).toMatch(/update the plugin/i);
	});

	it("rejects kind: snapshot as not yet supported", () => {
		expectFailure(
			template(HEADER.replace("kind: template", "kind: snapshot")),
			/"kind: snapshot" is not yet supported/,
		);
	});

	it("rejects any other kind", () => {
		expectFailure(
			template(HEADER.replace("kind: template", "kind: workspace")),
			/Unknown "kind: workspace"/,
		);
	});
});

describe("template markdown — supportsExampleContent", () => {
	it("is undefined when omitted", () => {
		const parsed = parseTemplateMarkdown(template(HEADER));
		expect(parsed.meta.supportsExampleContent).toBeUndefined();
	});

	it("parses supportsExampleContent: true", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER + "\nsupportsExampleContent: true"),
		);
		expect(parsed.meta.supportsExampleContent).toBe(true);
	});

	it("parses supportsExampleContent: false", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER + "\nsupportsExampleContent: false"),
		);
		expect(parsed.meta.supportsExampleContent).toBe(false);
	});

	it("rejects a non-boolean supportsExampleContent", () => {
		expectFailure(
			template(HEADER + '\nsupportsExampleContent: "yes"'),
			/"supportsExampleContent" must be true or false/,
		);
	});
});

describe("template markdown — card settings", () => {
	it("lists no taxonomy rows for a template that overrides nothing", () => {
		const parsed = parseTemplateMarkdown(template(HEADER));
		const labels = parsed.meta.settings.map((s) => s.label);
		// A "blank" template (no taxonomy overrides) shouldn't restate the
		// workspace defaults as if it chose them — only "Default view" applies.
		expect(labels).toEqual(["Default view"]);
	});

	it("shows default rows for a template that overrides at least one taxonomy", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER + "\nlabels: [Important (#ef4444)]"),
		);
		const labels = parsed.meta.settings.map((s) => s.label);
		expect(labels).toEqual([
			"Statuses",
			"Priorities",
			"Task Types",
			"Labels",
			"Default view",
		]);
	});
});

describe("template markdown — anchors", () => {
	it("rejects two nodes sharing an explicit anchor", () => {
		const error = expectFailure(
			template(
				HEADER,
				"\n# Projects\n\n# Tasks\n\n## First {#dupe}\n\n## Second {#dupe}\n",
			),
			/Duplicate anchor "dupe"/,
		);
		// Both offenders are named, so the author doesn't have to hunt for the pair.
		expect(error.message).toContain("First");
		expect(error.message).toContain("Second");
	});

	it("rejects two nodes whose titles slugify to the same default anchor", () => {
		expectFailure(
			template(
				HEADER,
				"\n# Projects\n\n# Tasks\n\n## Ship it!\n\n## Ship it\n",
			),
			/Duplicate anchor "ship-it"/,
		);
	});

	it("catches a collision between a Project and a Task", () => {
		// Projects and Tasks share one anchor namespace, because `project:` and
		// `parent:` resolve through the same lookup.
		expectFailure(
			template(
				HEADER,
				"\n# Projects\n\n## Launch\n\n# Tasks\n\n## Launch\n",
			),
			/Duplicate anchor "launch"/,
		);
	});
});

describe("template markdown — unresolvable references", () => {
	const cases: [string, string, RegExp][] = [
		["blocks", "blocks: [nope]", /"blocks: nope" does not name any Project or Task/],
		["blockedBy", "blockedBy: [nope]", /"blockedBy: nope" does not name any Project or Task/],
		["related", "related: [nope]", /"related: nope" does not name any Project or Task/],
		["duplicateOf", "duplicateOf: nope", /"duplicateOf: nope" does not name any Project or Task/],
		["parent", "parent: nope", /"parent: nope" does not name any Project or Task/],
	];

	for (const [field, line, matcher] of cases) {
		it(`rejects a ${field} naming something that doesn't exist`, () => {
			expectFailure(
				template(HEADER, `\n# Projects\n\n# Tasks\n\n## A task\n${line}\n`),
				matcher,
			);
		});
	}

	it("rejects a project reference matching neither a title nor an anchor", () => {
		expectFailure(
			template(
				HEADER,
				"\n# Projects\n\n## Real Project\n\n# Tasks\n\n## A task\nproject: Imaginary Project\n",
			),
			/"project: Imaginary Project" does not name any Project/,
		);
	});

	it("reports the line the bad reference sits on", () => {
		const error = expectFailure(
			template(HEADER, "\n# Projects\n\n# Tasks\n\n## A task\nblocks: [nope]\n"),
			/does not name any/,
		);
		expect(error.line).toBeGreaterThan(0);
		expect(error.describe()).toMatch(/^\d+ — /);
	});
});

describe("template markdown — contradictory block relations", () => {
	const body = (a: string, b: string) =>
		[
			"",
			"# Projects",
			"",
			"# Tasks",
			"",
			"## Alpha {#alpha}",
			a,
			"",
			"## Beta {#beta}",
			b,
			"",
			"## Gamma {#gamma}",
			"",
		].join("\n");

	it("rejects a blocks/blockedBy pair that disagrees", () => {
		// Alpha claims it blocks Beta; Beta says it's blocked by Gamma instead.
		expectFailure(
			template(HEADER, body("blocks: [beta]", "blockedBy: [gamma]")),
			/"Alpha" declares it blocks "Beta".*doesn't include it/s,
		);
	});

	it("rejects the same disagreement declared from the other side", () => {
		expectFailure(
			template(HEADER, body("blocks: [gamma]", "blockedBy: [alpha]")),
			/"Beta" declares it is blocked by "Alpha".*doesn't include it/s,
		);
	});

	it("accepts one side declared alone and synthesizes the inverse", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER, body("blocks: [beta]", "")),
		);
		const { tasks } = resolveTemplateContent(parsed, context());
		const alpha = tasks.find((t) => t.title === "Alpha")!;
		const beta = tasks.find((t) => t.title === "Beta")!;
		expect(alpha.relations.blocks).toEqual([beta.path]);
		expect(beta.relations.blockedBy).toEqual([alpha.path]);
	});

	it("accepts both sides declared in agreement", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER, body("blocks: [beta]", "blockedBy: [alpha]")),
		);
		const { tasks } = resolveTemplateContent(parsed, context());
		const alpha = tasks.find((t) => t.title === "Alpha")!;
		const beta = tasks.find((t) => t.title === "Beta")!;
		// Synthesis is idempotent — the edge isn't recorded twice.
		expect(alpha.relations.blocks).toEqual([beta.path]);
		expect(beta.relations.blockedBy).toEqual([alpha.path]);
	});
});
