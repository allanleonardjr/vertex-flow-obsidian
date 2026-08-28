import { describe, expect, it } from "vitest";
import { instantiateTemplate } from "../../src/core/templates/instantiate";
import { gettingStartedTemplate } from "../../src/core/templates/getting-started";
import { softwareSprintTemplate } from "../../src/core/templates/software-sprint";

const base = {
	root: "Workspaces/Demo",
	name: "Demo",
	includeExampleContent: false,
	now: new Date("2026-01-01T00:00:00Z"),
};

describe("instantiateTemplate — self person seeding", () => {
	it("leaves the register untouched when no name is given", () => {
		const { workspace } = instantiateTemplate({
			...base,
			template: gettingStartedTemplate,
		});
		expect(workspace.people).toEqual([]);
	});

	it("adds the creator as the sole isSelf entry in an empty register", () => {
		const { workspace } = instantiateTemplate({
			...base,
			template: gettingStartedTemplate,
			selfPersonName: "  Jordan  ",
		});
		expect(workspace.people).toEqual([
			{ id: "jordan", name: "Jordan", aliases: [], isSelf: true },
		]);
	});

	it("appends the creator and clears isSelf elsewhere when example people exist", () => {
		const { workspace } = instantiateTemplate({
			...base,
			template: softwareSprintTemplate,
			includeExampleContent: true,
			selfPersonName: "Casey",
		});
		const self = workspace.people.filter((p) => p.isSelf);
		expect(self).toHaveLength(1);
		expect(self[0].name).toBe("Casey");
		// The template's own people are still present as assignable non-self entries.
		expect(workspace.people.map((p) => p.name)).toEqual(
			expect.arrayContaining(["Alice", "Bob", "Casey"]),
		);
	});

	it("reuses a matching entry by name instead of duplicating it", () => {
		const { workspace } = instantiateTemplate({
			...base,
			template: softwareSprintTemplate,
			includeExampleContent: true,
			selfPersonName: "alice",
		});
		expect(workspace.people.filter((p) => p.name === "Alice")).toHaveLength(1);
		const self = workspace.people.filter((p) => p.isSelf);
		expect(self.map((p) => p.name)).toEqual(["Alice"]);
	});
});
