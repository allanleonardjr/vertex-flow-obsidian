import { describe, expect, it } from "vitest";
import {
	instantiateTemplate,
	sampleSnapshot,
} from "../../src/core/templates/instantiate";
import { queryContext } from "../../src/core/query";
import { isSystemViewId } from "../../src/core/views";
import { serializeTemplateMarkdown } from "../../src/core/templates/markdown/serialize";
import { discoverVaultTemplates } from "../../src/obsidian/template-discovery";
import {
	LEGACY_WORKSPACE_TEMPLATES_FOLDER,
	WORKSPACE_TEMPLATES_FOLDER,
} from "../../src/obsidian/template-folder";
import type { NoteIO } from "../../src/obsidian/note-io";

const snapshot = sampleSnapshot();

function templateSource(id: string): string {
	return serializeTemplateMarkdown({
		meta: { id, name: id },
		workspace: snapshot.workspace,
		views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
		dashboards: snapshot.dashboards,
		projects: snapshot.projects,
		queryContext: queryContext(snapshot),
	});
}

function fakeIo(files: Record<string, string>): NoteIO {
	const entries = Object.entries(files).map(([name, content]) => ({
		name,
		basename: name.replace(/\.md$/, ""),
		extension: name.split(".").pop() ?? "",
		path: `${WORKSPACE_TEMPLATES_FOLDER}/${name}`,
		content,
	}));
	return {
		listFiles: (folderPath: string) =>
			entries.filter((entry) => entry.path.startsWith(`${folderPath}/`)),
		read: async (file: { content: string }) => file.content,
	} as unknown as NoteIO;
}

describe("discoverVaultTemplates", () => {
	it("discovers a valid vault template as a WorkspaceTemplate", async () => {
		const io = fakeIo({ "team.md": templateSource("team") });
		const found = await discoverVaultTemplates(io);
		expect(found).toHaveLength(1);
		expect(found[0].id).toBe("team");
		expect(found[0].path).toBe(`${WORKSPACE_TEMPLATES_FOLDER}/team.md`);
		expect(typeof found[0].buildExampleContent).toBe("function");
		expect(found[0].workspace?.statuses?.length).toBe(6);
		const labeledValueNames = (label: string) =>
			found[0].settings
				.find((s) => s.label === label)
				?.values.map((v) => v.name) ?? [];
		expect(labeledValueNames("Views")).toEqual(
			snapshot.views
				.filter((v) => !isSystemViewId(v.id))
				.map((v) => v.name),
		);
		expect(labeledValueNames("Dashboards")).toEqual(
			snapshot.dashboards.map((d) => d.name),
		);
		// A template exported from a workspace carries its Projects.
		expect(labeledValueNames("Projects")).toEqual(
			snapshot.projects.map((p) => p.title),
		);
		expect(labeledValueNames("People")).toEqual(
			snapshot.workspace.people.map((p) => p.name),
		);
		// The icon rides along on each preview row, so the pill can render a glyph.
		const viewRow = found[0].settings.find((s) => s.label === "Views")!;
		expect(viewRow.values.every((v, i) => v.icon === snapshot.views
				.filter((w) => !isSystemViewId(w.id))[i].icon)).toBe(true);
		// People pills carry the user glyph; project pills their own icon (none
		// here, so the fallback renders — the icon field is simply optional).
		const peopleRow = found[0].settings.find((s) => s.label === "People")!;
		expect(peopleRow.values.every((v) => v.icon === "user")).toBe(true);
		expect(
			found[0].settings.find((s) => s.label === "Projects")?.values.every(
				(v) => v.icon === undefined,
			),
		).toBe(true);
	});

	it("skips a malformed file without throwing, warning once", async () => {
		const warnings: string[] = [];
		const io = fakeIo({
			"good.md": templateSource("good"),
			"bad.md": "this is not a template",
		});
		const found = await discoverVaultTemplates(io, (m) => warnings.push(m));
		expect(found.map((t) => t.id)).toEqual(["good"]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("bad.md");
	});

	it("lets a built-in template win an id collision", async () => {
		const warnings: string[] = [];
		const io = fakeIo({ "blank-workspace.md": templateSource("blank-workspace") });
		const found = await discoverVaultTemplates(io, (m) => warnings.push(m));
		expect(found).toHaveLength(0);
		expect(warnings[0]).toContain("built-in");
	});

	it("ignores non-markdown files", async () => {
		const io = fakeIo({ "notes.txt": "x", "t.md": templateSource("t") });
		const found = await discoverVaultTemplates(io);
		expect(found.map((t) => t.id)).toEqual(["t"]);
	});

	it("still discovers templates in the legacy Templates/ folder", async () => {
		const entries = {
			"legacy.md": templateSource("legacy"),
		};
		const io = {
			listFiles: () =>
				Object.entries(entries).map(([name, content]) => ({
					name,
					basename: name.replace(/\.md$/, ""),
					extension: name.split(".").pop() ?? "",
					path: `${LEGACY_WORKSPACE_TEMPLATES_FOLDER}/${name}`,
					content,
				})),
			read: async (file: { content: string }) => file.content,
		} as unknown as NoteIO;
		const found = await discoverVaultTemplates(io);
		expect(found.map((t) => t.id)).toEqual(["legacy"]);
		expect(found[0].path).toBe(`${LEGACY_WORKSPACE_TEMPLATES_FOLDER}/legacy.md`);
	});


	it("propagates an optional createdAt onto the VaultTemplate", async () => {
		const source = serializeTemplateMarkdown({
			meta: {
				id: "dated",
				name: "dated",
				createdAt: "2026-08-26T12:00:00.000Z",
			},
			workspace: snapshot.workspace,
			views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
			dashboards: snapshot.dashboards,
			projects: snapshot.projects,
			queryContext: queryContext(snapshot),
		});
		const io = fakeIo({ "dated.md": source });
		const found = await discoverVaultTemplates(io);
		expect(found[0].createdAt).toBe("2026-08-26T12:00:00.000Z");
	});

	it("keeps views, dashboards and Projects when instantiated without example content", async () => {
		// Creation runs with `includeExampleContent: false` (Tasks are the only
		// example material). Views, dashboards and Projects are structure — not
		// example material — and must still be born; only the Tasks must not.
		const io = fakeIo({ "team.md": templateSource("team") });
		const [found] = await discoverVaultTemplates(io);
		const generated = instantiateTemplate({
			template: found,
			root: "WS",
			name: "Team",
			idPrefix: "TEA",
			includeExampleContent: false,
			now: new Date("2026-08-26T12:00:00Z"),
		}).snapshot;
		expect(generated.tasks).toHaveLength(0);
		expect(generated.projects.map((p) => p.title)).toEqual(
			snapshot.projects.map((p) => p.title),
		);
		expect(
			generated.views.filter((v) => !isSystemViewId(v.id)).map((v) => v.name),
		).toContain("Sprint Board");
		expect(generated.dashboards.map((d) => d.name)).toContain(
			"Sprint Overview",
		);
	});
});
