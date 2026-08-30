import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import {
	applyFilters,
	canonicalizeDefinition,
	canonicalizeHiddenFields,
	DEFAULT_DEFINITION,
	defaultViews,
	definitionsEqual,
	newView,
	renderedHiddenFields,
	evaluateView,
	groupTasks,
	seedFromFilters,
	hiddenGroups,
	isEmptyFilterSet,
	matchesFilters,
	snapshotContext,
	sortTasks,
	setColumnsCollapsed,
	toggleColumnCollapsed,
	toggleColumnHidden,
	viewDefinition,
	visibleGroups,
} from "../../src/core/views";
import {
	NONE,
	SELF,
	TASK_FIELDS,
	emptyRelations,
	type SavedView,
	type Task,
} from "../../src/core/types";

const snapshot = sampleSnapshot();
const context = snapshotContext(snapshot);
const view = (partial: Partial<SavedView> = {}): SavedView => ({
	...newView("test", "Test", "board"),
	...partial,
});

function task(overrides: Partial<Task> & { path: string }): Task {
	return {
		type: "task",
		id: overrides.path,
		title: "t",
		taskType: null,
		status: "queue",
		priority: null,
		rank: "0|i00000:",
		project: null,
		parent: null,
		assignee: null,
		estimate: null,
		labels: [],
		startDate: null,
		dueDate: null,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		mentions: [],
		...overrides,
	};
}

describe("filtering", () => {
	it("hides archived tasks by default, mixes them in, or shows only them (§7.7)", () => {
		const all = applyFilters(snapshot.tasks, {}, context);
		expect(all.some((t) => t.archived)).toBe(false);

		const archivedCount = snapshot.tasks.filter((t) => t.archived).length;
		expect(archivedCount).toBe(3);

		const included = applyFilters(
			snapshot.tasks,
			{ archived: "included" },
			context,
		);
		expect(included.length).toBe(all.length + archivedCount);

		const only = applyFilters(snapshot.tasks, { archived: "only" }, context);
		expect(only.length).toBe(archivedCount);
		expect(only.every((t) => t.archived)).toBe(true);
	});

	it("openOnly drops completed and canceled tasks (per category)", () => {
		const tasks = [
			task({ path: "A", status: "todo" }),
			task({ path: "B", status: "in-progress" }),
			task({ path: "C", status: "done" }),
			task({ path: "D", status: "canceled" }),
		];
		const open = applyFilters(tasks, { openOnly: true }, context);
		expect(open.map((t) => t.id)).toEqual(["A", "B"]);
		// Independent of the archived filter: an archived-but-open task still
		// needs the archived flag to show, and openOnly never reveals finished
		// work.
		expect(applyFilters(tasks, {}, context).length).toBe(4);
	});

	it("unscheduled drops any task with a startDate or dueDate", () => {
		const tasks = [
			task({ path: "A" }),
			task({ path: "B", dueDate: "2026-09-01" }),
			task({ path: "C", startDate: "2026-09-01" }),
		];
		expect(applyFilters(tasks, { unscheduled: true }, context).map((t) => t.id)).toEqual([
			"A",
		]);
	});

	it("ORs within one filter and ANDs across filters", () => {
		const result = applyFilters(
			snapshot.tasks,
			{ status: ["todo", "in-progress"], taskType: ["bug"] },
			context,
		);
		// The two bugs that are todo or in progress (SMP-0118 is in review).
		expect(result.map((t) => t.id)).toEqual(["SMP-0104", "SMP-0119"]);
	});

	it("matches nothing when a filter's values are all absent", () => {
		expect(applyFilters(snapshot.tasks, { status: ["nope"] }, context)).toEqual([]);
	});

	it("ignores an empty filter array", () => {
		expect(applyFilters(snapshot.tasks, { status: [] }, context).length).toBe(
			applyFilters(snapshot.tasks, {}, context).length,
		);
	});

	it("resolves `self` against the isSelf person (§7.6)", () => {
		const mine = applyFilters(snapshot.tasks, { assignee: [SELF] }, context);
		expect(mine.length).toBeGreaterThan(0);
		expect(mine.every((t) => t.assignee === "alice")).toBe(true);
	});

	it("matches nothing for `self` when no one is flagged isSelf", () => {
		// Honest beats convenient: "Assigned to Me" with no `me` configured must
		// not silently degrade into "All Tasks".
		const anonymous = snapshotContext({
			...snapshot,
			workspace: {
				...snapshot.workspace,
				people: snapshot.workspace.people.map((p) => ({ ...p, isSelf: false })),
			},
		});
		expect(applyFilters(snapshot.tasks, { assignee: [SELF] }, anonymous)).toEqual([]);
	});

	it("resolves `self` for mentions", () => {
		const mentioned = applyFilters(snapshot.tasks, { mentions: [SELF] }, context);
		expect(mentioned.map((t) => t.id).sort()).toEqual(["SMP-0101", "SMP-0104"]);
	});

	it("matches unset fields with the NONE sentinel", () => {
		const unassigned = applyFilters(
			snapshot.tasks,
			{ assignee: [NONE] },
			context,
		);
		expect(unassigned.every((t) => t.assignee === null)).toBe(true);
		expect(unassigned.length).toBeGreaterThan(0);

		const noProject = applyFilters(snapshot.tasks, { project: [NONE] }, context);
		expect(noProject.every((t) => t.project === null)).toBe(true);
	});

	it("matches multi-select labels by any overlap", () => {
		const result = applyFilters(snapshot.tasks, { labels: ["docs"] }, context);
		expect(result.map((t) => t.id).sort()).toEqual([
			"SMP-0106",
			"SMP-0107",
			"SMP-0113",
			"SMP-0122",
			"SMP-0123",
		]);
	});

	it("filters by link, tolerating short-form wikilinks", () => {
		const byPath = applyFilters(
			snapshot.tasks,
			{ project: ["Sample/Projects/Core App Experience"] },
			context,
		);
		const byShortForm = applyFilters(
			snapshot.tasks,
			{ project: ["Core App Experience"] },
			context,
		);
		expect(byPath.length).toBe(5);
		expect(byShortForm.map((t) => t.id)).toEqual(byPath.map((t) => t.id));
	});

	it("drops sub-tasks only when subtaskDisplay is hidden", () => {
		const hidden = evaluateView(
			snapshot,
			view({ viewType: "list", groupBy: "none", subtaskDisplay: "hidden" }),
			context,
		);
		expect(hidden.tasks.every((t) => t.parent === null)).toBe(true);

		for (const mode of ["nested", "flat"] as const) {
			const kept = evaluateView(
				snapshot,
				view({ viewType: "list", groupBy: "none", subtaskDisplay: mode }),
				context,
			);
			expect(kept.tasks.some((t) => t.parent !== null)).toBe(true);
		}
	});

	it("matches free text against title and id", () => {
		expect(
			applyFilters(snapshot.tasks, { text: "lexorank" }, context).map((t) => t.id),
		).toEqual(["SMP-0104"]);
		expect(
			applyFilters(snapshot.tasks, { text: "smp-0106" }, context).map((t) => t.id),
		).toEqual(["SMP-0106"]);
	});

	it("recognises an empty filter set", () => {
		expect(isEmptyFilterSet({})).toBe(true);
		// "included" only widens, so a view carrying just that still shows all.
		expect(isEmptyFilterSet({ archived: "included" })).toBe(true);
		// "only" genuinely restricts the result set.
		expect(isEmptyFilterSet({ archived: "only" })).toBe(false);
		expect(isEmptyFilterSet({ status: ["todo"] })).toBe(false);
	});

	it("exposes a single-task predicate matching the bulk one", () => {
		for (const t of snapshot.tasks) {
			expect(matchesFilters(t, { status: ["todo"] }, context)).toBe(
				applyFilters([t], { status: ["todo"] }, context).length === 1,
			);
		}
	});
});

describe("sorting", () => {
	it("sorts by rank ascending by default", () => {
		const sorted = sortTasks(snapshot.tasks, "rank", "asc", context);
		expect(sorted[0].id).toBe("SMP-0101");
	});

	it("sorts by taxonomy order, not alphabetically, for priority", () => {
		const sorted = sortTasks(snapshot.tasks, "priority", "asc", context);
		// urgent(1) before high(2) before medium(3) before low(4).
		expect(sorted[0].priority).toBe("urgent");
		expect(sorted[sorted.length - 1].priority).toBe("low");
	});

	it("reverses on desc", () => {
		const asc = sortTasks(snapshot.tasks, "title", "asc", context);
		const desc = sortTasks(snapshot.tasks, "title", "desc", context);
		expect(desc.map((t) => t.id)).toEqual([...asc].reverse().map((t) => t.id));
	});

	it("keeps unset values last in both directions", () => {
		const tasks = [
			task({ path: "a", dueDate: "2026-01-02" }),
			task({ path: "b", dueDate: null }),
			task({ path: "c", dueDate: "2026-01-01" }),
		];
		expect(sortTasks(tasks, "dueDate", "asc", context).map((t) => t.path)).toEqual([
			"c",
			"a",
			"b",
		]);
		// Descending flips the dated tasks but must not promote the undated one.
		expect(sortTasks(tasks, "dueDate", "desc", context).map((t) => t.path)).toEqual([
			"a",
			"c",
			"b",
		]);
	});

	it("breaks ties by rank", () => {
		const tasks = [
			task({ path: "b", dueDate: "2026-01-01", rank: "0|i00002:" }),
			task({ path: "a", dueDate: "2026-01-01", rank: "0|i00001:" }),
		];
		expect(sortTasks(tasks, "dueDate", "asc", context).map((t) => t.path)).toEqual([
			"a",
			"b",
		]);
	});

	it("does not mutate its input", () => {
		const copy = [...snapshot.tasks];
		sortTasks(snapshot.tasks, "title", "desc", context);
		expect(snapshot.tasks).toEqual(copy);
	});
});

describe("grouping", () => {
	it("emits a column for every status, even empty ones", () => {
		const groups = groupTasks([], "status", context);
		// The software-sprint fixture's status set — two `started` statuses
		// (In Progress, In Review) on purpose.
		expect(groups.map((g) => g.key)).toEqual([
			"backlog",
			"todo",
			"in-progress",
			"in-review",
			"done",
			"canceled",
		]);
		expect(groups.every((g) => g.tasks.length === 0)).toBe(true);
	});

	it("carries the taxonomy's colour and name onto the column", () => {
		const [backlog] = groupTasks([], "status", context);
		expect(backlog.label).toBe("Backlog");
		expect(backlog.color).toBe("#94a3b8");
	});

	it("puts a multi-labelled task in every one of its label columns", () => {
		const groups = groupTasks(snapshot.tasks, "label", context);
		const inDesign = groups.find((g) => g.key === "design")?.tasks ?? [];
		const inDocs = groups.find((g) => g.key === "docs")?.tasks ?? [];
		expect(inDesign.some((t) => t.id === "SMP-0107")).toBe(true);
		expect(inDocs.some((t) => t.id === "SMP-0107")).toBe(true);
	});

	it("buckets tasks with no value into a trailing 'none' group", () => {
		const groups = groupTasks(snapshot.tasks, "project", context);
		expect(groups[groups.length - 1].key).toBe(NONE);
		expect(groups[groups.length - 1].label).toBe("No Project");
	});

	it("names link groups by title, not by path", () => {
		const groups = groupTasks(snapshot.tasks, "project", context);
		expect(groups.map((g) => g.label)).toContain("Core App Experience");
	});

	it("returns one group when grouping is off", () => {
		const groups = groupTasks(snapshot.tasks, "none", context);
		expect(groups).toHaveLength(1);
		expect(groups[0].tasks).toHaveLength(snapshot.tasks.length);
	});

	it("respects manually collapsed and hidden columns (§8.2)", () => {
		const groups = groupTasks(snapshot.tasks, "status", context, {
			columns: { collapsed: ["done"], hidden: ["canceled"] },
		});
		expect(groups.find((g) => g.key === "done")?.collapsed).toBe(true);
		expect(groups.find((g) => g.key === "canceled")?.hidden).toBe(true);
	});

	it("applies auto-collapse only to empty columns", () => {
		const groups = groupTasks(snapshot.tasks, "status", context, {
			emptyColumnBehavior: "auto-collapse",
		});
		for (const group of groups) {
			expect(group.collapsed).toBe(group.tasks.length === 0);
		}
	});

	it("applies auto-hide only to empty columns", () => {
		const groups = groupTasks(snapshot.tasks, "status", context, {
			emptyColumnBehavior: "auto-hide",
		});
		for (const group of groups) {
			expect(group.hidden).toBe(group.tasks.length === 0);
		}
	});

	it("never un-collapses a column the user collapsed", () => {
		const groups = groupTasks(snapshot.tasks, "status", context, {
			columns: { collapsed: ["in-progress"], hidden: [] },
			emptyColumnBehavior: "show-normal",
		});
		const inProgress = groups.find((g) => g.key === "in-progress");
		expect(inProgress?.tasks.length).toBeGreaterThan(0);
		expect(inProgress?.collapsed).toBe(true);
	});
});

describe("evaluateView", () => {
	it("filters, sorts and groups in one pass", () => {
		const result = evaluateView(snapshot, view({ groupBy: "status" }), context);
		expect(result.total).toBe(result.tasks.length);
		expect(result.filteredOut).toBe(snapshot.tasks.length - result.total);
		expect(result.groups.reduce((n, g) => n + g.tasks.length, 0)).toBe(result.total);
	});

	it("keeps List and Board in agreement about which tasks match", () => {
		const filters = { status: ["todo"] };
		const list = evaluateView(snapshot, view({ viewType: "list", filters }), context);
		const board = evaluateView(snapshot, view({ viewType: "board", filters }), context);
		expect(list.tasks.map((t) => t.id)).toEqual(board.tasks.map((t) => t.id));
	});

	it("separates visible from hidden groups", () => {
		const result = evaluateView(
			snapshot,
			view({ groupBy: "status", columns: { collapsed: [], hidden: ["canceled"] } }),
			context,
		);
		expect(visibleGroups(result).map((g) => g.key)).not.toContain("canceled");
		expect(hiddenGroups(result).map((g) => g.key)).toEqual(["canceled"]);
	});

	it("ships the two permanent views: All Tasks and Inbox", () => {
		const views = defaultViews();
		expect(views.map((v) => v.id)).toEqual(["tasks", "inbox"]);
		expect(views[0].viewType).toBe("list");
		expect(views[0].subtaskDisplay).toBe("flat");
		expect(views[0].filters).toEqual({});
		// Inbox is "untriaged": no project, top-level, open, and unscheduled.
		expect(views[1].filters).toEqual({
			project: [NONE],
			parent: [NONE],
			openOnly: true,
			unscheduled: true,
		});
		expect(views[1].viewType).toBe("list");
	});
});

describe("column state toggles", () => {
	it("toggles collapse on and off without touching hidden", () => {
		const start = view();
		const collapsed = toggleColumnCollapsed(start, "done");
		expect(collapsed.columns.collapsed).toEqual(["done"]);
		expect(collapsed.columns.hidden).toEqual(start.columns.hidden);
		expect(toggleColumnCollapsed(collapsed, "done").columns.collapsed).toEqual([]);
	});

	it("toggles hidden independently", () => {
		const hidden = toggleColumnHidden(view(), "canceled");
		expect(hidden.columns.hidden).toEqual(["canceled"]);
		expect(toggleColumnHidden(hidden, "canceled").columns.hidden).toEqual([]);
	});

	it("returns a new view rather than mutating", () => {
		const start = view();
		toggleColumnCollapsed(start, "done");
		expect(start.columns.collapsed).toEqual([]);
	});

	it("collapses many columns as a union and expands exactly the given keys", () => {
		const start = toggleColumnCollapsed(view(), "queue");
		const all = setColumnsCollapsed(start, ["todo", "done"], true);
		expect(all.columns.collapsed).toEqual(["queue", "todo", "done"]);

		const expanded = setColumnsCollapsed(all, ["todo", "done"], false);
		expect(expanded.columns.collapsed).toEqual(["queue"]);
	});
});

describe("hiddenFields", () => {
	it("defaults to an empty list", () => {
		expect(DEFAULT_DEFINITION.hiddenFields).toEqual([]);
		expect(view().hiddenFields).toEqual([]);
		expect(defaultViews()[0].hiddenFields).toEqual([]);
	});

	it("canonicalises to TASK_FIELDS order and dedupes", () => {
		expect(
			canonicalizeHiddenFields(["labels", "priority", "priority", "type"]),
		).toEqual(["type", "priority", "labels"]);
		expect(canonicalizeHiddenFields(undefined)).toEqual([]);
	});

	it("suppresses the project chip in a view scoped to one project", () => {
		const scoped = view({ filters: { project: ["Projects/Core App"] } });
		expect(renderedHiddenFields(scoped)).toEqual(["project"]);
	});

	it("keeps the project chip when the filter spans several projects", () => {
		const multi = view({
			filters: { project: ["Projects/A", "Projects/B"] },
		});
		expect(renderedHiddenFields(multi)).toEqual([]);
	});

	it("keeps the project chip when nothing filters by project", () => {
		expect(renderedHiddenFields(view({ filters: { status: ["todo"] } }))).toEqual(
			[],
		);
	});

	it("never duplicates a project the user already hid", () => {
		const both = view({
			filters: { project: ["Projects/Core App"] },
			hiddenFields: ["project"],
		});
		expect(renderedHiddenFields(both)).toEqual(["project"]);
	});

	it("leaves the saved view untouched — suppression is render-only", () => {
		const scoped = view({ filters: { project: ["Projects/Core App"] } });
		renderedHiddenFields(scoped);
		expect(scoped.hiddenFields).toEqual([]);
	});

	it("makes view equality insensitive to hidden-field order", () => {
		const a = view({ hiddenFields: ["priority", "labels"] });
		const b = view({ hiddenFields: ["labels", "priority"] });
		expect(definitionsEqual(a, b)).toBe(true);
	});

	it("is carried through viewDefinition and canonicalizeDefinition", () => {
		const v = view({ hiddenFields: ["dueDate", "type"] });
		expect(viewDefinition(v).hiddenFields).toEqual(["dueDate", "type"]);
		expect(canonicalizeDefinition(viewDefinition(v)).hiddenFields).toEqual([
			"type",
			"dueDate",
		]);
	});

	it("keeps every TASK_FIELDS member representable", () => {
		expect(canonicalizeHiddenFields([...TASK_FIELDS])).toEqual([...TASK_FIELDS]);
	});
});

describe("seedFromFilters", () => {
	it("seeds nothing from an empty filter set", () => {
		expect(seedFromFilters({})).toEqual({});
	});

	it("seeds a single-valued filter", () => {
		expect(seedFromFilters({ project: ["Sample/Projects/Core App Experience"] })).toEqual({
			project: "Sample/Projects/Core App Experience",
		});
		expect(seedFromFilters({ status: ["todo"] })).toEqual({ status: "todo" });
		expect(seedFromFilters({ taskType: ["bug"] })).toEqual({ taskType: "bug" });
	});

	it("applies every concrete label (multi-select, additive)", () => {
		expect(seedFromFilters({ labels: ["design", "frontend"] })).toEqual({
			labels: ["design", "frontend"],
		});
	});

	it("skips a filter that ORs several values — no single right answer", () => {
		expect(seedFromFilters({ status: ["todo", "in-progress"] })).toEqual({});
	});

	it("ignores the NONE sentinel", () => {
		expect(seedFromFilters({ assignee: [NONE], labels: [NONE] })).toEqual({});
	});

	it("resolves `self` for assignee against the isSelf person", () => {
		expect(seedFromFilters({ assignee: [SELF] }, context)).toEqual({
			assignee: "alice",
		});
	});

	it("drops `self` for assignee when no one is flagged isSelf", () => {
		expect(seedFromFilters({ assignee: [SELF] })).toEqual({});
	});

	it("lets a parent filter win over a project filter (single primary parent)", () => {
		expect(
			seedFromFilters({
				parent: ["Sample/Tasks/SMP-0101"],
				project: ["Sample/Projects/Core App Experience"],
			}),
		).toEqual({ parent: "Sample/Tasks/SMP-0101" });
	});

	it("ignores filters that don't map to a task field", () => {
		expect(
			seedFromFilters({ text: "abc", archived: "included" }),
		).toEqual({});
	});
});
