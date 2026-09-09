import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { queryContext } from "../../src/core/query";
import { isSystemViewId } from "../../src/core/views";
import { serializeTemplateMarkdown } from "../../src/core/templates/markdown/serialize";
import { discoverVaultTemplates } from "../../src/obsidian/template-discovery";
import type { NoteIO } from "../../src/obsidian/note-io";

const snapshot = sampleSnapshot();

function templateSource(id: string): string {
	return serializeTemplateMarkdown({
		meta: { id, name: id },
		workspace: snapshot.workspace,
		views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
		dashboards: snapshot.dashboards,
		queryContext: queryContext(snapshot),
	});
}

function fakeIo(files: Record<string, string>): NoteIO {
	const entries = Object.entries(files).map(([name, content]) => ({
		name,
		basename: name.replace(/\.md$/, ""),
		extension: name.split(".").pop() ?? "",
		path: `Templates/${name}`,
		content,
	}));
	return {
		listFiles: () => entries,
		read: async (file: { content: string }) => file.content,
	} as unknown as NoteIO;
}

describe("discoverVaultTemplates", () => {
	it("discovers a valid vault template as a WorkspaceTemplate", async () => {
		const io = fakeIo({ "team.md": templateSource("team") });
		const found = await discoverVaultTemplates(io);
		expect(found).toHaveLength(1);
		expect(found[0].id).toBe("team");
		expect(found[0].path).toBe("Templates/team.md");
		expect(typeof found[0].buildExampleContent).toBe("function");
		expect(found[0].workspace?.statuses?.length).toBe(6);
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
			queryContext: queryContext(snapshot),
		});
		const io = fakeIo({ "dated.md": source });
		const found = await discoverVaultTemplates(io);
		expect(found[0].createdAt).toBe("2026-08-26T12:00:00.000Z");
	});
});
