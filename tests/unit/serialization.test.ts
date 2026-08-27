import { describe, expect, it } from "vitest";
import {
	COMMENTS_END,
	COMMENTS_START,
	extractMentionHandles,
	mentionsInNote,
	nextCommentId,
	parseComments,
	parseTask,
	parseViews,
	parseWorkspace,
	resolveMentions,
	serializeComments,
	serializeTask,
	serializeViews,
	serializeWorkspace,
	splitBody,
	withComments,
} from "../../src/core/serialization";
import { MIDDLE_RANK } from "../../src/core/ranking/lexorank";
import type { Person } from "../../src/core/types";

const opts = { path: "W/Tasks/PRD-0104", defaultStatus: "queue" };

// The exact frontmatter from vault-schema.md §4.1, as a parsed YAML object.
const SPEC_TASK = {
	type: "task",
	taskType: "bug",
	id: "PRD-0104",
	title: "Fix LexoRank calculation when moving tasks into empty Kanban columns",
	status: "in-progress",
	priority: "high",
	rank: "0|i00004:",
	cycleRank: "0|i00002:",
	project: "[[Projects/Kanban UI Engine]]",
	cycle: "[[Cycles/2026-Cycle-18]]",
	assignee: "alice",
	parent: "[[Tasks/PRD-0102]]",
	estimate: 3,
	labels: ["bug", "performance"],
	startDate: "2026-08-20",
	dueDate: "2026-08-28",
	archived: false,
	relations: {
		blocks: [],
		blockedBy: ["[[Tasks/PRD-0099]]"],
		related: [],
		duplicateOf: null,
	},
	createdAt: "2026-08-26T13:00:00Z",
	updatedAt: "2026-08-26T14:45:00Z",
};

describe("parseTask", () => {
	it("parses the documented schema example without complaint", () => {
		const { value, issues } = parseTask(SPEC_TASK, opts);
		expect(issues).toEqual([]);
		expect(value).toMatchObject({
			type: "task",
			id: "PRD-0104",
			taskType: "bug",
			status: "in-progress",
			priority: "high",
			rank: "0|i00004:",
			cycleRank: "0|i00002:",
			project: "Projects/Kanban UI Engine",
			cycle: "Cycles/2026-Cycle-18",
			parent: "Tasks/PRD-0102",
			assignee: "alice",
			estimate: 3,
			labels: ["bug", "performance"],
			startDate: "2026-08-20",
			dueDate: "2026-08-28",
			archived: false,
		});
		expect(value.relations.blockedBy).toEqual(["Tasks/PRD-0099"]);
	});

	it("takes its id from the filename, since the filename is the id", () => {
		const { value, issues } = parseTask(
			{ ...SPEC_TASK, id: "STALE-0001" },
			opts,
		);
		expect(value.id).toBe("PRD-0104");
		expect(issues[0]).toMatch(/does not match filename/);
	});

	it("falls back to the workspace default status, and says so", () => {
		const { value, issues } = parseTask({ title: "x" }, opts);
		expect(value.status).toBe("queue");
		expect(issues[0]).toMatch(/Missing status/);
	});

	it("titles an untitled task with its id rather than leaving it blank", () => {
		expect(parseTask({}, opts).value.title).toBe("PRD-0104");
	});

	it("resets a corrupt rank instead of throwing", () => {
		const { value, issues } = parseTask({ rank: "not-a-rank" }, opts);
		expect(value.rank).toBe(MIDDLE_RANK);
		expect(issues.some((i) => /Invalid rank/.test(i))).toBe(true);
	});

	it("drops a corrupt cycleRank so it falls back to rank", () => {
		const { value } = parseTask({ rank: "0|i00004:", cycleRank: "junk" }, opts);
		expect(value.cycleRank).toBeNull();
	});

	it("keeps exactly one primary parent when a note names two", () => {
		const { value, issues } = parseTask(
			{ project: "[[P/One]]", initiative: "[[I/One]]" },
			opts,
		);
		expect(value.project).toBe("P/One");
		expect(value.initiative).toBeNull();
		expect(issues.some((i) => /both a project and an initiative/.test(i))).toBe(true);
	});

	it("refuses to let a task parent itself", () => {
		const { value, issues } = parseTask({ parent: `[[${opts.path}]]` }, opts);
		expect(value.parent).toBeNull();
		expect(issues.some((i) => /its own parent/.test(i))).toBe(true);
	});

	it("treats archivedAt alone as archived (§7.7)", () => {
		const { value } = parseTask({ archivedAt: "2026-08-01T00:00:00Z" }, opts);
		expect(value.archived).toBe(true);
	});

	it("accepts a bare scalar where a list is expected", () => {
		expect(parseTask({ labels: "bug" }, opts).value.labels).toEqual(["bug"]);
	});

	it("accepts Date objects from the YAML parser", () => {
		const { value } = parseTask({ dueDate: new Date("2026-08-28T00:00:00Z") }, opts);
		expect(value.dueDate).toBe("2026-08-28");
	});

	it("never throws on garbage input", () => {
		for (const junk of [null, undefined, "a string", 42, []]) {
			expect(() => parseTask(junk, opts)).not.toThrow();
		}
	});
});

describe("serializeTask", () => {
	it("round-trips the documented example", () => {
		const parsed = parseTask(SPEC_TASK, opts).value;
		const reparsed = parseTask(serializeTask(parsed), opts).value;
		expect(reparsed).toEqual(parsed);
	});

	it("writes links back as wikilinks", () => {
		const fm = serializeTask(parseTask(SPEC_TASK, opts).value);
		expect(fm.project).toBe("[[Projects/Kanban UI Engine]]");
		expect((fm.relations as Record<string, unknown>).blockedBy).toEqual([
			"[[Tasks/PRD-0099]]",
		]);
	});

	it("omits empty fields but always writes `archived`", () => {
		const fm = serializeTask(parseTask({}, opts).value);
		expect(fm).not.toHaveProperty("priority");
		expect(fm).not.toHaveProperty("labels");
		expect(fm).not.toHaveProperty("relations");
		expect(fm.archived).toBe(false);
	});

	it("omits the relations block entirely when there are none", () => {
		const fm = serializeTask(parseTask({ title: "x" }, opts).value);
		expect(fm.relations).toBeUndefined();
	});

	it("never writes the derived fields back to frontmatter", () => {
		const fm = serializeTask(parseTask(SPEC_TASK, opts).value);
		expect(fm).not.toHaveProperty("path");
		expect(fm).not.toHaveProperty("mentions");
	});
});

describe("comments", () => {
	const BODY = `## Description
Something broke.

${COMMENTS_START}
## Comments
<comment id="cmt_01" author="jr-leonard" date="2026-08-26T14:15:00Z" reactions="👍:2,🚀:1">
I traced this back to the boundary check logic.
</comment>
<comment id="cmt_02" author="alice" date="2026-08-26T14:30:00Z" reactions="❤️:1">
@JR I can jump in and write the fix.
</comment>
${COMMENTS_END}
`;

	it("parses the documented comment block", () => {
		const comments = parseComments(BODY);
		expect(comments).toHaveLength(2);
		expect(comments[0]).toMatchObject({
			id: "cmt_01",
			author: "jr-leonard",
			date: "2026-08-26T14:15:00Z",
			reactions: { "👍": 2, "🚀": 1 },
		});
		expect(comments[1].body).toBe("@JR I can jump in and write the fix.");
	});

	it("separates the user's prose from the comment block", () => {
		const split = splitBody(BODY);
		expect(split.description.trim()).toBe("## Description\nSomething broke.");
		expect(split.commentsBlock).toContain("cmt_01");
	});

	it("treats a note with no comment block as all prose", () => {
		const split = splitBody("Just some writing.");
		expect(split.description).toBe("Just some writing.");
		expect(split.commentsBlock).toBeNull();
		expect(parseComments("Just some writing.")).toEqual([]);
	});

	it("round-trips comments through serialize/parse", () => {
		const comments = parseComments(BODY);
		expect(parseComments(serializeComments(comments))).toEqual(comments);
	});

	it("rewrites the block without touching the prose above it", () => {
		const comments = parseComments(BODY);
		const updated = withComments(BODY, [
			...comments,
			{ id: "cmt_03", author: "bob", date: "2026-08-27T00:00:00Z", body: "On it.", reactions: {} },
		]);
		expect(updated).toContain("## Description\nSomething broke.");
		expect(parseComments(updated)).toHaveLength(3);
	});

	it("removes the block entirely when the last comment goes", () => {
		const updated = withComments(BODY, []);
		expect(updated).not.toContain(COMMENTS_START);
		expect(updated.trim()).toBe("## Description\nSomething broke.");
	});

	it("adds a comment block to a note that never had one", () => {
		const updated = withComments("Some prose.\n", [
			{ id: "cmt_01", author: "alice", date: "2026-01-01T00:00:00Z", body: "Hi", reactions: {} },
		]);
		expect(parseComments(updated)).toHaveLength(1);
		expect(updated).toContain("Some prose.");
	});

	it("drops reactions with no count and keeps emoji intact", () => {
		const block = serializeComments([
			{ id: "cmt_01", author: "a", date: "d", body: "b", reactions: { "👍": 2, "🎉": 0 } },
		]);
		expect(parseComments(block)[0].reactions).toEqual({ "👍": 2 });
	});

	it("issues sequential comment ids", () => {
		expect(nextCommentId([])).toBe("cmt_01");
		expect(nextCommentId(parseComments(BODY))).toBe("cmt_03");
	});
});

describe("@mentions", () => {
	const people: Person[] = [
		{ id: "jr-leonard", name: "JR Leonard", aliases: ["jr"] },
		{ id: "alice", name: "Alice", aliases: [] },
	];

	it("extracts handles from text", () => {
		expect(extractMentionHandles("hey @alice and @jr-leonard!")).toEqual([
			"alice",
			"jr-leonard",
		]);
	});

	it("ignores an @ mid-word, like an email address", () => {
		expect(extractMentionHandles("mail me at bob@example.com")).toEqual([]);
	});

	it("resolves loosely so @JR finds jr-leonard", () => {
		expect(resolveMentions("@JR can you look?", people)).toEqual(["jr-leonard"]);
		expect(resolveMentions("@jr", people)).toEqual(["jr-leonard"]);
	});

	it("drops handles matching nobody — there is no auth here", () => {
		expect(resolveMentions("@nobody-at-all", people)).toEqual([]);
	});

	it("de-duplicates repeated mentions of one person", () => {
		expect(resolveMentions("@alice @alice @Alice", people)).toEqual(["alice"]);
	});

	it("collects mentions from both the description and the comments", () => {
		const body = `Ping @alice about this.\n${COMMENTS_START}\n<comment id="cmt_01" author="bob" date="d">\n@JR too\n</comment>\n${COMMENTS_END}`;
		expect(mentionsInNote(body, people).sort()).toEqual(["alice", "jr-leonard"]);
	});
});

describe("parseWorkspace", () => {
	const path = "Product Team/_workspace";

	it("parses the documented §4.5 config", () => {
		const { value, issues } = parseWorkspace(
			{
				type: "workspace",
				name: "Product Team",
				idPrefix: "PRD",
				cycles: { enabled: false, termLabel: "Cycle", rolloverPolicy: "auto-rollover" },
				archiving: { autoArchiveEnabled: false, autoArchiveDays: 30 },
				defaultNewTaskStatus: "queue",
				statuses: [
					{ id: "queue", name: "Queue", color: "#94a3b8", category: "backlog", order: 1 },
					{ id: "done", name: "Done", color: "#34d399", category: "completed", order: 2 },
				],
				priorities: [{ id: "high", name: "High", color: "#f97316", order: 1 }],
				taskTypes: [{ id: "bug", name: "Bug", color: "#ef4444" }],
				labels: [{ id: "performance", name: "Performance", color: "#f97316" }],
				people: [
					{ id: "alice", name: "Alice", isSelf: true },
					{ id: "bob", name: "Bob", isSelf: false },
				],
			},
			{ path },
		);

		expect(issues).toEqual([]);
		expect(value.name).toBe("Product Team");
		expect(value.root).toBe("Product Team");
		expect(value.cycles.enabled).toBe(false);
		expect(value.statuses).toHaveLength(2);
		expect(value.people.find((p) => p.isSelf)?.id).toBe("alice");
	});

	it("defaults cycles off and auto-archive off", () => {
		const { value } = parseWorkspace({ name: "W" }, { path });
		expect(value.cycles.enabled).toBe(false);
		expect(value.archiving.autoArchiveEnabled).toBe(false);
	});

	it("backfills default statuses rather than leaving a board with no columns", () => {
		const { value, issues } = parseWorkspace({ name: "W" }, { path });
		expect(value.statuses.length).toBeGreaterThan(0);
		expect(issues.some((i) => /No statuses defined/.test(i))).toBe(true);
	});

	it("repairs a status with an unknown category instead of dropping it", () => {
		const { value, issues } = parseWorkspace(
			{ statuses: [{ id: "weird", name: "Weird", color: "#000", category: "nope" }] },
			{ path },
		);
		expect(value.statuses[0].category).toBe("backlog");
		expect(issues.some((i) => /unknown category/.test(i))).toBe(true);
	});

	it("repoints defaultNewTaskStatus when it names a status that doesn't exist", () => {
		const { value, issues } = parseWorkspace(
			{
				defaultNewTaskStatus: "ghost",
				statuses: [{ id: "a", name: "A", color: "#000", category: "backlog", order: 1 }],
			},
			{ path },
		);
		expect(value.defaultNewTaskStatus).toBe("a");
		expect(issues.some((i) => /not a configured status/.test(i))).toBe(true);
	});

	it("allows only one isSelf", () => {
		const { value, issues } = parseWorkspace(
			{
				people: [
					{ id: "a", name: "A", isSelf: true },
					{ id: "b", name: "B", isSelf: true },
				],
			},
			{ path },
		);
		expect(value.people.filter((p) => p.isSelf)).toHaveLength(1);
		expect(issues.some((i) => /more than one person/i.test(i))).toBe(true);
	});

	it("rejects an unknown rollover policy", () => {
		const { value, issues } = parseWorkspace(
			{ cycles: { rolloverPolicy: "teleport" } },
			{ path },
		);
		expect(value.cycles.rolloverPolicy).toBe("auto-rollover");
		expect(issues.some((i) => /Unknown rolloverPolicy/.test(i))).toBe(true);
	});

	it("round-trips through serialize", () => {
		const first = parseWorkspace({ name: "W", idPrefix: "WWW" }, { path }).value;
		const second = parseWorkspace(serializeWorkspace(first), { path }).value;
		expect(second).toEqual(first);
	});
});

describe("parseViews", () => {
	it("parses the documented §4.6 views", () => {
		const { value, issues } = parseViews({
			views: [
				{
					id: "my-active-bugs",
					name: "My Active Bugs",
					viewType: "board",
					filters: { assignee: "self", taskType: ["bug"], status: ["todo", "in-progress"] },
					groupBy: "status",
					sortBy: "rank",
					columns: { collapsed: [], hidden: ["canceled"] },
					emptyColumnBehavior: "auto-collapse",
				},
				{
					id: "cycle-18-board",
					name: "Cycle 18 Board",
					viewType: "board",
					filters: { cycle: "Cycles/2026-Cycle-18" },
					groupBy: "status",
					sortBy: "cycleRank",
					columns: { collapsed: [], hidden: [] },
					emptyColumnBehavior: "show-normal",
				},
			],
		});

		expect(issues).toEqual([]);
		expect(value[0].filters.assignee).toEqual(["self"]);
		expect(value[0].filters.taskType).toEqual(["bug"]);
		expect(value[0].columns.hidden).toEqual(["canceled"]);
		expect(value[1].filters.cycle).toEqual(["Cycles/2026-Cycle-18"]);
		expect(value[1].sortBy).toBe("cycleRank");
	});

	it("normalizes a scalar filter into an array", () => {
		const { value } = parseViews({ views: [{ id: "v", filters: { status: "todo" } }] });
		expect(value[0].filters.status).toEqual(["todo"]);
	});

	it("normalizes a wikilink filter into a bare target", () => {
		const { value } = parseViews({
			views: [{ id: "v", filters: { project: "[[Projects/Core]]" } }],
		});
		expect(value[0].filters.project).toEqual(["Projects/Core"]);
	});

	it("falls back on unknown enum values and reports them", () => {
		const { value, issues } = parseViews({
			views: [{ id: "v", viewType: "calendar", groupBy: "phase", sortBy: "vibes" }],
		});
		expect(value[0].viewType).toBe("list");
		expect(value[0].groupBy).toBe("none");
		expect(value[0].sortBy).toBe("rank");
		expect(issues).toHaveLength(3);
	});

	it("defaults a board to grouping by status", () => {
		const { value } = parseViews({ views: [{ id: "v", viewType: "board" }] });
		expect(value[0].groupBy).toBe("status");
	});

	it("drops duplicate view ids", () => {
		const { value, issues } = parseViews({
			views: [{ id: "v", name: "First" }, { id: "v", name: "Second" }],
		});
		expect(value).toHaveLength(1);
		expect(value[0].name).toBe("First");
		expect(issues.some((i) => /Duplicate view id/.test(i))).toBe(true);
	});

	it("tolerates a missing or malformed views list", () => {
		expect(parseViews({}).value).toEqual([]);
		expect(parseViews(null).value).toEqual([]);
		expect(parseViews({ views: "nope" }).value).toEqual([]);
	});

	it("round-trips through serialize", () => {
		const first = parseViews({
			views: [{ id: "v", name: "V", viewType: "board", filters: { status: ["todo"] } }],
		}).value;
		expect(parseViews(serializeViews(first)).value).toEqual(first);
	});
});
