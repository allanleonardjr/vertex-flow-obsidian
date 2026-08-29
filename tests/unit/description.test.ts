import { describe, expect, it } from "vitest";
import {
  COMMENTS_END,
  COMMENTS_START,
} from "../../src/core/serialization/comments"; // Update path if needed
import {
  parseDescription,
  serializeDescription,
  DESCRIPTION_START_TAG,
  DESCRIPTION_END_TAG,
} from "../../src/core/serialization/description"; // Update path if needed

const WITH_COMMENTS = `${DESCRIPTION_START_TAG}
## Description
Dragging into an empty column fails.

### Steps to Reproduce
1. Make a column.
2. Drag a card.
${DESCRIPTION_END_TAG}

${COMMENTS_START}
## Comments
<comment id="cmt_01" author="alice" date="2026-08-26T14:15:00Z">
Looking at it now.
</comment>
${COMMENTS_END}
`;

describe("parseDescription", () => {
  it("reads the fenced section under the heading", () => {
    const body = `${DESCRIPTION_START_TAG}\n## Description\nSomething broke.\n\n${DESCRIPTION_END_TAG}`;
    expect(parseDescription(body)).toBe("Something broke.");
  });

  it("keeps sub-headings, which belong to the description", () => {
    const text = parseDescription(WITH_COMMENTS);
    expect(text).toContain("Dragging into an empty column fails.");
    expect(text).toContain("### Steps to Reproduce");
    expect(text).toContain("2. Drag a card.");
  });

  it("stops at the end tag, ignoring other sections", () => {
    const body = `${DESCRIPTION_START_TAG}\n## Description\nThe description.\n\n${DESCRIPTION_END_TAG}\n\n## Notes\nUnrelated.\n`;
    expect(parseDescription(body)).toBe("The description.");
  });

  it("never reaches into the comment block", () => {
    expect(parseDescription(WITH_COMMENTS)).not.toContain("Looking at it now");
    expect(parseDescription(WITH_COMMENTS)).not.toContain("PLUGIN_COMMENTS");
  });

  it("returns an empty string for a note without XML description tags", () => {
    // Notes without our strict XML fencing are ignored
    expect(parseDescription("Just some notes I typed.\n")).toBe("");
  });

  it("is empty for an empty body", () => {
    expect(parseDescription("")).toBe("");
    expect(
      parseDescription(
        `${DESCRIPTION_START_TAG}\n## Description\n\n${DESCRIPTION_END_TAG}`,
      ),
    ).toBe("");
  });
});

describe("serializeDescription", () => {
  it("round-trips perfectly with parseDescription", () => {
    const newDesc = "A brand new description.";
    const serialized = serializeDescription(newDesc);
    expect(parseDescription(serialized)).toBe("A brand new description.");
  });

  it("includes the fencing tags and removes the blank line below the heading", () => {
    const serialized = serializeDescription("Changed.");

    // Asserts the blank line was successfully removed
    expect(serialized).toContain("## Description\nChanged.");
    expect(serialized).toContain(DESCRIPTION_START_TAG);
    expect(serialized).toContain(DESCRIPTION_END_TAG);
  });

  it("still emits the block when there is no description", () => {
    // The heading is the landmark someone hand-editing the note needs; a
    // section that vanishes when empty is exactly when they need it most.
    for (const empty of ["", "   ", undefined, null]) {
      const serialized = serializeDescription(empty);
      expect(serialized).toContain(DESCRIPTION_START_TAG);
      expect(serialized).toContain("## Description");
      expect(serialized).toContain(DESCRIPTION_END_TAG);
    }
  });

  it("round-trips an empty description back to an empty string", () => {
    // What keeps the editor's placeholder showing rather than a stray heading.
    expect(parseDescription(serializeDescription(""))).toBe("");
    expect(parseDescription(serializeDescription(null))).toBe("");
  });

  it("leaves a blank line under the heading to type into", () => {
    expect(serializeDescription("")).toBe(
      `${DESCRIPTION_START_TAG}\n## Description\n\n${DESCRIPTION_END_TAG}`,
    );
  });

  it("survives a round-trip through a description of its own headings", () => {
    const text = "## Not the end\n\nBody.\n\n## Nor this";
    expect(parseDescription(serializeDescription(text))).toBe(text);
  });
});
