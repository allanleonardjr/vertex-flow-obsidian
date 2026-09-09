import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { queryContext } from "../../src/core/query";
import { isSystemViewId } from "../../src/core/views";
import { serializeTemplateMarkdown } from "../../src/core/templates/markdown/serialize";
import { parseTemplateMarkdown } from "../../src/core/templates/markdown/parse";
import { resolveTemplateContent } from "../../src/core/templates/markdown/resolve";
import { formatTaskId } from "../../src/core/ids";
import { joinPath } from "../../src/core/links";
import { emptyRelations } from "../../src/core/types";
import type {
	RecurrenceConfig,
	RecurrenceFrequency,
	RecurrenceTrigger,
	Task,
} from "../../src/core/types";
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

/** A minimal, valid recurrence rule for `printRepeatToken` tests. */
function recurrence(
	partial: Partial<RecurrenceConfig> & {
		freq: RecurrenceFrequency;
		interval?: number;
		trigger?: RecurrenceTrigger;
		triggerStatus?: string | null;
	},
): RecurrenceConfig {
	return {
		trigger: partial.trigger ?? "on-date",
		triggerStatus: partial.triggerStatus ?? null,
		freq: partial.freq,
		interval: partial.interval ?? 1,
		weekdays: [],
		dayOfMonth: null,
		weekdayOfMonth: null,
		monthOfYear: null,
		anchor: "dueDate",
		newStatus: null,
		endsAfter: null,
		endsOn: null,
		nextDate: "2026-09-01",
		copyFields: null,
	};
}

/** A task shaped from the sample snapshot, with controllable links. */
function task(overrides: Partial<Task> & { id: string; title: string }): Task {
	return {
		...snapshot.tasks[0],
		relations: emptyRelations(),
		archived: false,
		...overrides,
	};
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

	it("carries the workspace's Projects (structure, not populatable material)", () => {
		const { source, parsed, content } = roundTrip();
		// Projects are always created, so a Projects-only template has nothing
		// for the populate toggle to gate — `supportsExampleContent` is false.
		expect(parsed.meta.supportsExampleContent).toBe(false);
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
		// A Projects-only template is still structure-only: nothing to populate.
		expect(parsed.meta.supportsExampleContent).toBe(false);
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

	it("carries Tasks in the body with links, fences and names", () => {
		const project = snapshot.projects[0];
		const status = snapshot.workspace.statuses.find((s) => s.category === "started")!;
		const priority = snapshot.workspace.priorities[0];
		const taskType = snapshot.workspace.taskTypes[0];
		const label = snapshot.workspace.labels[0];
		const alice = snapshot.workspace.people.find((p) => p.name === "Alice")!;
		const parent = task({
			id: "FIX-0102",
			title: "Parent task",
			path: joinPath("WS", "Tasks", "FIX-0102"),
			project: project.path,
		});
		const child = task({
			id: "FIX-0103",
			title: "Child task",
			path: joinPath("WS", "Tasks", "FIX-0103"),
			project: project.path,
			parent: parent.path,
			assignee: alice.id,
			status: status.id,
			priority: priority.id,
			taskType: taskType.id,
			labels: [label.id],
			estimate: 3,
			startDate: "2026-09-01",
			dueDate: "2026-09-15",
			createdAt: "2026-08-20T09:00:00.000Z",
			updatedAt: "2026-08-25T14:00:00.000Z",
			recurrence: recurrence({ freq: "weekly" }),
			relations: {
				blocks: [parent.path],
				blockedBy: [],
				related: [parent.path],
				duplicateOf: parent.path,
			},
		});

		const source = serializeTemplateMarkdown({
			meta: { id: "tasked-template", name: "Tasked Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: snapshot.projects,
			tasks: [parent, child],
			taskDescriptions: {
				[child.path]: "First line.\nSecond line.",
			},
			taskComments: {
				[child.path]: [
					{
						id: "c-1",
						author: alice.id,
						date: "2026-08-22T11:00:00.000Z",
						body: "Nice start.",
						reactions: {},
						editedAt: null,
						replyTo: null,
					},
				],
			},
			queryContext: queryContext(snapshot),
		});

		// Tasks make the template populatable — that's what the toggle seeds.
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.meta.supportsExampleContent).toBe(true);
		expect(source).toContain("supportsExampleContent: true");
		expect(parsed.tasks.map((t) => t.anchor)).toContain("FIX-0102");
		expect(parsed.tasks.map((t) => t.anchor)).toContain("FIX-0103");

		const childParsed = parsed.tasks.find((t) => t.title === "Child task")!;
		expect(childParsed.project).toBe(project.title);
		expect(childParsed.parent).toBe("FIX-0102");
		// Refs are written as names/anchors and re-resolved on import.
		expect(childParsed.status).toBe(status.name);
		expect(childParsed.priority).toBe(priority.name);
		expect(childParsed.type).toBe(taskType.name);
		expect(childParsed.assignee).toBe("Alice");
		expect(childParsed.estimate).toBe(3);
		expect(childParsed.labels).toEqual([label.name]);
		expect(childParsed.start?.kind).toBe("absolute");
		expect(childParsed.blocks).toEqual(["FIX-0102"]);
		expect(childParsed.related).toEqual(["FIX-0102"]);
		expect(childParsed.duplicateOf).toBe("FIX-0102");
		expect(childParsed.repeat).toMatchObject({
			freq: "weekly",
			interval: 1,
			onClose: false,
		});
		expect(childParsed.description).toBe("First line.\nSecond line.");
		expect(childParsed.comments).toMatchObject([
			{ author: "Alice", body: "Nice start." },
		]);

		// And the resolved re-import lands the same ids the workspace used.
		const content = resolveTemplateContent(parsed, ctx());
		const resolvedProject = content.projects.find(
			(p) => p.title === project.title,
		)!;
		const parentResolved = content.tasks.find(
			(t) => t.title === "Parent task",
		)!;
		const childResolved = content.tasks.find((t) => t.title === "Child task")!;
		expect(childResolved.project).toBe(resolvedProject.path);
		expect(childResolved.parent).toBe(parentResolved.path);
		expect(childResolved.assignee).toBe(alice.id);
		expect(childResolved.status).toBe(status.id);
		expect(childResolved.priority).toBe(priority.id);
		expect(childResolved.taskType).toBe(taskType.id);
		expect(childResolved.labels).toEqual([label.id]);
		expect(childResolved.estimate).toBe(3);
		expect(childResolved.startDate).toBe("2026-09-01");
		expect(childResolved.dueDate).toBe("2026-09-15");
		expect(childResolved.recurrence?.freq).toBe("weekly");
		expect(childResolved.relations.blocks).toEqual([parentResolved.path]);
		expect(childResolved.relations.related).toEqual([parentResolved.path]);
		expect(childResolved.relations.duplicateOf).toBe(parentResolved.path);
		expect(content.comments?.get(childResolved.path)?.[0]).toMatchObject({
			author: alice.id,
			body: "Nice start.",
		});
		expect(content.descriptions?.get(childResolved.path)).toBe(
			"First line.\nSecond line.\n",
		);
	});

	it("prints the repeat shorthand and skips rules it can't express", () => {
		const serializeWith = (recurrence: RecurrenceConfig) =>
			serializeTemplateMarkdown({
				meta: { id: "repeating-template", name: "Repeating Template" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				tasks: [
					task({
						id: "FIX-0104",
						title: "Recurring task",
						path: joinPath("WS", "Tasks", "FIX-0104"),
						recurrence,
					}),
				],
				queryContext: queryContext(snapshot),
			});

		expect(serializeWith(recurrence({ freq: "weekly" }))).toContain(
			"repeat: weekly",
		);
		expect(
			serializeWith(
				recurrence({ freq: "weekly", interval: 2, trigger: "on-close" }),
			),
		).toContain("repeat: every 2 weeks when completed");
		// An on-close rule firing on a specific status has no shorthand — it's
		// skipped rather than silently flattened into an on-date cadence.
		expect(
			serializeWith(
				recurrence({ freq: "daily", trigger: "on-close", triggerStatus: "s2" }),
			),
		).not.toContain("repeat:");
	});

	it("keeps archived Projects and Tasks only when includeArchived is set", () => {
		const archivedProject = {
			...snapshot.projects[0],
			title: "Retired Project",
			archived: true,
			archivedAt: "2026-08-01T12:00:00.000Z",
		};
		const archivedTask = task({
			id: "FIX-0105",
			title: "Archived task",
			path: joinPath("WS", "Tasks", "FIX-0105"),
			project: archivedProject.path,
			archived: true,
			archivedAt: "2026-08-02T12:00:00.000Z",
		});

		const base = {
			meta: { id: "archived-template", name: "Archived Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [...snapshot.projects, archivedProject],
			tasks: [archivedTask],
			queryContext: queryContext(snapshot),
		};

		// Default: both are trash, not template payload.
		let parsed = parseTemplateMarkdown(
			serializeTemplateMarkdown(base),
		);
		expect(parsed.projects.map((p) => p.title)).not.toContain("Retired Project");
		expect(parsed.tasks.map((t) => t.title)).not.toContain("Archived task");

		// A full snapshot keeps them — and the archived Task's project link
		// still resolves, because the archived Project rides along too.
		const content = resolveTemplateContent(
			parseTemplateMarkdown(
				serializeTemplateMarkdown({ ...base, includeArchived: true }),
			),
			ctx(),
		);
		expect(content.projects.map((p) => p.title)).toContain("Retired Project");
		const archivedResolved = content.tasks.find(
			(t) => t.title === "Archived task",
		)!;
		const resolvedArchivedProject = content.projects.find(
			(p) => p.title === archivedProject.title,
		)!;
		expect(archivedResolved.archived).toBe(true);
		expect(archivedResolved.project).toBe(resolvedArchivedProject.path);
	});

	it("drops dangling task links to Tasks excluded by the archived filter", () => {
		const kept = task({
			id: "FIX-0106",
			title: "Kept task",
			path: joinPath("WS", "Tasks", "FIX-0106"),
		});
		const archived = task({
			id: "FIX-0107",
			title: "Archived task",
			path: joinPath("WS", "Tasks", "FIX-0107"),
			archived: true,
			archivedAt: "2026-08-02T12:00:00.000Z",
			relations: {
				blocks: [kept.path],
				blockedBy: [],
				related: [kept.path],
				duplicateOf: kept.path,
			},
		});

		// Archived excluded, kept included: the archived task isn't serialized,
		// so nothing dangles. Include archived: the kept link stays, and a link
		// to an excluded task is dropped rather than breaking the file.
		const full = parseTemplateMarkdown(
			serializeTemplateMarkdown({
				meta: { id: "dangling-template", name: "Dangling Template" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				tasks: [kept, archived],
				includeArchived: true,
				queryContext: queryContext(snapshot),
			}),
		);
		const archivedParsed = full.tasks.find((t) => t.title === "Archived task")!;
		expect(archivedParsed.blocks).toEqual(["FIX-0106"]);
		expect(archivedParsed.related).toEqual(["FIX-0106"]);
		expect(archivedParsed.duplicateOf).toBe("FIX-0106");
		expect(parseTemplateMarkdown(
			serializeTemplateMarkdown({
				meta: { id: "dangling-template", name: "Dangling Template" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				tasks: [archived],
				queryContext: queryContext(snapshot),
			}),
		).tasks).toEqual([]);
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
