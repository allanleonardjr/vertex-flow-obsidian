import { describe, expect, it } from "vitest";
import { danglingRelationEditsForWorkspaceDeletion } from "../../src/core/hierarchy";
import { sampleSnapshot } from "../../src/core/templates/instantiate";

describe("danglingRelationEditsForWorkspaceDeletion", () => {
	it("rewrites relations in other workspaces that point into the deleted one", () => {
		const a = sampleSnapshot("A");
		const b = sampleSnapshot("B");

		// A task in the surviving workspace links across into a doomed task.
		b.tasks[0].relations = {
			...b.tasks[0].relations,
			related: [a.tasks[0].path],
		};

		const edits = danglingRelationEditsForWorkspaceDeletion([a, b], "A");
		const edit = edits.find((e) => e.path === b.tasks[0].path);

		expect(edit).toBeDefined();
		expect(edit?.relations.related).toEqual([]);
	});

	it("clears a duplicateOf that points into the deleted workspace", () => {
		const a = sampleSnapshot("A");
		const b = sampleSnapshot("B");

		b.tasks[1].relations = {
			...b.tasks[1].relations,
			duplicateOf: a.tasks[2].path,
		};

		const edits = danglingRelationEditsForWorkspaceDeletion([a, b], "A");
		expect(
			edits.find((e) => e.path === b.tasks[1].path)?.relations.duplicateOf,
		).toBeNull();
	});

	it("leaves relations that stay within a surviving workspace alone", () => {
		const a = sampleSnapshot("A");
		const b = sampleSnapshot("B");

		b.tasks[0].relations = {
			...b.tasks[0].relations,
			related: [b.tasks[1].path],
		};

		const edits = danglingRelationEditsForWorkspaceDeletion([a, b], "A");
		expect(edits.some((e) => e.path === b.tasks[0].path)).toBe(false);
	});

	it("never reports an edit for a task inside the deleted workspace", () => {
		const a = sampleSnapshot("A");
		const b = sampleSnapshot("B");

		// Cross-link both directions.
		b.tasks[0].relations = { ...b.tasks[0].relations, related: [a.tasks[0].path] };
		a.tasks[0].relations = { ...a.tasks[0].relations, related: [b.tasks[0].path] };

		const edits = danglingRelationEditsForWorkspaceDeletion([a, b], "A");
		expect(edits.every((e) => e.path.startsWith("B/"))).toBe(true);
	});

	it("returns nothing when the doomed root names no known workspace", () => {
		const a = sampleSnapshot("A");
		expect(danglingRelationEditsForWorkspaceDeletion([a], "Nope")).toEqual([]);
	});
});
