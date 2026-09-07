/**
 * Workspace template registry.
 *
 * The gallery is built entirely from markdown templates (`templates/*.md`,
 * inlined into `generated.ts` at build time and parsed here). The older
 * TypeScript-authored form was removed when the last of it was converted;
 * `WorkspaceTemplate` stays the single interface either way, so a future
 * template can be authored in either form without disturbing anything
 * downstream of this file.
 *
 * Parsing happens once, at module load. That's deliberate: a template that
 * doesn't parse is an authoring bug, and failing loudly the first time the
 * plugin runs beats failing later, halfway through creating someone's
 * workspace. `resolveTemplateContent` — the half that needs a clock and a
 * workspace root — is deferred into `buildExampleContent`, exactly like a TS
 * template's own builder.
 */

import { TEMPLATE_SOURCES } from "./generated";
import { parseTemplateMarkdown } from "./markdown/parse";
import { resolveTemplateContent } from "./markdown/resolve";
import type { WorkspaceTemplate } from "./types";

export * from "./types";
export * from "./instantiate";

function markdownTemplates(): WorkspaceTemplate[] {
	return Object.values(TEMPLATE_SOURCES).map((source: string) => {
		const parsed = parseTemplateMarkdown(source);
		return {
			...parsed.meta,
			// The taxonomy applies whether or not example content is included, so
			// it rides on the template itself rather than only on the content.
			workspace: parsed.workspaceOverrides,
			mePersonId: parsed.mePersonId,
			buildExampleContent: (ctx) => resolveTemplateContent(parsed, ctx),
		};
	});
}

const MARKDOWN_TEMPLATES = markdownTemplates();

/** "Blank workspace" leads the gallery — it's the plainest starting point and
 *  the one a self-directed user wants. "Getting Started" sits right after it:
 *  the more guided pre-populated entry. */
function galleryOrder(templates: WorkspaceTemplate[]): WorkspaceTemplate[] {
	const blank = templates.filter((t) => t.id === "blank-workspace");
	const gettingStarted = templates.filter((t) => t.id === "getting-started");
	const rest = templates.filter(
		(t) => t.id !== "blank-workspace" && t.id !== "getting-started",
	);
	return [...blank, ...gettingStarted, ...rest];
}

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = galleryOrder(
	MARKDOWN_TEMPLATES,
);

export function templateById(id: string): WorkspaceTemplate | undefined {
	return WORKSPACE_TEMPLATES.find((template) => template.id === id);
}
