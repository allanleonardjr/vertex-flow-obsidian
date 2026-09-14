import { describe, expect, it } from "vitest";
import { projectView } from "../../src/ui/project-view";
import { project } from "./fixtures";

describe("projectView", () => {
	it("carries canvas arrangement, direction, and hidden relation kinds through from project.view", () => {
		const p = project({
			view: {
				filters: {},
				viewType: "canvas",
				groupBy: "status",
				sortBy: "rank",
				sortDirection: "asc",
				emptyColumnBehavior: "show-normal",
				hiddenFields: [],
				subtaskDisplay: "nested",
				calendarDateField: "dueDate",
				recurringPreview: false,
				tableSort: [],
				canvasArrangement: "tree",
				canvasDirection: "down",
				canvasHiddenRelationKinds: ["related"],
			},
		});

		const view = projectView(p);

		expect(view.canvasArrangement).toBe("tree");
		expect(view.canvasDirection).toBe("down");
		expect(view.canvasHiddenRelationKinds).toEqual(["related"]);
	});

	it("defaults canvas arrangement/direction/hidden relation kinds when project.view has none", () => {
		const p = project({ view: undefined });

		const view = projectView(p);

		expect(view.canvasArrangement).toBe("flow");
		expect(view.canvasDirection).toBe("right");
		expect(view.canvasHiddenRelationKinds).toEqual([]);
	});
});
