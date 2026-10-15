import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printFilters, printQuery, queryContext } from "../../src/core/query";

// Plan Things Better's one form for the query language: `name:` for a task's
// name, `{kind}.key` for an item, `task.` in front of a task's own field, and
// `kind:task`. The spellings written before still read, so saved views keep
// their meaning.

const snapshot = sampleSnapshot();
const ctx = queryContext(snapshot);

describe("the one form", () => {
	it("writes a task's name as name:, and still reads title:, text: and search:", () => {
		// Plain words print bare; text that wouldn't read back as words is labelled.
		expect(printFilters({ text: "launch plan" }, ctx)).toBe("launch plan");
		expect(printFilters({ text: "a,b" }, ctx)).toBe('name:"a,b"');
		for (const field of ["name", "title", "text", "search", "taskTitle", "task.name", "task.title"]) {
			expect(parseQuery(`${field}:launch`, ctx).definition.filters.text).toBe("launch");
		}
	});

	it("sorts by name, and still reads sort:title", () => {
		expect(parseQuery("sort:-name", ctx).definition).toEqual(parseQuery("sort:-title", ctx).definition);
		expect(printQuery(parseQuery("sort:title", ctx).definition, ctx)).toContain("sort:name");
	});

	it("reads Plan Things Better's spellings of the same fields", () => {
		const project = ctx.projects[0].title;
		const pairs: [string, string][] = [
			[`project:"${project}"`, `projectKey:"${project}"`],
			[`project:"${project}"`, `project.key:"${project}"`],
			[`project:"${project}"`, `task.project:"${project}"`],
			["parent:unset", "taskParentKey:unset"],
			["parent:unset", "parent.key:unset"],
			["root:any", "taskRootKey:any"],
			["status:done", "task.status:done"],
			["-label:unset", "-task.label:unset"],
			["-label:unset", "-label.key:unset"],
			["sort:due", "sort:task.due"],
			["hide:project", "hide:task.project"],
		];
		for (const [before, after] of pairs) {
			const now = parseQuery(after, ctx);
			expect(now.issues.filter((issue) => issue.severity === "error")).toEqual([]);
			expect(now.definition).toEqual(parseQuery(before, ctx).definition);
		}
	});

	it("takes kind:task as what a task query finds, and no other kind", () => {
		expect(parseQuery("kind:task status:done", ctx).definition).toEqual(parseQuery("status:done", ctx).definition);
		expect(parseQuery("kind:project", ctx).ok).toBe(false);
		expect(parseQuery("-kind:task", ctx).ok).toBe(false);
		// A value that isn't a kind is still a type.
		expect(parseQuery("kind:bug", ctx).definition).toEqual(parseQuery("type:bug", ctx).definition);
	});
});
