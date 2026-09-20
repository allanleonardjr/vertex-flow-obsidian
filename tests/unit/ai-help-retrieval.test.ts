import { describe, expect, it } from "vitest";
import { flattenHelpTopics, matchHelpTopic, scoreHelpTopic } from "../../src/core/ai/help-retrieval";
import type { HelpTopic } from "../../src/core/help";
import { HELP_TOPICS } from "../../src/core/help";

describe("flattenHelpTopics", () => {
	it("keeps leaf topics and content-bearing categories, depth-first", () => {
		const tree: HelpTopic[] = [
			{
				id: "concepts",
				title: "Concepts",
				content: "The mental model behind the app.",
				children: [
					{ id: "concepts-projects", title: "Projects", content: "Projects hold tasks." },
					{ id: "concepts-empty", title: "Empty", content: "" },
				],
			},
			{ id: "faq", title: "FAQ", content: "Frequently asked questions." },
		];

		expect(flattenHelpTopics(tree).map((t) => t.id)).toEqual([
			"concepts",
			"concepts-projects",
			"faq",
		]);
	});

	it("drops a category with no content of its own, keeping its children", () => {
		const tree: HelpTopic[] = [
			{
				id: "layouts",
				title: "Layouts",
				children: [{ id: "layouts-board", title: "Board", content: "Drag cards between columns." }],
			},
		];

		expect(flattenHelpTopics(tree).map((t) => t.id)).toEqual(["layouts-board"]);
	});

	it("drops a topic whose content is empty or whitespace-only", () => {
		const tree: HelpTopic[] = [
			{ id: "blank", title: "Blank", content: "   \n  " },
			{ id: "real", title: "Real", content: "Something real." },
		];

		expect(flattenHelpTopics(tree).map((t) => t.id)).toEqual(["real"]);
	});
});

describe("scoreHelpTopic", () => {
	it("weights a title hit higher than a body-only hit", () => {
		const titleMatch: HelpTopic = { id: "a", title: "Saved Views", content: "Reusable filter bundles." };
		const bodyOnlyMatch: HelpTopic = {
			id: "b",
			title: "Something else entirely",
			content: "This mentions views once, in passing.",
		};

		expect(scoreHelpTopic("what is a saved view?", titleMatch)).toBeGreaterThan(
			scoreHelpTopic("what is a saved view?", bodyOnlyMatch),
		);
	});

	it("folds simple plurals so a singular query still hits a pluralized title", () => {
		const topic: HelpTopic = { id: "p", title: "Projects", content: "A project holds tasks." };
		expect(scoreHelpTopic("how do I create a new project?", topic)).toBeGreaterThan(0);
	});

	it("is 0 for a query sharing no terms with the topic", () => {
		const topic: HelpTopic = { id: "p", title: "Projects", content: "A project holds tasks." };
		expect(scoreHelpTopic("thanks so much!", topic)).toBe(0);
	});

	it("doesn't let a much longer topic win purely by repeating common words more times", () => {
		const short: HelpTopic = { id: "short", title: "Overdue tasks", content: "A task is overdue past its due date." };
		const long: HelpTopic = {
			id: "long",
			title: "Changelog",
			content: Array(200).fill("task task task date date fixed added new").join(" "),
		};

		expect(scoreHelpTopic("what makes a task overdue?", short)).toBeGreaterThan(
			scoreHelpTopic("what makes a task overdue?", long),
		);
	});
});

describe("matchHelpTopic", () => {
	const topics: HelpTopic[] = [
		{ id: "concepts-projects", title: "Projects", content: "A Project holds Tasks. Project names are unique within a workspace." },
		{ id: "concepts-tasks", title: "Tasks", content: "A Task is the unit of work. Tasks can have sub-tasks, labels, and an assignee." },
		{ id: "views-saved-views", title: "Saved Views", content: "A Saved View bundles a filter, sort, and grouping into one reusable, named view." },
		{ id: "layouts-board-layout", title: "Board layout", content: "The Board lays tasks out as cards in status columns, drag-and-drop between them." },
	];

	it("matches a clear, on-topic question to the relevant topic", () => {
		expect(matchHelpTopic("how do I create a new project?", topics)?.id).toBe("concepts-projects");
		expect(matchHelpTopic("what is a saved view?", topics)?.id).toBe("views-saved-views");
	});

	it("returns null for a question with no real overlap (small talk)", () => {
		expect(matchHelpTopic("thanks, that's all for now!", topics)).toBeNull();
		expect(matchHelpTopic("how's it going today?", topics)).toBeNull();
	});

	it("returns null on an ambiguous tie between two topics that both clear the threshold", () => {
		// Both name "assignee" in their own title, so both score identically
		// above the relevance threshold — a genuine tie, not a weak match.
		const tied: HelpTopic[] = [
			{ id: "one", title: "Assignee basics", content: "Every task has one assignee." },
			{ id: "two", title: "Assignee rules", content: "The assignee must be a registered person." },
		];
		expect(matchHelpTopic("who is the assignee?", tied)).toBeNull();
	});

	it("doesn't spuriously match a workspace-data question to an unrelated help topic", () => {
		// "overdue" isn't a word any of these topics use — a data question about
		// the user's own tasks shouldn't get help-doc content injected.
		expect(matchHelpTopic("what's overdue?", topics)).toBeNull();
	});
});

describe("matchHelpTopic against the real bundled Help content", () => {
	it("matches a clear how-to question about a real topic", () => {
		const match = matchHelpTopic("how do I create a new project?", HELP_TOPICS);
		expect(match).not.toBeNull();
		expect(match?.content).toBeTruthy();
	});

	it("matches nothing for ordinary conversational text", () => {
		expect(matchHelpTopic("thanks so much, that's helpful!", HELP_TOPICS)).toBeNull();
	});

	it("doesn't match a question purely about the user's own workspace data", () => {
		expect(matchHelpTopic("what's overdue and assigned to me?", HELP_TOPICS)).toBeNull();
	});
});
