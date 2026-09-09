import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { snapshotContext } from "../../src/core/views";
import { buildExport } from "../../src/core/export";

const snapshot = sampleSnapshot();
const context = snapshotContext(snapshot);

function json(fields: string[]) {
	return JSON.parse(
		buildExport({
			snapshot,
			context,
			scope: { kind: "workspace" },
			format: "json",
			fields: fields as never,
			today: "2026-08-26",
			includeArchived: false,
			pluginVersion: "9.9.9",
		}).content,
	);
}

describe("buildWorkspaceJson", () => {
	it("keeps the raw snapshot shape with ids, tasks narrowed to scope", () => {
		const out = json(["id"]);
		expect(out.workspace.name).toBe("Sample Workspace");
		expect(Array.isArray(out.tasks)).toBe(true);
		expect(out.tasks.length).toBe(22);
		// raw ids, not names
		expect(out.tasks[0].status).toBe(
			snapshot.tasks.find((t) => t.id === out.tasks[0].id)!.status,
		);
	});

	it("always carries a resolved block covering all six lookup kinds", () => {
		const { resolved } = json([]);
		expect(Object.keys(resolved).sort()).toEqual([
			"labels",
			"people",
			"priorities",
			"projects",
			"statuses",
			"taskTypes",
		]);
		expect(resolved.statuses["in-progress"]).toBe("In Progress");
		expect(resolved.people.alice).toBe("Alice");
		expect(Object.values(resolved.projects)).toContain("Core App Experience");
	});

	it("carries a meta block", () => {
		const { meta } = json([]);
		expect(meta).toMatchObject({
			pluginVersion: "9.9.9",
			workspaceName: "Sample Workspace",
			workspaceRoot: "Sample",
			exportedAt: "2026-08-26",
		});
	});

	it("omits descriptions/comments unless those fields are checked", () => {
		expect(json(["id"]).descriptions).toBeUndefined();
		expect(json(["id"]).comments).toBeUndefined();
		const withRich = json(["description", "comments"]);
		expect(withRich.descriptions).toBeDefined();
		expect(withRich.comments).toBeDefined();
	});
});
