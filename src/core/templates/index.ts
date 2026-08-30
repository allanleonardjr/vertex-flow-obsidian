/**
 * Workspace template registry.
 *
 * The gallery only shows markdown templates (`templates/*.md`, inlined into
 * `generated.ts` at build time and parsed here) — the older TypeScript-authored
 * form is no longer a first-class registry citizen. `WorkspaceTemplate` stays
 * the single interface either way, so a template moving from `.ts` to `.md` is
 * invisible to everything downstream of this file; that's what makes the
 * gallery cutover here safe to do ahead of actually converting the remaining
 * files.
 *
 * The five remaining TS-authored templates (`software-sprint`,
 * `feedback-roadmap`, `sales-pipeline`, `content-pipeline`, `freelance`,
 * `personal-admin`) still exist as source files and are still directly
 * importable — `software-sprint.ts` in particular backs `sampleSnapshot()`,
 * which most of the unit suite's fixtures build on. They're just not
 * surfaced here until each is converted to the markdown format; do that
 * conversion as its own follow-up, one file at a time, not by re-adding them
 * to this list wholesale.
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
	return Object.values(TEMPLATE_SOURCES).map((source) => {
		const parsed = parseTemplateMarkdown(source);
		return {
			...parsed.meta,
			// The taxonomy applies whether or not example content is included, so
			// it rides on the template itself rather than only on the content.
			workspace: parsed.workspaceOverrides,
			buildExampleContent: (ctx) => resolveTemplateContent(parsed, ctx),
		};
	});
}

const MARKDOWN_TEMPLATES = markdownTemplates();

/** "Getting Started" leads the gallery — it's the plainest option, and there is
 *  no separate blank path. */
function galleryOrder(templates: WorkspaceTemplate[]): WorkspaceTemplate[] {
	const first = templates.filter((t) => t.id === "getting-started");
	const rest = templates.filter((t) => t.id !== "getting-started");
	return [...first, ...rest];
}

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = galleryOrder(
	MARKDOWN_TEMPLATES,
);

export function templateById(id: string): WorkspaceTemplate | undefined {
	return WORKSPACE_TEMPLATES.find((template) => template.id === id);
}
