import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { createTaxonomy } from "../../src/core/taxonomy";
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
	isSystemViewId,
	matchesFilters,
	nextTableSort,
	snapshotContext,
	sortTasks,
	sortTasksMulti,
	setColumnsCollapsed,
	toggleColumnCollapsed,
	toggleColumnHidden,
	viewContext,
	viewDefinition,
	visibleGroups,
} from "../../src/core/views";
import type { HierarchyScope } from "../../src/core/hierarchy";
import {
	NONE,
	SELF,
	TASK_FIELDS,
	emptyRelations,
	type RecurrenceConfig,
	type SavedView,
	type Task,
} from "../../src/core/types";

const snapshot = sampleSnapshot();
const context = snapshotContext(snapshot, "alice");
const anonymousContext = snapshotContext(snapshot, null);
const view = (partial: Partial<SavedView> = {}): SavedView => ({
	...newView("test", "Test", "board"),
	...partial,
});

function task(overrides: Partial<Task> & { path: string }): Task {
	return {
		type: "vertex-flow-task",
		id: overrides.path,
		title: "t",
		taskType: null,
		status: "queue",
		priority: null,
		rank: "0|i00000:",
		project: null,
		parent: null,
		recurringFrom: null,
		assignee: null,
		estimate: null,
		labels: [],
		startDate: null,
		dueDate: null,
		recurrence: null,
		archived: false,
		archivedAt: null,
		relations: emptyRelations(),
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		completedAt: null,
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

	it("recurring keeps only tasks carrying a live recurrence", () => {
		const recurrence = (
			freq: RecurrenceConfig["freq"],
			nextDate = "2026-09-01",
		): RecurrenceConfig => ({
			trigger: "on-close",
			triggerStatus: null,
			freq,
			interval: 1,
			weekdays: [],
			dayOfMonth: null,
			weekdayOfMonth: null,
			monthOfYear: null,
			anchor: "dueDate",
			newStatus: null,
			endsAfter: null,
			endsOn: null,
			nextDate,
			copyFields: null,
		});
		const tasks = [
			task({ path: "A" }),
			task({ path: "B", recurrence: recurrence("weekly") }),
			task({ path: "C", recurrence: recurrence("weekly") }),
			task({ path: "D", recurringFrom: "A", recurrence: recurrence("daily") }),
		];
		expect(applyFilters(tasks, { recurring: true }, context).map((t) => t.id)).toEqual([
			"B",
			"C",
			"D",
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

	it("resolves `self` against the mePerson (§7.6)", () => {
		const mine = applyFilters(snapshot.tasks, { assignee: [SELF] }, context);
		expect(mine.length).toBeGreaterThan(0);
		expect(mine.every((t) => t.assignee === "alice")).toBe(true);
	});

	it("matches nothing for `self` when no mePerson is configured", () => {
		// Honest beats convenient: "Assigned to Me" with no `me` configured must
		// not silently degrade into "All Tasks".
		expect(applyFilters(snapshot.tasks, { assignee: [SELF] }, anonymousContext)).toEqual([]);
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

	describe("group-wildcard filters (label:*/project:*)", () => {
		// Local fixture layering `/`-nested labels and a project onto the base
		// context — not added to the shared sample-workspace fixture.
		const groupContext: typeof context = {
			...context,
			taxonomies: {
				...context.taxonomies,
				label: createTaxonomy("label", [
					{ id: "labelA", name: "LabelA", color: "#111111" },
					{ id: "labelACD", name: "LabelA/C/D", color: "#333333" },
				]),
			},
			titles: new Map([
				...(context.titles ?? []),
				["Projects/Application" as const, "Application"],
				["Projects/Application-UI-Forms" as const, "Application/UI/Forms"],
			]),
		};

		it("matches a nested label at any depth under the group, not a bare sibling", () => {
			const nested = task({ path: "A", labels: ["labelACD"] });
			const bare = task({ path: "B", labels: ["labelA"] });

			for (const pattern of ["LabelA/*", "LabelA/C/*"]) {
				expect(
					matchesFilters(nested, { labels: [pattern] }, groupContext),
				).toBe(true);
				expect(
					matchesFilters(bare, { labels: [pattern] }, groupContext),
				).toBe(false);
			}
		});

		it("matches a nested project at any depth under the group, not a bare sibling", () => {
			const nested = task({ path: "A", project: "Projects/Application-UI-Forms" });
			const bare = task({ path: "B", project: "Projects/Application" });

			for (const pattern of ["Application/*", "Application/UI/*"]) {
				expect(
					matchesFilters(nested, { project: [pattern] }, groupContext),
				).toBe(true);
				expect(
					matchesFilters(bare, { project: [pattern] }, groupContext),
				).toBe(false);
			}
		});

		it("keeps NONE handling unchanged when mixed with a group pattern", () => {
			const unlabeled = task({ path: "A", labels: [] });
			const noProject = task({ path: "B", project: null });

			expect(
				matchesFilters(unlabeled, { labels: [NONE, "LabelA/*"] }, groupContext),
			).toBe(true);
			expect(
				matchesFilters(noProject, { project: [NONE, "Application/*"] }, groupContext),
			).toBe(true);

			const labeled = task({ path: "C", labels: ["labelACD"] });
			expect(
				matchesFilters(labeled, { labels: [NONE] }, groupContext),
			).toBe(false);
		});

		it("ORs an exact id/path with a group pattern in the same filter array", () => {
			const bareLabelA = task({ path: "A", labels: ["labelA"] });
			const nestedLabel = task({ path: "B", labels: ["labelACD"] });
			const unrelated = task({ path: "C", labels: [] });

			for (const t of [bareLabelA, nestedLabel]) {
				expect(
					matchesFilters(t, { labels: ["labelA", "LabelA/*"] }, groupContext),
				).toBe(true);
			}
			expect(
				matchesFilters(unrelated, { labels: ["labelA", "LabelA/*"] }, groupContext),
			).toBe(false);

			const bareProject = task({ path: "D", project: "Projects/Application" });
			const nestedProject = task({
				path: "E",
				project: "Projects/Application-UI-Forms",
			});
			for (const t of [bareProject, nestedProject]) {
				expect(
					matchesFilters(
						t,
						{ project: ["Projects/Application", "Application/*"] },
						groupContext,
					),
				).toBe(true);
			}
		});
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

describe("root: filter scope", () => {
	// A flat "Release epic" structure: no parent/child links, connected only
	// via Blocks/Blocked By, plus a separate hierarchy-only branch and a
	// related-only decoy that must never be pulled into scope.
	const release = task({
		path: "release",
		relations: { ...emptyRelations(), blocks: ["featureA"] },
	});
	const featureA = task({
		path: "featureA",
		relations: { ...emptyRelations(), blockedBy: ["release"], blocks: ["bugB"] },
	});
	const bugB = task({
		path: "bugB",
		relations: { ...emptyRelations(), blockedBy: ["featureA"] },
	});
	const child = task({ path: "child", parent: "release" });
	const grandchild = task({ path: "grandchild", parent: "child" });
	const relatedOnly = task({
		path: "relatedOnly",
		relations: { ...emptyRelations(), related: ["release"] },
	});
	const unrelated = task({ path: "unrelated" });

	const scope: HierarchyScope = {
		tasks: [release, featureA, bugB, child, grandchild, relatedOnly, unrelated],
		projects: [],
	};
	const rootContext: typeof context = { ...context, scope };

	it("returns the root plus everything transitively reachable via hierarchy + blocks/blockedBy", () => {
		const result = applyFilters(scope.tasks, { root: ["release"] }, rootContext);
		expect(result.map((t) => t.path).sort()).toEqual(
			["bugB", "child", "featureA", "grandchild", "release"].sort(),
		);
	});

	it("excludes related-only tasks from the scope", () => {
		const result = applyFilters(scope.tasks, { root: ["release"] }, rootContext);
		expect(result.map((t) => t.path)).not.toContain("relatedOnly");
	});

	it("AND's normally with other filters", () => {
		const result = applyFilters(
			scope.tasks,
			{ root: ["release"], status: ["done"] },
			rootContext,
		);
		expect(result).toEqual([]);
	});

	it("returns just the root when it has no children or relations", () => {
		const result = applyFilters(scope.tasks, { root: ["unrelated"] }, rootContext);
		expect(result.map((t) => t.path)).toEqual(["unrelated"]);
	});

	it("-root: removes the root and its whole scope, composing with unrelated filters", () => {
		const result = applyFilters(
			scope.tasks,
			{ excludeRoot: ["release"] },
			rootContext,
		);
		expect(result.map((t) => t.path).sort()).toEqual(["relatedOnly", "unrelated"].sort());
	});

	it("unions scopes across multiple roots", () => {
		const isolatedRoot = task({ path: "isolatedRoot" });
		const isolatedChild = task({ path: "isolatedChild", parent: "isolatedRoot" });
		const multiScope: HierarchyScope = {
			tasks: [...scope.tasks, isolatedRoot, isolatedChild],
			projects: [],
		};
		const multiContext: typeof context = { ...context, scope: multiScope };
		const result = applyFilters(
			multiScope.tasks,
			{ root: ["release", "isolatedRoot"] },
			multiContext,
		);
		expect(result.map((t) => t.path).sort()).toEqual(
			["bugB", "child", "featureA", "grandchild", "release", "isolatedRoot", "isolatedChild"].sort(),
		);
	});

	it("is a no-op when the context has no scope", () => {
		const bareContext = viewContext(snapshot.workspace, "alice");
		expect(bareContext.scope).toBeUndefined();
		const result = applyFilters(scope.tasks, { root: ["release"] }, bareContext);
		expect(result).toEqual(scope.tasks);
	});
});

describe("date field filtering", () => {
	it("matches an exact due date", () => {
		const due = task({ path: "a", dueDate: "2026-09-19" });
		const other = task({ path: "b", dueDate: "2026-09-20" });
		expect(matchesFilters(due, { dueDate: ["2026-09-19"] }, context)).toBe(true);
		expect(matchesFilters(other, { dueDate: ["2026-09-19"] }, context)).toBe(false);
	});

	it("truncates a full timestamp to its day for exact match", () => {
		const t = task({
			path: "a",
			createdAt: "2026-09-19T22:10:00Z",
			updatedAt: "2026-09-19T22:10:00Z",
			completedAt: "2026-09-19T22:10:00Z",
		});
		expect(matchesFilters(t, { createdAt: ["2026-09-19"] }, context)).toBe(true);
		expect(matchesFilters(t, { updatedAt: ["2026-09-19"] }, context)).toBe(true);
		expect(matchesFilters(t, { completedAt: ["2026-09-19"] }, context)).toBe(true);
	});

	it("matches unset against a task with no value", () => {
		const undated = task({ path: "a" });
		const dated = task({ path: "b", dueDate: "2026-09-19" });
		expect(matchesFilters(undated, { dueDate: [NONE] }, context)).toBe(true);
		expect(matchesFilters(dated, { dueDate: [NONE] }, context)).toBe(false);
	});

	it("excludes the boundary day from a before/after range (exclusive)", () => {
		const onBefore = task({ path: "a", dueDate: "2026-09-01" });
		const onAfter = task({ path: "b", dueDate: "2026-10-01" });
		const inside = task({ path: "c", dueDate: "2026-09-15" });
		const filters = { dueDateBefore: "2026-10-01", dueDateAfter: "2026-09-01" };
		expect(matchesFilters(onBefore, filters, context)).toBe(false);
		expect(matchesFilters(onAfter, filters, context)).toBe(false);
		expect(matchesFilters(inside, filters, context)).toBe(true);
	});

	it("never matches a range bound against an absent value", () => {
		const undated = task({ path: "a" });
		expect(
			matchesFilters(undated, { dueDateAfter: "2026-01-01" }, context),
		).toBe(false);
	});

	it("day-truncates before/after bounds against a full timestamp", () => {
		const t = task({ path: "a", createdAt: "2026-09-19T22:10:00Z" });
		expect(
			matchesFilters(t, { createdAtAfter: "2026-09-18" }, context),
		).toBe(true);
		expect(
			matchesFilters(t, { createdAtBefore: "2026-09-20" }, context),
		).toBe(true);
		expect(
			matchesFilters(t, { createdAtAfter: "2026-09-19" }, context),
		).toBe(false);
	});

	it("treats a date filter as non-empty", () => {
		expect(isEmptyFilterSet({ dueDate: ["2026-09-19"] })).toBe(false);
		expect(isEmptyFilterSet({ dueDateBefore: "2026-09-19" })).toBe(false);
	});
});

describe("exclusion filters", () => {
	it("excludes a task by excludeStatus even when it also satisfies status", () => {
		const t = task({ path: "a", status: "done" });
		expect(
			matchesFilters(t, { status: ["done"], excludeStatus: ["done"] }, context),
		).toBe(false);
	});

	it("excludeAssignee with unset excludes unassigned tasks", () => {
		const unassigned = task({ path: "a", assignee: null });
		const assigned = task({ path: "b", assignee: "alice" });
		expect(
			matchesFilters(unassigned, { excludeAssignee: [NONE] }, context),
		).toBe(false);
		expect(
			matchesFilters(assigned, { excludeAssignee: [NONE] }, context),
		).toBe(true);
		expect(
			matchesFilters(assigned, { excludeAssignee: ["alice"] }, context),
		).toBe(false);
	});

	it("excludeLabels honours group-wildcard patterns like the include side", () => {
		const groupContext: typeof context = {
			...context,
			taxonomies: {
				...context.taxonomies,
				label: createTaxonomy("label", [
					{ id: "labelA", name: "LabelA", color: "#111111" },
					{ id: "labelACD", name: "LabelA/C/D", color: "#333333" },
				]),
			},
		};
		const nested = task({ path: "a", labels: ["labelACD"] });
		const bare = task({ path: "b", labels: [] });
		expect(
			matchesFilters(nested, { excludeLabels: ["LabelA/*"] }, groupContext),
		).toBe(false);
		expect(
			matchesFilters(bare, { excludeLabels: ["LabelA/*"] }, groupContext),
		).toBe(true);
	});

	it("treats an exclude-only filter set as non-empty", () => {
		expect(isEmptyFilterSet({ excludeStatus: ["done"] })).toBe(false);
		expect(isEmptyFilterSet({ excludeParent: ["a"] })).toBe(false);
	});

	it("keeps include and exclude independent, not complementary", () => {
		// status:todo,in-progress -status:blocked — vacuous but harmless.
		const t = task({ path: "a", status: "todo" });
		expect(
			matchesFilters(
				t,
				{ status: ["todo", "in-progress"], excludeStatus: ["blocked"] },
				context,
			),
		).toBe(true);
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

describe("sorting — new Table-only fields", () => {
	it("taskType orders by taxonomy order, unset last", () => {
		// Task Type is an unordered taxonomy by default (no `order` on the
		// sample workspace's values), so this builds a local taxonomy that
		// carries explicit orders to exercise `taxonomyOrder`.
		const typeContext: typeof context = {
			...context,
			taxonomies: {
				...context.taxonomies,
				taskType: createTaxonomy("taskType", [
					{ id: "bug", name: "Bug", color: "#ef4444", order: 1 },
					{ id: "feature", name: "Feature", color: "#3b82f6", order: 2 },
				]),
			},
		};
		const tasks = [
			task({ path: "unset", taskType: null }),
			task({ path: "feature", taskType: "feature" }),
			task({ path: "bug", taskType: "bug" }),
		];
		// Only ascending is asserted here: `taskType` reuses the same
		// `taxonomyOrder` + `nullSkewed: false` shape `status`/`priority`
		// already use, and that shape does not keep unset values pinned last
		// under a flipped (`desc`) direction — the same is true for
		// `priority` today (untested there too). Out of scope for this
		// change to alter; see the PR notes.
		expect(
			sortTasks(tasks, "taskType", "asc", typeContext).map((t) => t.path),
		).toEqual(["bug", "feature", "unset"]);
	});

	it("project orders by resolved title, not path", () => {
		// The path order is deliberately the opposite of the title order, so
		// a test that accidentally sorted by path would fail.
		const projectContext: typeof context = {
			...context,
			titles: new Map([
				["Projects/ZPath" as const, "Alpha Project"],
				["Projects/APath" as const, "Zulu Project"],
			]),
		};
		const tasks = [
			task({ path: "unset", project: null }),
			task({ path: "zulu", project: "Projects/APath" }),
			task({ path: "alpha", project: "Projects/ZPath" }),
		];
		expect(
			sortTasks(tasks, "project", "asc", projectContext).map((t) => t.path),
		).toEqual(["alpha", "zulu", "unset"]);
		expect(
			sortTasks(tasks, "project", "desc", projectContext).map((t) => t.path),
		).toEqual(["zulu", "alpha", "unset"]);
	});

	it("assignee orders by person name, not id, unassigned last", () => {
		// "zed"'s name ("Aaron") sorts before "alice"'s ("Alice") even though
		// the id order is the reverse — proves it's comparing names.
		const peopleContext: typeof context = {
			...context,
			people: [...context.people, { id: "zed", name: "Aaron" }],
		};
		const tasks = [
			task({ path: "unassigned", assignee: null }),
			task({ path: "alice", assignee: "alice" }),
			task({ path: "zed", assignee: "zed" }),
		];
		expect(
			sortTasks(tasks, "assignee", "asc", peopleContext).map((t) => t.path),
		).toEqual(["zed", "alice", "unassigned"]);
		expect(
			sortTasks(tasks, "assignee", "desc", peopleContext).map((t) => t.path),
		).toEqual(["alice", "zed", "unassigned"]);
	});

	it("labels orders by the task's first label in taxonomy order, unlabelled last", () => {
		const labelContext: typeof context = {
			...context,
			taxonomies: {
				...context.taxonomies,
				label: createTaxonomy("label", [
					{ id: "first", name: "First", color: "#111111", order: 1 },
					{ id: "second", name: "Second", color: "#222222", order: 2 },
				]),
			},
		};
		const tasks = [
			task({ path: "unlabelled", labels: [] }),
			// This task's *first* label is the higher-order one, so it should
			// sort as if positioned by "first", not by any label it carries.
			task({ path: "hasFirst", labels: ["second", "first"] }),
			task({ path: "hasSecondOnly", labels: ["second"] }),
		];
		expect(
			sortTasks(tasks, "labels", "asc", labelContext).map((t) => t.path),
		).toEqual(["hasFirst", "hasSecondOnly", "unlabelled"]);
	});

	it("progress orders by completed/total ratio, no sub-tasks sorts last", () => {
		const parentHalf = task({ path: "parentHalf" });
		const childHalfDone = task({
			path: "childHalfDone",
			parent: "parentHalf",
			status: "done",
		});
		const childHalfTodo = task({
			path: "childHalfTodo",
			parent: "parentHalf",
			status: "todo",
		});
		const parentFull = task({ path: "parentFull" });
		const childFullDone = task({
			path: "childFullDone",
			parent: "parentFull",
			status: "done",
		});
		const parentNone = task({ path: "parentNone" });

		const scope: HierarchyScope = {
			tasks: [
				parentHalf,
				childHalfDone,
				childHalfTodo,
				parentFull,
				childFullDone,
				parentNone,
			],
			projects: [],
		};
		const progressContext: typeof context = { ...context, scope };
		const parents = [parentNone, parentHalf, parentFull];

		expect(
			sortTasks(parents, "progress", "asc", progressContext).map((t) => t.path),
		).toEqual(["parentHalf", "parentFull", "parentNone"]);
		expect(
			sortTasks(parents, "progress", "desc", progressContext).map((t) => t.path),
		).toEqual(["parentFull", "parentHalf", "parentNone"]);
	});

	it("progress treats every task as unset when the context has no scope (viewContext())", () => {
		const bareContext = viewContext(snapshot.workspace, "alice");
		expect(bareContext.scope).toBeUndefined();

		const tasks = [
			task({ path: "b", rank: "0|i00002:" }),
			task({ path: "a", rank: "0|i00001:" }),
		];
		// No scope => every task compares as unset => falls straight through
		// to the rank tiebreak, same as a fully-tied sort.
		expect(
			sortTasks(tasks, "progress", "asc", bareContext).map((t) => t.path),
		).toEqual(["a", "b"]);
	});

	it("relations orders by count, zero is a real value (not null-skewed)", () => {
		const zero = task({ path: "zero" });
		const one = task({
			path: "one",
			relations: { blocks: ["x"], blockedBy: [], related: [], duplicateOf: null },
		});
		// `duplicateOf` counts too.
		const two = task({
			path: "two",
			relations: { blocks: ["x"], blockedBy: [], related: [], duplicateOf: "y" },
		});

		expect(
			sortTasks([zero, one, two], "relations", "asc", context).map((t) => t.path),
		).toEqual(["zero", "one", "two"]);
		// Descending puts the highest count first and zero last — proving
		// zero isn't treated as an absence that always sorts last regardless
		// of direction.
		expect(
			sortTasks([zero, one, two], "relations", "desc", context).map((t) => t.path),
		).toEqual(["two", "one", "zero"]);
	});
});

describe("sortTasksMulti (Table)", () => {
	it("breaks a tied primary key with the secondary key", () => {
		const tasks = [
			task({ path: "a", priority: "high", dueDate: "2026-01-02" }),
			task({ path: "b", priority: "high", dueDate: "2026-01-01" }),
			task({ path: "c", priority: "low", dueDate: "2026-01-01" }),
		];
		const sorted = sortTasksMulti(
			tasks,
			[
				{ field: "priority", direction: "asc" },
				{ field: "dueDate", direction: "asc" },
			],
			context,
		);
		expect(sorted.map((t) => t.path)).toEqual(["b", "a", "c"]);
	});

	it("falls back to rank when every key is fully tied", () => {
		const tasks = [
			task({ path: "b", priority: "high", rank: "0|i00002:" }),
			task({ path: "a", priority: "high", rank: "0|i00001:" }),
		];
		const sorted = sortTasksMulti(
			tasks,
			[{ field: "priority", direction: "asc" }],
			context,
		);
		expect(sorted.map((t) => t.path)).toEqual(["a", "b"]);
	});

	it("applies direction per key independently", () => {
		const tasks = [
			task({ path: "a", priority: "high", dueDate: "2026-01-02" }),
			task({ path: "b", priority: "high", dueDate: "2026-01-01" }),
			task({ path: "c", priority: "low", dueDate: "2026-01-03" }),
		];
		const sorted = sortTasksMulti(
			tasks,
			[
				{ field: "priority", direction: "asc" },
				{ field: "dueDate", direction: "desc" },
			],
			context,
		);
		expect(sorted.map((t) => t.path)).toEqual(["a", "b", "c"]);
	});
});

describe("nextTableSort (Table column header click cycle)", () => {
	it("plain click on a fresh column sets it as the sole ascending key", () => {
		expect(nextTableSort([], "priority", false)).toEqual([
			{ field: "priority", direction: "asc" },
		]);
	});

	it("plain click replaces the whole sort, not just adds", () => {
		expect(
			nextTableSort(
				[
					{ field: "status", direction: "asc" },
					{ field: "priority", direction: "asc" },
				],
				"dueDate",
				false,
			),
		).toEqual([{ field: "dueDate", direction: "asc" }]);
	});

	it("plain click on the sole active ascending key flips it to descending", () => {
		expect(
			nextTableSort([{ field: "priority", direction: "asc" }], "priority", false),
		).toEqual([{ field: "priority", direction: "desc" }]);
	});

	it("a third plain click on the sole active key clears the sort", () => {
		expect(
			nextTableSort([{ field: "priority", direction: "desc" }], "priority", false),
		).toEqual([]);
	});

	it("shift-click appends a new key to the end without disturbing the rest", () => {
		expect(
			nextTableSort([{ field: "status", direction: "asc" }], "priority", true),
		).toEqual([
			{ field: "status", direction: "asc" },
			{ field: "priority", direction: "asc" },
		]);
	});

	it("shift-click on an existing key flips its direction in place", () => {
		expect(
			nextTableSort(
				[
					{ field: "status", direction: "asc" },
					{ field: "priority", direction: "asc" },
				],
				"priority",
				true,
			),
		).toEqual([
			{ field: "status", direction: "asc" },
			{ field: "priority", direction: "desc" },
		]);
	});
});

describe("grouping", () => {
	it("emits a column for every status, even empty ones", () => {
		const groups = groupTasks([], "status", context);
		// The sample-workspace fixture's status set — two `started` statuses
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

	it("ships the two System Views: All Tasks and Untriaged", () => {
		const views = defaultViews();
		expect(views.map((v) => v.id)).toEqual(["tasks", "untriaged"]);
		expect(views[0].viewType).toBe("list");
		expect(views[0].subtaskDisplay).toBe("flat");
		expect(views[0].filters).toEqual({});
		// Untriaged: no project, top-level, open, and unscheduled.
		expect(views[1].filters).toEqual({
			project: [NONE],
			parent: [NONE],
			openOnly: true,
			unscheduled: true,
		});
		expect(views[1].viewType).toBe("list");
	});

	it("isSystemViewId recognises both System View ids and nothing else", () => {
		expect(isSystemViewId("tasks")).toBe(true);
		expect(isSystemViewId("untriaged")).toBe(true);
		// The pre-rename id is deliberately not treated as a System View id here —
		// migration recognises it separately so it can be dropped.
		expect(isSystemViewId("inbox")).toBe(false);
		expect(isSystemViewId("my-custom-view")).toBe(false);
	});

	it("defaultViews carry the view discriminant", () => {
		for (const v of defaultViews()) expect(v.type).toBe("vertex-flow-view");
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

	it("resolves `self` for assignee against the mePerson", () => {
		expect(seedFromFilters({ assignee: [SELF] }, context)).toEqual({
			assignee: "alice",
		});
	});

	it("drops `self` for assignee when no mePerson is configured", () => {
		expect(seedFromFilters({ assignee: [SELF] }, anonymousContext)).toEqual({});
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
