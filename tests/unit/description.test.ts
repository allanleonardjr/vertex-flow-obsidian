import { describe, expect, it } from "vitest";
import {
	COMMENTS_END,
	COMMENTS_START,
	extractDescription,
	parseComments,
	withDescription,
} from "../../src/core/serialization";

const WITH_COMMENTS = `## Description
Dragging into an empty column fails.

### Steps to Reproduce
1. Make a column.
2. Drag a card.

${COMMENTS_START}
## Comments
<comment id="cmt_01" author="alice" date="2026-08-26T14:15:00Z">
Looking at it now.
</comment>
${COMMENTS_END}
`;

describe("extractDescription", () => {
	it("reads the section under the heading", () => {
		expect(extractDescription("## Description\nSomething broke.\n")).toBe(
			"Something broke.",
		);
	});

	it("keeps sub-headings, which belong to the description", () => {
		const text = extractDescription(WITH_COMMENTS);
		expect(text).toContain("Dragging into an empty column fails.");
		expect(text).toContain("### Steps to Reproduce");
		expect(text).toContain("2. Drag a card.");
	});

	it("stops at the next level-2 section", () => {
		const body = "## Description\nThe description.\n\n## Notes\nUnrelated.\n";
		expect(extractDescription(body)).toBe("The description.");
	});

	it("never reaches into the comment block", () => {
		expect(extractDescription(WITH_COMMENTS)).not.toContain("Looking at it now");
		expect(extractDescription(WITH_COMMENTS)).not.toContain("PLUGIN_COMMENTS");
	});

	it("treats a headingless note as all description", () => {
		// Notes written by hand, or by another tool, shouldn't hide their text
		// from the editor just because they lack our heading.
		expect(extractDescription("Just some notes I typed.\n")).toBe(
			"Just some notes I typed.",
		);
	});

	it("is empty for an empty body", () => {
		expect(extractDescription("")).toBe("");
		expect(extractDescription("## Description\n\n")).toBe("");
	});
});

describe("withDescription", () => {
	it("round-trips", () => {
		const updated = withDescription(WITH_COMMENTS, "A brand new description.");
		expect(extractDescription(updated)).toBe("A brand new description.");
	});

	it("preserves the comment block untouched", () => {
		const updated = withDescription(WITH_COMMENTS, "Changed.");
		const comments = parseComments(updated);
		expect(comments).toHaveLength(1);
		expect(comments[0].body).toBe("Looking at it now.");
	});

	it("preserves other sections the user wrote", () => {
		const body = "## Description\nOld.\n\n## Notes\nKeep me.\n";
		const updated = withDescription(body, "New.");
		expect(updated).toContain("## Notes");
		expect(updated).toContain("Keep me.");
		expect(extractDescription(updated)).toBe("New.");
	});

	it("adds the heading to a note that had none", () => {
		const updated = withDescription("Loose prose.\n", "Now structured.");
		expect(updated).toContain("## Description");
		expect(extractDescription(updated)).toBe("Now structured.");
		// The loose prose was the description, so replacing it is correct.
		expect(updated).not.toContain("Loose prose.");
	});

	it("becomes surgical after the first save", () => {
		const once = withDescription("Loose prose.\n", "First.");
		const twice = withDescription(once, "Second.");
		expect(extractDescription(twice)).toBe("Second.");
		expect(twice.match(/## Description/g)).toHaveLength(1);
	});

	it("drops the section when the description is cleared", () => {
		const updated = withDescription("## Description\nGone soon.\n", "");
		expect(updated).not.toContain("## Description");
		expect(extractDescription(updated)).toBe("");
	});

	it("keeps comments when the description is cleared", () => {
		const updated = withDescription(WITH_COMMENTS, "");
		expect(parseComments(updated)).toHaveLength(1);
	});

	it("writes a description into a completely empty note", () => {
		const updated = withDescription("", "First words.");
		expect(extractDescription(updated)).toBe("First words.");
	});

	it("does not accumulate blank lines across repeated saves", () => {
		let body = "## Description\nStart.\n";
		for (let i = 0; i < 5; i++) body = withDescription(body, `Pass ${i}.`);
		expect(body).not.toMatch(/\n{3,}/);
		expect(extractDescription(body)).toBe("Pass 4.");
	});
});
