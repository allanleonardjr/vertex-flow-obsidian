import { describe, expect, it } from "vitest";
import {
	wouldCreateDependencyCycle,
	wouldCreateHierarchyCycle,
} from "../../src/core/hierarchy/cycles";
import { emptyRelations } from "../../src/core/types";
import { task } from "./fixtures";

const t = (
	id: string,
	overrides: {
		parent?: string | null;
		blocks?: string[];
		blockedBy?: string[];
	} = {},
) =>
	task({
		id,
		path: `W/Tasks/${id}`,
		parent: overrides.parent ?? null,
		relations: {
			...emptyRelations(),
			blocks: overrides.blocks ?? [],
			blockedBy: overrides.blockedBy ?? [],
		},
	});

describe("wouldCreateDependencyCycle", () => {
	it("catches a direct cycle (A blocks B, now B blocks A)", () => {
		const a = t("A", { blocks: ["W/Tasks/B"] });
		const b = t("B", { blockedBy: ["W/Tasks/A"] });
		expect(
			wouldCreateDependencyCycle([a, b], "W/Tasks/B", "W/Tasks/A"),
		).toBe(true);
	});

	it("catches a transitive cycle (A blocks B blocks C, now C blocks A)", () => {
		const a = t("A", { blocks: ["W/Tasks/B"] });
		const b = t("B", { blockedBy: ["W/Tasks/A"], blocks: ["W/Tasks/C"] });
		const c = t("C", { blockedBy: ["W/Tasks/B"] });
		expect(
			wouldCreateDependencyCycle([a, b, c], "W/Tasks/C", "W/Tasks/A"),
		).toBe(true);
	});

	it("refuses a self-loop", () => {
		const a = t("A");
		expect(
			wouldCreateDependencyCycle([a], "W/Tasks/A", "W/Tasks/A"),
		).toBe(true);
	});

	it("allows a non-cyclic addition", () => {
		const a = t("A", { blocks: ["W/Tasks/B"] });
		const b = t("B", { blockedBy: ["W/Tasks/A"] });
		const c = t("C");
		expect(
			wouldCreateDependencyCycle([a, b, c], "W/Tasks/A", "W/Tasks/C"),
		).toBe(false);
	});

	it("checks the full task set, not a filtered subset containing only the two endpoints", () => {
		// The cycle only exists because of B, which sits outside the "visible" pair.
		const a = t("A", { blocks: ["W/Tasks/B"] });
		const b = t("B", { blockedBy: ["W/Tasks/A"], blocks: ["W/Tasks/C"] });
		const c = t("C", { blockedBy: ["W/Tasks/B"] });
		expect(
			wouldCreateDependencyCycle([a, b, c], "W/Tasks/C", "W/Tasks/A"),
		).toBe(true);
	});
});

describe("wouldCreateHierarchyCycle", () => {
	it("refuses a self-parent", () => {
		const a = t("A");
		expect(
			wouldCreateHierarchyCycle([a], "W/Tasks/A", "W/Tasks/A"),
		).toBe(true);
	});

	it("catches a transitive ancestor cycle (A > B > C, now A's parent = C)", () => {
		const a = t("A");
		const b = t("B", { parent: "W/Tasks/A" });
		const c = t("C", { parent: "W/Tasks/B" });
		expect(
			wouldCreateHierarchyCycle([a, b, c], "W/Tasks/A", "W/Tasks/C"),
		).toBe(true);
	});

	it("allows a non-cyclic re-parent", () => {
		const a = t("A");
		const b = t("B");
		const c = t("C", { parent: "W/Tasks/B" });
		expect(
			wouldCreateHierarchyCycle([a, b, c], "W/Tasks/C", "W/Tasks/A"),
		).toBe(false);
	});

	it("doesn't hang on a pre-existing corrupted cycle elsewhere in the vault", () => {
		const x = t("X", { parent: "W/Tasks/Y" });
		const y = t("Y", { parent: "W/Tasks/X" });
		const z = t("Z");
		expect(
			wouldCreateHierarchyCycle([x, y, z], "W/Tasks/Z", "W/Tasks/X"),
		).toBe(false);
	});
});
