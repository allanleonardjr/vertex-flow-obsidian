/**
 * Runtime discovery of vault-authored workspace templates.
 *
 * Lists `.md` files directly under the vault-root `Templates/` folder, parses
 * each through the same `parseTemplateMarkdown()` the built-in gallery uses, and
 * maps successes to `WorkspaceTemplate` exactly as `markdownTemplates()` does. A
 * bad file is skipped via `onWarn` (never taking the gallery down); an id that
 * collides with a built-in template loses to the built-in.
 *
 * Deliberately imports no Obsidian API — the caller passes a `Notice`-backed
 * `onWarn`, keeping this unit-testable against a fake `NoteIO`.
 */

import { parseTemplateMarkdown } from "../core/templates/markdown/parse";
import { resolveTemplateContent } from "../core/templates/markdown/resolve";
import { TemplateParseError } from "../core/templates/markdown/types";
import { WORKSPACE_TEMPLATES, type WorkspaceTemplate } from "../core/templates";
import type { NoteIO } from "./note-io";

export async function discoverVaultTemplates(
	io: NoteIO,
	onWarn: (message: string) => void = () => {},
): Promise<WorkspaceTemplate[]> {
	const builtinIds = new Set(WORKSPACE_TEMPLATES.map((template) => template.id));
	const out: WorkspaceTemplate[] = [];
	const seen = new Set<string>();

	for (const file of io.listFiles("Templates")) {
		if (file.extension !== "md") continue;

		try {
			const parsed = parseTemplateMarkdown(await io.read(file));
			const id = parsed.meta.id;

			if (builtinIds.has(id)) {
				onWarn(
					`Vertex Flow: "${file.name}" shares its id "${id}" with a built-in template — using the built-in.`,
				);
				continue;
			}
			if (seen.has(id)) continue;
			seen.add(id);

			out.push({
				...parsed.meta,
				workspace: parsed.workspaceOverrides,
				mePersonId: parsed.mePersonId,
				buildExampleContent: (buildCtx) =>
					resolveTemplateContent(parsed, buildCtx),
			});
		} catch (error) {
			const described =
				error instanceof TemplateParseError
					? ((error.file = file.path), error.describe())
					: `${file.path} — ${error instanceof Error ? error.message : String(error)}`;
			onWarn(`Vertex Flow: skipped template — ${described}`);
		}
	}

	return out;
}
