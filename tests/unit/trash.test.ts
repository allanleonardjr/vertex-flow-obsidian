/**
 * Trash path arithmetic — the pure kernel of `moveToTrash` / `restoreFromTrash`
 * and the index's "is this file in Trash?" check. The `Mutations` / `VaultIndex`
 * glue around it isn't unit-testable (no Obsidian in vitest — see testing.md),
 * so the reversible-delete correctness that *can* be pinned lives here.
 */

import { describe, expect, it } from "vitest";
import {
	TRASH_FOLDER,
	isInTrash,
	liveFolder,
	trashFolder,
	trashedItemKind,
} from "../../src/obsidian/trash-paths";

const ROOT = "Product Team";

describe("trashFolder / liveFolder", () => {
	it("mirrors each kind's live folder under Trash/", () => {
		expect(trashFolder(ROOT, "task")).toBe("Product Team/Trash/Tasks");
		expect(trashFolder(ROOT, "project")).toBe("Product Team/Trash/Projects");
		expect(trashFolder(ROOT, "view")).toBe("Product Team/Trash/Views");
		expect(trashFolder(ROOT, "dashboard")).toBe(
			"Product Team/Trash/Dashboards",
		);
	});

	it("restores to the plain live folder", () => {
		expect(liveFolder(ROOT, "task")).toBe("Product Team/Tasks");
		expect(liveFolder(ROOT, "dashboard")).toBe("Product Team/Dashboards");
	});

	it("keeps TRASH_FOLDER as the single source of the folder name", () => {
		expect(trashFolder(ROOT, "task")).toContain(`/${TRASH_FOLDER}/`);
	});
});

describe("trashedItemKind", () => {
	it("classifies by Trash sub-folder, not by frontmatter type", () => {
		expect(trashedItemKind(ROOT, "Product Team/Trash/Tasks/TSK-0001")).toBe(
			"task",
		);
		expect(
			trashedItemKind(ROOT, "Product Team/Trash/Projects/Core App"),
		).toBe("project");
		expect(trashedItemKind(ROOT, "Product Team/Trash/Views/my-view")).toBe(
			"view",
		);
		expect(
			trashedItemKind(ROOT, "Product Team/Trash/Dashboards/health"),
		).toBe("dashboard");
	});

	it("returns null for a live note", () => {
		expect(trashedItemKind(ROOT, "Product Team/Tasks/TSK-0001")).toBeNull();
		expect(trashedItemKind(ROOT, "Product Team/_workspace")).toBeNull();
	});

	it("returns null for a file in another workspace's Trash", () => {
		expect(trashedItemKind(ROOT, "Other/Trash/Tasks/TSK-0001")).toBeNull();
	});

	it("returns null for an unrecognised Trash sub-folder", () => {
		expect(trashedItemKind(ROOT, "Product Team/Trash/Notes/scratch")).toBeNull();
	});

	it("does not treat a note literally named Trash as a Trash folder", () => {
		expect(trashedItemKind(ROOT, "Product Team/Projects/Trash")).toBeNull();
	});
});

describe("isInTrash", () => {
	it("is true only for paths under <root>/Trash/", () => {
		expect(isInTrash(ROOT, "Product Team/Trash/Tasks/TSK-0001")).toBe(true);
		expect(isInTrash(ROOT, "Product Team/Tasks/TSK-0001")).toBe(false);
		expect(isInTrash(ROOT, "Product Team/TrashCan/x")).toBe(false);
	});
});
