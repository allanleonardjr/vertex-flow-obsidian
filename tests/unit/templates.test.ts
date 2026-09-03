import { describe, expect, it } from "vitest";
import { instantiateTemplate } from "../../src/core/templates/instantiate";
import { WORKSPACE_TEMPLATES, templateById } from "../../src/core/templates";
import { sampleWorkspaceTemplate } from "../../src/core/templates/sample-workspace";
import { serializeWorkspace } from "../../src/core/serialization/workspace";
import { workspaceTaxonomies } from "../../src/core/taxonomy";
import type { Task } from "../../src/core/types";

/** Every gallery template is expected to exist; `templateById` returning
 *  `undefined` here means the registry lost one, which is worth failing on. */
function requireTemplate(id: string) {
	const template = templateById(id);
	if (!template) throw new Error(`Template "${id}" is missing from the registry`);
	return template;
}

const gettingStartedTemplate = requireTemplate("getting-started");

const base = {
	root: "Workspaces/Demo",
	name: "Demo",
	includeExampleContent: false,
	now: new Date("2026-01-01T00:00:00Z"),
};

describe("every template's example content is a full feature showcase", () => {
	// Templates that opt out (`supportsExampleContent: false`) are verified
	// separately — they deliberately generate none of this.
	const showcaseTemplates = WORKSPACE_TEMPLATES.filter(
		(t) => t.supportsExampleContent !== false,
	);
	for (const template of showcaseTemplates) {
		describe(template.id, () => {
			const { snapshot } = instantiateTemplate({
				...base,
				template,
				includeExampleContent: true,
				now: new Date("2026-08-26T12:00:00Z"),
			});
			const { tasks, projects } = snapshot;
			const has = (predicate: (t: Task) => boolean) => tasks.some(predicate);

			it("generates ~25 tasks", () => {
				expect(tasks.length).toBeGreaterThanOrEqual(24);
				expect(tasks.length).toBeLessThanOrEqual(26);
			});

			it("has at least three projects", () => {
				expect(projects.length).toBeGreaterThanOrEqual(3);
			});

			it("has two parent/sub-task hierarchies at different ratios", () => {
				const parents = tasks.filter((parent) =>
					tasks.some((t) => t.parent === parent.path),
				);
				expect(parents.length).toBeGreaterThanOrEqual(2);
			});

			it("has a real un-parented, project-less bucket", () => {
				// Most templates keep a handful of loose errands. The
				// agency template deliberately keeps exactly one (everything else
				// belongs to a client Project or to "Internal"), because a large
				// loose bucket would misrepresent the one-Project-per-client
				// workflow it exists to teach — so the floor is "at least one",
				// not "at least three".
				expect(
					tasks.filter((t) => t.project === null && t.parent === null).length,
				).toBeGreaterThanOrEqual(1);
			});

			it("has archived tasks in both the done and canceled categories", () => {
				const { status } = workspaceTaxonomies(snapshot.workspace);
				const cat = (id: string | null) =>
					status.values.find((v) => v.id === id)?.category;
				const archived = tasks.filter((t) => t.archived);
				expect(archived.length).toBeGreaterThanOrEqual(3);
				expect(archived.some((t) => cat(t.status) === "completed")).toBe(true);
				expect(archived.some((t) => cat(t.status) === "canceled")).toBe(true);
			});

			it("has date variety: start+due, due-only, and a real unscheduled bucket", () => {
				const undated = tasks.filter(
					(t) => t.startDate === null && t.dueDate === null,
				);
				// content-pipeline is deliberately due-date-heavy (publish dates), so
				// this is "a meaningful unscheduled bucket" rather than "a majority".
				expect(undated.length).toBeGreaterThanOrEqual(5);
				expect(has((t) => t.startDate !== null && t.dueDate !== null)).toBe(true);
				expect(has((t) => t.startDate === null && t.dueDate !== null)).toBe(true);
			});

			it("uses every label value on at least two tasks", () => {
				for (const label of snapshot.workspace.labels) {
					const count = tasks.filter((t) =>
						t.labels.includes(label.id),
					).length;
					expect(count, `label "${label.id}"`).toBeGreaterThanOrEqual(2);
				}
			});

			it("has at least one blocks/blockedBy relation pair", () => {
				expect(has((t) => t.relations.blockedBy.length > 0)).toBe(true);
				expect(has((t) => t.relations.blocks.length > 0)).toBe(true);
			});

			it("ships at least one dashboard, each with at least two widgets", () => {
				// The TS templates each ship a single 2–3 widget dashboard. The
				// markdown format made multi-dashboard templates cheap to author,
				// and agency-client-management uses two (a whole-business overview
				// and a client-scoped one), so this asserts the quality floor —
				// every dashboard is populated — rather than a fixed count.
				expect(snapshot.dashboards.length).toBeGreaterThanOrEqual(1);
				for (const dashboard of snapshot.dashboards) {
					expect(
						dashboard.widgets.length,
						`dashboard "${dashboard.id}"`,
					).toBeGreaterThanOrEqual(2);
				}
			});

			it("card-preview settings match the actual taxonomy", () => {
				const names = (label: string) =>
					template.settings
						.find((s) => s.label === label)
						?.values.map((v) => v.name) ?? [];
				expect(names("Statuses")).toEqual(
					snapshot.workspace.statuses.map((s) => s.name),
				);
				expect(names("Labels")).toEqual(
					snapshot.workspace.labels.map((l) => l.name),
				);
			});
		});
	}
});

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
			template: sampleWorkspaceTemplate,
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

	it("emits a per-file dashboard note and a full task set", () => {
		const generated = instantiateTemplate({
			...base,
			template: sampleWorkspaceTemplate,
			includeExampleContent: true,
		});
		expect(generated.snapshot.tasks).toHaveLength(25);
		expect(generated.snapshot.dashboards).toHaveLength(1);
		expect(generated.snapshot.dashboards[0].widgets).toHaveLength(3);
		const dashboardId = generated.snapshot.dashboards[0].id;
		expect(
			generated.notes.some((n) => n.path.endsWith(`/Dashboards/${dashboardId}`)),
		).toBe(true);
		// The retired shared config notes are never emitted.
		expect(
			generated.notes.some(
				(n) => n.path.endsWith("/_dashboards") || n.path.endsWith("/_views"),
			),
		).toBe(false);
	});

	it("reuses a matching entry by name instead of duplicating it", () => {
		const { workspace } = instantiateTemplate({
			...base,
			template: sampleWorkspaceTemplate,
			includeExampleContent: true,
			selfPersonName: "alice",
		});
		expect(workspace.people.filter((p) => p.name === "Alice")).toHaveLength(1);
		const self = workspace.people.filter((p) => p.isSelf);
		expect(self.map((p) => p.name)).toEqual(["Alice"]);
	});
});

describe("blank workspace template", () => {
	const blankTemplate = requireTemplate("blank-workspace");

	it("does not support example content", () => {
		expect(blankTemplate.supportsExampleContent).toBe(false);
	});

	it("instantiation produces no seeded user content even when asked to populate", () => {
		const { snapshot, notes } = instantiateTemplate({
			...base,
			template: blankTemplate,
			includeExampleContent: true,
		});
		expect(snapshot.tasks).toHaveLength(0);
		expect(snapshot.projects).toHaveLength(0);
		expect(snapshot.dashboards).toHaveLength(0);
		expect(notes.some((n) => n.path.endsWith("/Dashboards/"))).toBe(false);
	});

	it("ships only the minimal workspace scaffolding", () => {
		const { snapshot, workspace } = instantiateTemplate({
			...base,
			template: blankTemplate,
			includeExampleContent: false,
		});
		// No user views beyond the injected "All Tasks" System View.
		expect(snapshot.views).toHaveLength(1);
		// A blank template overrides every taxonomy to empty — so the in-memory
		// config is empty, and the written `_workspace.md` frontmatter carries no
		// taxonomy at all. With no statuses there's also no default status, so
		// new tasks/projects would carry no status rather than a phantom id.
		expect(snapshot.workspace.statuses).toHaveLength(0);
		expect(snapshot.workspace.defaultNewTaskStatus).toBeNull();
		const frontmatter = serializeWorkspace(workspace);
		for (const key of ["statuses", "priorities", "taskTypes", "labels", "people"]) {
			expect(
				Object.prototype.hasOwnProperty.call(frontmatter, key),
				`_workspace.md should not restate "${key}"`,
			).toBe(false);
		}
		expect(
			Object.prototype.hasOwnProperty.call(
				frontmatter,
				"defaultNewTaskStatus",
			),
		).toBe(false);
	});
});

describe("workspace template gallery ordering", () => {
	it("puts blank workspace first, then getting started", () => {
		const ids = WORKSPACE_TEMPLATES.map((t) => t.id);
		expect(ids[0]).toBe("blank-workspace");
		expect(ids[1]).toBe("getting-started");
	});

	it("every template declares supportsExampleContent", () => {
		for (const template of WORKSPACE_TEMPLATES) {
			expect(
				typeof template.supportsExampleContent,
				`template "${template.id}"`,
			).toBe("boolean");
		}
	});

	it("all non-blank templates support example content", () => {
		for (const template of WORKSPACE_TEMPLATES) {
			if (template.id === "blank-workspace") continue;
			expect(template.supportsExampleContent).toBe(true);
		}
	});
});
