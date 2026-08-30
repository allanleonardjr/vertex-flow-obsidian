import { describe, expect, it } from "vitest";
import {
	describePersonUsage,
	findPersonUsage,
	mergeCommentCounts,
	planPersonDeletion,
} from "../../src/core/people";
import type { Person } from "../../src/core/types";
import { project, task } from "./fixtures";

const people: Person[] = [
	{ id: "alice", name: "Alice", isSelf: true },
	{ id: "bob", name: "Bob" },
	{ id: "carol", name: "Carol" },
];

describe("findPersonUsage", () => {
	it("reports zero for a person referenced nowhere", () => {
		const usage = findPersonUsage("carol", {
			tasks: [task({ assignee: "alice" }), task({ assignee: "bob" })],
			projects: [project({ owner: "alice" })],
			commentCount: 0,
		});
		expect(usage.count).toBe(0);
		expect(usage.assigneeTaskPaths).toEqual([]);
		expect(usage.ownerProjectPaths).toEqual([]);
	});

	it("counts assignee tasks and owned projects, but not mentions/comments", () => {
		const usage = findPersonUsage("alice", {
			tasks: [
				task({ path: "W/Tasks/A", assignee: "alice" }),
				task({ path: "W/Tasks/B", assignee: "bob", mentions: ["alice"] }),
				task({ path: "W/Tasks/C", assignee: "alice" }),
			],
			projects: [
				project({ path: "W/Projects/P1", owner: "alice" }),
				project({ path: "W/Projects/P2", owner: "bob" }),
			],
			commentCount: 9,
		});

		expect(usage.assigneeTaskPaths).toEqual(["W/Tasks/A", "W/Tasks/C"]);
		expect(usage.ownerProjectPaths).toEqual(["W/Projects/P1"]);
		expect(usage.mentionTaskPaths).toEqual(["W/Tasks/B"]);
		expect(usage.commentCount).toBe(9);
		// Mentions and comments never inflate the blocking count.
		expect(usage.count).toBe(3);
	});
});

describe("describePersonUsage", () => {
	const zero = { assigneeTaskPaths: [], ownerProjectPaths: [] };
	it("summarises task/project usage in prose", () => {
		expect(
			describePersonUsage({
				...zero,
				count: 1,
				assigneeTaskPaths: ["a"],
				commentCount: 0,
				mentionTaskPaths: [],
			}),
		).toBe("1 task");
		expect(
			describePersonUsage({
				count: 3,
				assigneeTaskPaths: ["a", "b"],
				ownerProjectPaths: ["p"],
				commentCount: 4,
				mentionTaskPaths: ["m"],
			}),
		).toBe("2 tasks and 1 project");
		expect(
			describePersonUsage({
				...zero,
				count: 0,
				commentCount: 5,
				mentionTaskPaths: ["m"],
			}),
		).toBe("nothing");
	});
});

describe("planPersonDeletion", () => {
	const usage = findPersonUsage("bob", {
		tasks: [task({ assignee: "bob" })],
		projects: [],
		commentCount: 0,
	});

	it("offers every other person as a replacement candidate", () => {
		const plan = planPersonDeletion(people[1], people, usage);
		expect(plan.personId).toBe("bob");
		expect(plan.replacementCandidates.map((p) => p.id)).toEqual([
			"alice",
			"carol",
		]);
	});

	it("has no replacement candidates when the person is the only one", () => {
		const plan = planPersonDeletion(people[1], [people[1]], usage);
		expect(plan.replacementCandidates).toEqual([]);
	});
});

describe("mergeCommentCounts", () => {
	it("sums per-note tallies keyed by author across many notes", () => {
		expect(
			mergeCommentCounts([
				{ alice: 2, bob: 1 },
				{ alice: 1 },
				{},
				{ carol: 3, bob: 2 },
			]),
		).toEqual({ alice: 3, bob: 3, carol: 3 });
	});

	it("returns an empty map for no tallies", () => {
		expect(mergeCommentCounts([])).toEqual({});
	});
});
