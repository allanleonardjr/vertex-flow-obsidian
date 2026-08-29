import { describe, expect, it } from "vitest";
import { detectPrefixCollisions } from "../../src/core/ids";

describe("detectPrefixCollisions", () => {
	it("flags each workspace sharing a prefix, naming the others", () => {
		const collisions = detectPrefixCollisions([
			{ notePath: "A/_workspace", name: "Alpha", idPrefix: "PRD" },
			{ notePath: "B/_workspace", name: "Beta", idPrefix: "PRD" },
			{ notePath: "C/_workspace", name: "Gamma", idPrefix: "MKT" },
		]);

		expect(collisions).toHaveLength(2);
		expect(collisions.find((c) => c.notePath === "A/_workspace")?.others).toEqual([
			"Beta",
		]);
		expect(collisions.find((c) => c.notePath === "B/_workspace")?.others).toEqual([
			"Alpha",
		]);
		expect(collisions.every((c) => c.prefix === "PRD")).toBe(true);
	});

	it("compares prefixes case- and whitespace-insensitively", () => {
		const collisions = detectPrefixCollisions([
			{ notePath: "A/_workspace", name: "Alpha", idPrefix: "prd" },
			{ notePath: "B/_workspace", name: "Beta", idPrefix: " PRD " },
		]);

		expect(collisions).toHaveLength(2);
		expect(collisions[0].prefix).toBe("PRD");
	});

	it("names every peer when three or more collide", () => {
		const collisions = detectPrefixCollisions([
			{ notePath: "A/_workspace", name: "Alpha", idPrefix: "X" },
			{ notePath: "B/_workspace", name: "Beta", idPrefix: "X" },
			{ notePath: "C/_workspace", name: "Gamma", idPrefix: "X" },
		]);

		expect(collisions).toHaveLength(3);
		expect(
			collisions.find((c) => c.notePath === "A/_workspace")?.others.sort(),
		).toEqual(["Beta", "Gamma"]);
	});

	it("returns nothing when every prefix is unique", () => {
		expect(
			detectPrefixCollisions([
				{ notePath: "A/_workspace", name: "Alpha", idPrefix: "PRD" },
				{ notePath: "B/_workspace", name: "Beta", idPrefix: "MKT" },
			]),
		).toEqual([]);
	});

	it("ignores blank prefixes rather than colliding them", () => {
		expect(
			detectPrefixCollisions([
				{ notePath: "A/_workspace", name: "Alpha", idPrefix: "" },
				{ notePath: "B/_workspace", name: "Beta", idPrefix: "  " },
			]),
		).toEqual([]);
	});
});
