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

	it("rejects the snapshot kind as not yet supported", () => {
		expectFailure(
			template(HEADER.replace("kind: template", "kind: snapshot")),
			/not yet supported/,
		);
		expectFailure(
			template(
				HEADER.replace("kind: template", "type: vertex-flow-workspace-snapshot"),
			),
			/not yet supported/,
		);
	});

	it("rejects any other kind", () => {
		expectFailure(
			template(HEADER.replace("kind: template", "kind: workspace")),
			/Unknown "kind: workspace"/,
		);
	});

	it("accepts the new type field spelling", () => {
		build(
			template(
				HEADER.replace("kind: template", "type: vertex-flow-workspace-template"),
			),
		);
	});
});

describe("template markdown — supportsExampleContent", () => {
	it("is derived from the body's Tasks when omitted — false with none", () => {
		const parsed = parseTemplateMarkdown(template(HEADER));
		expect(parsed.meta.supportsExampleContent).toBe(false);
	});

	it("is derived from the body's Tasks when omitted — true with Tasks", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER, "\n# Projects\n\n# Tasks\n\n## Something\n"),
		);
		expect(parsed.meta.supportsExampleContent).toBe(true);
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

	it("previews People, Projects, Views and Dashboards alongside the taxonomy", () => {
		const parsed = parseTemplateMarkdown(
			template(
				[
					HEADER,
					"people: [You*, Jordan]",
					"views:",
					"  - name: Backlog",
					"    icon: list",
					"dashboards:",
					"  - name: Overview",
					"    icon: gauge",
				].join("\n"),
				"\n# Projects\n\n## Client A\n\n# Tasks\n",
			),
		);
		const rows = new Map(parsed.meta.settings.map((s) => [s.label, s]));
		// `people` is an override, so the default taxonomy rows come along too.
		expect([...rows.keys()]).toEqual([
			"Statuses",
			"Priorities",
			"Task Types",
			"Labels",
			"Default view",
			"Views",
			"Dashboards",
			"Projects",
			"People",
		]);
		expect(rows.get("People")!.values.map((v) => v.name)).toEqual([
			"You",
			"Jordan",
		]);
		expect(rows.get("Projects")!.values.map((v) => v.name)).toEqual([
			"Client A",
		]);
		// People pills carry the user glyph; project pills ride the icon from
		// their field line (none here, so the renderer falls back).
		expect(rows.get("People")!.values.every((v) => v.icon === "user")).toBe(true);
		expect(rows.get("Projects")!.values.every((v) => v.icon === undefined)).toBe(
			true,
		);
		// Views/Dashboards ride as named pills carrying their icon glyph.
		expect(rows.get("Views")!.values).toEqual([
			{ name: "Backlog", icon: "list" },
		]);
		expect(rows.get("Dashboards")!.values).toEqual([
			{ name: "Overview", icon: "gauge" },
		]);
	});

	it("reads a Project's icon from its field line", () => {
		const parsed = parseTemplateMarkdown(
			template(
				HEADER,
				"\n# Projects\n\n## Client A\nicon: briefcase | status: todo\n",
			),
		);
		expect(parsed.projects[0].icon).toBe("briefcase");
		expect(parsed.projects[0].status).toBe("todo");
		const content = resolveTemplateContent(parsed, context());
		expect(content.projects[0].icon).toBe("briefcase");
		expect(content.projects[0].status).toBe("todo");
	});
});

describe("template markdown — frontmatter projects", () => {
	const PROJECT_FM = [
		HEADER,
		"statuses: [Todo (unstarted), Done (completed)]",
		"priorities: [High (#ef4444)]",
		"labels: [Important (#ef4444)]",
		"people: [Jordan]",
		"projects:",
		"  - title: Client A",
		"    icon: briefcase",
		"    description: The flagship engagement.",
		"    status: Todo",
		"    priority: High",
		"    owner: Jordan",
		"    labels: [Important]",
		"    start: 2026-09-01",
		"    due: 2026-09-30",
		"    created: 2026-08-26T12:00:00.000Z",
	].join("\n");

	it("parses a Project from frontmatter with every authored field", () => {
		const parsed = parseTemplateMarkdown(template(PROJECT_FM));
		expect(parsed.projects).toHaveLength(1);
		expect(parsed.projects[0]).toMatchObject({
			title: "Client A",
			icon: "briefcase",
			description: "The flagship engagement.",
			status: "Todo",
			priority: "High",
			owner: "Jordan",
			labels: ["Important"],
		});
		expect(parsed.projects[0].start?.kind).toBe("absolute");
		expect(parsed.projects[0].due?.kind).toBe("absolute");
		expect(parsed.projects[0].created?.kind).toBe("absolute");

		const content = resolveTemplateContent(parsed, context());
		const project = content.projects[0];
		expect(project.icon).toBe("briefcase");
		expect(project.status).toBe("todo");
		expect(project.priority).toBe("high");
		expect(project.owner).toBe("jordan");
		expect(project.labels).toEqual(["important"]);
		expect(project.startDate).toBe("2026-09-01");
		expect(project.dueDate).toBe("2026-09-30");
		expect(project.createdAt).toBe("2026-08-26T12:00:00.000Z");
		expect(content.projectDescriptions?.get(project.path)).toBe(
			"The flagship engagement.\n",
		);

		// The card preview reads the icon straight from the frontmatter entry.
		const projectsRow = parsed.meta.settings.find((s) => s.label === "Projects")!;
		expect(projectsRow.values).toEqual([{ name: "Client A", icon: "briefcase" }]);
	});

	it("merges frontmatter and body Projects, frontmatter first", () => {
		const parsed = parseTemplateMarkdown(
			template(PROJECT_FM, "\n# Projects\n\n## Client B\n\n# Tasks\n"),
		);
		expect(parsed.projects.map((p) => p.title)).toEqual(["Client A", "Client B"]);
	});

	it("rejects a frontmatter Project without a title", () => {
		const fm = [HEADER, "projects:", "  - icon: briefcase"].join("\n");
		expectFailure(template(fm), /missing the required "title"/);
	});

	it("rejects a non-string label entry", () => {
		const fm = [HEADER, "projects:", "  - title: Client A", "    labels: [1, 2]"].join("\n");
		expectFailure(template(fm), /labels\[0\] must be a string/);
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

describe("template markdown — taxonomy descriptions", () => {
	it("carries a trailing ` - description` on statuses", () => {
		const parsed = parseTemplateMarkdown(
			template(
				HEADER +
					'\nstatuses: ["To Do (unstarted) - not started yet", "Done (completed, #34d399) - finished work"]',
			),
		);
		const [todo, done] = parsed.workspaceOverrides.statuses!;
		expect(todo.description).toBe("not started yet");
		expect(done.description).toBe("finished work");
		expect(done.color).toBe("#34d399");
	});

	it("carries a description on labels and task types", () => {
		const parsed = parseTemplateMarkdown(
			template(
				HEADER + "\nlabels: [Important (#ef4444) - real weight]",
			),
		);
		expect(parsed.workspaceOverrides.labels![0].description).toBe("real weight");
	});

	it("leaves description unset for plain shorthand", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER + '\nlabels: ["Quick win (#22c55e)", "Waiting on someone (#f59e0b)"]'),
		);
		const [quick, waiting] = parsed.workspaceOverrides.labels!;
		expect(quick.description).toBeUndefined();
		expect(waiting.description).toBeUndefined();
	});

	it("keeps an extra paren group inside the name alongside a description", () => {
		const parsed = parseTemplateMarkdown(
			template(
				HEADER +
					'\nstatuses: ["Research (IRB) (started, #94a3b8) - ethics-approved study"]',
			),
		);
		const [status] = parsed.workspaceOverrides.statuses!;
		expect(status.name).toBe("Research (IRB)");
		expect(status.category).toBe("started");
		expect(status.color).toBe("#94a3b8");
		expect(status.description).toBe("ethics-approved study");
	});

	it("survives resolution onto the generated workspace", () => {
		const parsed = parseTemplateMarkdown(
			template(HEADER + '\nlabels: [Needs Advisor Feedback (#f59e0b) - review before next step]'),
		);
		const { workspace } = resolveTemplateContent(parsed, context());
		expect(workspace?.labels?.[0]).toMatchObject({
			name: "Needs Advisor Feedback",
			description: "review before next step",
		});
	});
});

describe("template markdown — repeat", () => {
	const withTask = (fieldLine: string) =>
		template(HEADER, `\n# Projects\n\n# Tasks\n\n## A task\n${fieldLine}\n`);

	const resolveTask = (fieldLine: string) => {
		const { tasks } = resolveTemplateContent(
			parseTemplateMarkdown(withTask(fieldLine)),
			context(),
		);
		return tasks[0];
	};

	it("a dateless `repeat: weekly` seeds one cadence step past today, on-date", () => {
		const task = resolveTask("repeat: weekly");
		expect(task.recurrence).toMatchObject({
			trigger: "on-date",
			freq: "weekly",
			interval: 1,
			anchor: "startDate",
		});
		// context()'s "today" is 2026-08-26 → first occurrence a week out.
		expect(task.recurrence?.nextDate).toBe("2026-09-02");
	});

	it("`every 3 months` parses the interval", () => {
		expect(resolveTask("repeat: every 3 months").recurrence).toMatchObject({
			freq: "monthly",
			interval: 3,
			trigger: "on-date",
		});
	});

	it("`monthly when completed` is the on-close trigger", () => {
		expect(resolveTask("repeat: monthly when completed").recurrence).toMatchObject({
			trigger: "on-close",
			freq: "monthly",
		});
	});

	it("seeds the first landing one cadence past the task's own due date", () => {
		const task = resolveTask("repeat: weekly | due: +3d");
		// Strictly past the anchor: the due date is *this* occurrence, so the
		// first landing is a full cadence ahead of it — not the same day.
		expect(task.recurrence).toMatchObject({
			anchor: "dueDate",
			nextDate: "2026-09-05",
		});
	});

	it("rejects an unrecognized cadence with a line-numbered error", () => {
		const error = expectFailure(
			withTask("repeat: fortnightly"),
			/Unrecognized "repeat" value "fortnightly"/,
		);
		expect(error.line).toBeGreaterThan(0);
	});
});
