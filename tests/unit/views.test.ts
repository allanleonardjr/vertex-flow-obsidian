import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/sample/generate";
import {
	applyFilters,
	canonicalizeDefinition,
	canonicalizeHiddenFields,
	DEFAULT_DEFINITION,
	defaultViews,
	definitionsEqual,
	newView,
	evaluateView,
	groupTasks,
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
	it("hides archived tasks by default (§7.7)", () => {
		const all = applyFilters(snapshot.tasks, {}, context);
		expect(all.some((t) => t.archived)).toBe(false);

		const withArchived = applyFilters(snapshot.tasks, { includeArchived: true }, context);
		expect(withArchived.some((t) => t.archived)).toBe(true);
		expect(withArchived.length).toBe(all.length + 1);
	});

	it("ORs within one filter and ANDs across filters", () => {
		const result = applyFilters(
			snapshot.tasks,
			{ status: ["todo", "in-progress"], taskType: ["bug"] },
			context,
		);
		expect(result.map((t) => t.id)).toEqual(["SMP-0104"]);
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
		expect(result.map((t) => t.id).sort()).toEqual(["SMP-0106", "SMP-0107"]);
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

	it("hides sub-tasks with topLevelOnly", () => {
		const top = applyFilters(snapshot.tasks, { topLevelOnly: true }, context);
		expect(top.every((t) => t.parent === null)).toBe(true);
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
		expect(isEmptyFilterSet({ includeArchived: true })).toBe(true);
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
		expect(groups.map((g) => g.key)).toEqual([
			"queue",
			"todo",
			"in-progress",
			"done",
			"canceled",
		]);
		expect(groups.every((g) => g.tasks.length === 0)).toBe(true);
	});

	it("carries the taxonomy's colour and name onto the column", () => {
		const [queue] = groupTasks([], "status", context);
		expect(queue.label).toBe("Queue");
		expect(queue.color).toBe("#94a3b8");
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

	it("ships a single built-in view", () => {
		const views = defaultViews();
		expect(views.map((v) => v.id)).toEqual(["tasks"]);
		expect(views[0].viewType).toBe("list");
		expect(views[0].filters.topLevelOnly).toBe(true);
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
