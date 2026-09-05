import { describe, expect, it } from "vitest";
import { workspaceAccentColor } from "../../src/core/workspace-color";
import { COLOR_PALETTE } from "../../src/core/color";

describe("workspaceAccentColor", () => {
	it("is deterministic for a given root", () => {
		const a = workspaceAccentColor("Product Team/");
		const b = workspaceAccentColor("Product Team/");
		expect(a).toBe(b);
	});

	it("always returns a palette color", () => {
		for (const root of [
			"",
			"A",
			"Product Team/",
			"Clients/Acme Corp",
			"深い/ワークスペース",
		]) {
			expect(COLOR_PALETTE).toContain(workspaceAccentColor(root));
		}
	});

	it("distinguishes most distinct roots (collisions allowed, not required)", () => {
		const roots = [
			"Workspace One",
			"Workspace Two",
			"Clients/Acme",
			"Clients/Globex",
			"Personal",
		];
		const colors = new Set(roots.map(workspaceAccentColor));
		expect(colors.size).toBeGreaterThan(1);
	});
});
