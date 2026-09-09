import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { queryContext } from "../../src/core/query";
import { isSystemViewId } from "../../src/core/views";
import { serializeTemplateMarkdown } from "../../src/core/templates/markdown/serialize";
import { parseTemplateMarkdown } from "../../src/core/templates/markdown/parse";
import { resolveTemplateContent } from "../../src/core/templates/markdown/resolve";
import { formatTaskId } from "../../src/core/ids";
import { joinPath } from "../../src/core/links";
import type { TemplateBuildContext } from "../../src/core/templates/types";

const DAY = 24 * 60 * 60 * 1000;
function ctx(): TemplateBuildContext {
	const now = new Date("2026-08-26T12:00:00Z");
	const iso = (o: number) => new Date(now.getTime() + o * DAY).toISOString();
	return {
		root: "WS",
		idPrefix: "FIX",
		now,
		iso,
		day: (o) => iso(o).slice(0, 10),
		taskPath: (n) => joinPath("WS", "Tasks", formatTaskId("FIX", n)),
	};
}

const snapshot = sampleSnapshot();

function roundTrip() {
	const source = serializeTemplateMarkdown({
		meta: { id: "my-template", name: "My Template", icon: "rocket" },
		workspace: snapshot.workspace,
		views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
		dashboards: snapshot.dashboards,
		projects: snapshot.projects,
		queryContext: queryContext(snapshot),
	});
	const parsed = parseTemplateMarkdown(source);
	const content = resolveTemplateContent(parsed, ctx());
	return { source, parsed, content };
}

describe("serializeTemplateMarkdown round-trip", () => {
	it("reproduces the taxonomy with names, colors, categories and order", () => {
		const { parsed } = roundTrip();
		const statuses = parsed.workspaceOverrides.statuses!;
		expect(statuses.map((s) => s.name)).toEqual(
			snapshot.workspace.statuses.map((s) => s.name),
		);
		expect(statuses.map((s) => s.category)).toEqual(
			snapshot.workspace.statuses.map((s) => s.category),
		);
		expect(statuses.map((s) => s.color)).toEqual(
			snapshot.workspace.statuses.map((s) => s.color),
		);
		expect(statuses.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(parsed.workspaceOverrides.labels!.map((l) => l.name)).toEqual(
			snapshot.workspace.labels.map((l) => l.name),
		);
	});

	it("carries the people roster with no '*' me marker", () => {
		const { parsed } = roundTrip();
		expect(parsed.workspaceOverrides.people!.map((p) => p.name).sort()).toEqual(
			["Alice", "Bob"],
		);
		expect(parsed.mePersonId).toBeUndefined();
	});

	it("reproduces views through the query round-trip", () => {
		const { content } = roundTrip();
		const names = content.views!.map((v) => v.name);
		expect(names).toContain("Sprint Board");
		const sprint = content.views!.find((v) => v.name === "Sprint Board")!;
		expect(sprint.viewType).toBe("board");
		expect(sprint.groupBy).toBe("status");
	});

	it("reproduces dashboards (widget count + chart types)", () => {
		const { content } = roundTrip();
		const dash = content.dashboards!.find((d) => d.name === "Sprint Overview")!;
		expect(dash.widgets.length).toBe(3);
		expect(dash.widgets.map((w) => w.chartType).sort()).toEqual([
			"bar",
			"pie",
			"timeline",
		]);
	});

	it("carries the workspace's Projects and marks supportsExampleContent", () => {
		const { source, parsed, content } = roundTrip();
		expect(parsed.meta.supportsExampleContent).toBe(true);
		expect(parsed.tasks).toEqual([]);
		expect(parsed.projects.map((p) => p.title)).toEqual(
			["Core App Experience", "App Store Launch & Marketing", "Developer Platform"],
		);
		// The frontmatter entry is written in taxonomy names, so a re-import
		// resolves status/priority against the very statuses this template ships.
		expect(content.projects.map((p) => p.title)).toEqual(parsed.projects.map((p) => p.title));
		expect(content.projects.map((p) => p.status)).toEqual(
			snapshot.projects.map((p) => p.status),
		);
		expect(content.projects.map((p) => p.createdAt)).toEqual(
			snapshot.projects.map((p) => p.createdAt),
		);
		// Projects ride in frontmatter like Views/Dashboards, not as body sections.
		expect(source).toContain("projects:");
		expect(source).toContain(`title: ${snapshot.projects[0].title}`);
	});

	it("carries a Project's icon, description and dates", () => {
		const project = {
			...snapshot.projects[0],
			icon: "briefcase",
			startDate: "2026-09-01",
			dueDate: "2026-09-30",
		};
		const source = serializeTemplateMarkdown({
			meta: { id: "my-template", name: "My Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [project],
			projectDescriptions: { [project.path]: "The flagship app." },
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.projects[0]).toMatchObject({
			title: project.title,
			icon: "briefcase",
			status: snapshot.workspace.statuses.find((s) => s.id === project.status)?.name,
			description: "The flagship app.",
		});
		expect(parsed.projects[0].start?.kind).toBe("absolute");
		expect(parsed.projects[0].due?.kind).toBe("absolute");
		const content = resolveTemplateContent(parsed, ctx());
		expect(content.projects[0].icon).toBe("briefcase");
		expect(content.projects[0].startDate).toBe("2026-09-01");
		expect(content.projects[0].dueDate).toBe("2026-09-30");
		expect(content.projectDescriptions?.get(content.projects[0].path)).toBe(
			"The flagship app.\n",
		);
		// The description survives as frontmatter, not a body section.
		expect(source).toContain("description: The flagship app.");
	});

	it("drops archived projects from the template", () => {
		const archived = {
			...snapshot.projects[0],
			title: "Retired Project",
			archived: true,
			archivedAt: "2026-08-01T12:00:00.000Z",
		};
		const source = serializeTemplateMarkdown({
			meta: { id: "my-template", name: "My Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [...snapshot.projects, archived],
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.projects.map((p) => p.title)).not.toContain("Retired Project");
		expect(parsed.meta.supportsExampleContent).toBe(true);
	});

	it("a workspace with no Projects exports as a blank template", () => {
		const source = serializeTemplateMarkdown({
			meta: { id: "empty-template", name: "Empty Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [],
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.projects).toEqual([]);
		expect(parsed.meta.supportsExampleContent).toBe(false);
	});


	it("round-trips an optional createdAt timestamp", () => {
		const source = serializeTemplateMarkdown({
			meta: {
				id: "my-template",
				name: "My Template",
				createdAt: "2026-08-26T12:00:00.000Z",
			},
			workspace: snapshot.workspace,
			views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
			dashboards: snapshot.dashboards,
			projects: snapshot.projects,
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.meta.createdAt).toBe("2026-08-26T12:00:00.000Z");
	});


	it("leaves createdAt undefined when the template doesn't set one", () => {
		const { parsed } = roundTrip();
		expect(parsed.meta.createdAt).toBeUndefined();
	});
});
