import { describe, expect, it } from "vitest";
import {
	derivePrefix,
	disambiguatePrefix,
	formatTaskId,
	newConfigId,
	nextTaskId,
	parseTaskId,
	slugify,
	suggestPrefix,
} from "../../src/core/ids";
import {
	basename,
	dirname,
	formatLink,
	formatLinkList,
	isWithin,
	joinPath,
	linksMatch,
	parseLink,
	parseLinkList,
} from "../../src/core/links";

describe("derivePrefix", () => {
	it("takes the leading consonants", () => {
		expect(derivePrefix("Product Team")).toBe("PRD");
		expect(derivePrefix("Marketing")).toBe("MRK");
	});

	it("tops up from raw letters when there aren't enough consonants", () => {
		expect(derivePrefix("Ideas")).toHaveLength(3);
		expect(derivePrefix("AEIOU")).toHaveLength(3);
	});

	it("ignores punctuation, digits and spacing", () => {
		expect(derivePrefix("  Q4 2026 — Growth!  ")).toBe(derivePrefix("QGrowth"));
	});

	it("has a fallback for a name with no letters at all", () => {
		expect(derivePrefix("2026 !!")).toBe("WRK");
		expect(derivePrefix("")).toBe("WRK");
	});
});

describe("disambiguatePrefix", () => {
	it("returns the prefix untouched when it's free", () => {
		expect(disambiguatePrefix("MKT", [])).toBe("MKT");
	});

	it("appends a counter on collision (§3)", () => {
		expect(disambiguatePrefix("MKT", ["MKT"])).toBe("MKT2");
		expect(disambiguatePrefix("MKT", ["MKT", "MKT2"])).toBe("MKT3");
	});

	it("compares case-insensitively", () => {
		expect(disambiguatePrefix("mkt", ["MKT"])).toBe("MKT2");
	});

	it("suggests a vault-unique prefix in one step", () => {
		expect(suggestPrefix("Marketing", ["MRK"])).toBe("MRK2");
	});
});

describe("task ids", () => {
	it("formats with four digits", () => {
		expect(formatTaskId("prd", 104)).toBe("PRD-0104");
		expect(formatTaskId("PRD", 7)).toBe("PRD-0007");
	});

	it("keeps formatting beyond four digits rather than truncating", () => {
		expect(formatTaskId("PRD", 12345)).toBe("PRD-12345");
	});

	it("parses back", () => {
		expect(parseTaskId("PRD-0104")).toEqual({ prefix: "PRD", sequence: 104 });
		expect(parseTaskId("MKT2-0001")).toEqual({ prefix: "MKT2", sequence: 1 });
	});

	it("rejects things that aren't ids", () => {
		for (const bad of ["PRD", "0104", "PRD-", "-0104", "Some Task Title"]) {
			expect(parseTaskId(bad)).toBeNull();
		}
	});

	it("takes the next id from the highest sequence, not the count", () => {
		// Deleting PRD-0002 must never make a later task reuse that id.
		expect(nextTaskId("PRD", ["PRD-0001", "PRD-0003"])).toBe("PRD-0004");
	});

	it("starts at 1 for an empty workspace", () => {
		expect(nextTaskId("PRD", [])).toBe("PRD-0001");
	});

	it("ignores ids belonging to another workspace's prefix", () => {
		expect(nextTaskId("PRD", ["MKT-0099", "PRD-0001"])).toBe("PRD-0002");
	});
});

describe("newConfigId", () => {
	it("stays distinct across many calls in a tight loop", () => {
		// Far more than any config list realistically holds, minted with no
		// delay between calls so Date.now() is identical — the random suffix is
		// what keeps them apart.
		const ids = new Set<string>();
		for (let i = 0; i < 200; i++) ids.add(newConfigId("view"));
		expect(ids.size).toBe(200);
	});

	it("prefixes the id with the given prefix verbatim", () => {
		expect(newConfigId("dashboard").startsWith("dashboard-")).toBe(true);
		expect(newConfigId("widget").startsWith("widget-")).toBe(true);
		expect(newConfigId("view")).toMatch(/^view-[a-z0-9]+$/);
	});
});

describe("slugify", () => {
	it("kebab-cases a display name", () => {
		expect(slugify("In Progress")).toBe("in-progress");
		expect(slugify("No Priority!")).toBe("no-priority");
	});

	it("disambiguates against ids already taken", () => {
		expect(slugify("Bug", ["bug"])).toBe("bug-2");
		expect(slugify("Bug", ["bug", "bug-2"])).toBe("bug-3");
	});

	it("has a fallback for a name that slugs to nothing", () => {
		expect(slugify("!!!")).toBe("value");
	});
});

describe("parseLink", () => {
	it("normalizes every wikilink spelling to a bare target", () => {
		for (const input of [
			"[[Tasks/PRD-0104]]",
			"[[Tasks/PRD-0104|Some Alias]]",
			"[[Tasks/PRD-0104#Description]]",
			"  [[Tasks/PRD-0104]]  ",
			"Tasks/PRD-0104",
			"Tasks/PRD-0104.md",
		]) {
			expect(parseLink(input)).toBe("Tasks/PRD-0104");
		}
	});

	it("returns null for absent or empty input", () => {
		for (const input of [null, undefined, "", "   ", 42, {}, []]) {
			expect(parseLink(input)).toBeNull();
		}
	});

	it("parses a list, de-duplicating and dropping junk", () => {
		expect(parseLinkList(["[[A]]", "A", null, "[[B]]"])).toEqual(["A", "B"]);
		expect(parseLinkList("[[A]]")).toEqual(["A"]);
		expect(parseLinkList(null)).toEqual([]);
	});
});

describe("formatLink", () => {
	it("wraps a target back into a wikilink", () => {
		expect(formatLink("Tasks/PRD-0104")).toBe("[[Tasks/PRD-0104]]");
		expect(formatLink(null)).toBeNull();
		expect(formatLinkList(["A", "B"])).toEqual(["[[A]]", "[[B]]"]);
	});

	it("round-trips", () => {
		expect(parseLink(formatLink("Tasks/PRD-0104"))).toBe("Tasks/PRD-0104");
	});
});

describe("paths", () => {
	it("splits basename and dirname", () => {
		expect(basename("A/B/C")).toBe("C");
		expect(dirname("A/B/C")).toBe("A/B");
		expect(basename("C")).toBe("C");
		expect(dirname("C")).toBe("");
	});

	it("joins, skipping empty segments", () => {
		expect(joinPath("A", "", "B")).toBe("A/B");
		expect(joinPath("", "Tasks", "PRD-0104")).toBe("Tasks/PRD-0104");
	});

	it("scopes a path to a workspace root", () => {
		expect(isWithin("W/Tasks/A", "W")).toBe(true);
		expect(isWithin("W", "W")).toBe(true);
		expect(isWithin("Other/Tasks/A", "W")).toBe(false);
		// A root of "" means the workspace is the vault root.
		expect(isWithin("anything", "")).toBe(true);
	});

	it("does not treat a name-prefix as containment", () => {
		expect(isWithin("Workspace2/Tasks/A", "Workspace")).toBe(false);
	});
});

describe("linksMatch", () => {
	it("matches identical targets", () => {
		expect(linksMatch("W/Tasks/A", "W/Tasks/A")).toBe(true);
	});

	it("matches Obsidian's short form against a full path", () => {
		// This is why ID prefixes must be unique vault-wide (§3).
		expect(linksMatch("W/Tasks/PRD-0104", "PRD-0104")).toBe(true);
		expect(linksMatch("PRD-0104", "W/Tasks/PRD-0104")).toBe(true);
	});

	it("does not match different notes that merely share a folder", () => {
		expect(linksMatch("W/Tasks/A", "W/Tasks/B")).toBe(false);
	});

	it("does not match same-named notes in two different full paths", () => {
		expect(linksMatch("W1/Tasks/PRD-0104", "W2/Tasks/PRD-0104")).toBe(false);
	});

	it("is false when either side is missing", () => {
		expect(linksMatch(null, "A")).toBe(false);
		expect(linksMatch("A", null)).toBe(false);
	});
});
