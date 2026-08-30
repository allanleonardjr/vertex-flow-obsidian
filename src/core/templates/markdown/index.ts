/**
 * The markdown template format: a pure parse step and a pure resolve step.
 *
 * Split in two on purpose. Parsing is expensive and clock-independent, so it
 * happens once per template at module load; resolution needs a
 * `TemplateBuildContext` (workspace root, id prefix, "now") and therefore runs
 * again on every instantiation.
 */

export * from "./types";
export { parseTemplateMarkdown, TEMPLATE_SCHEMA_VERSION } from "./parse";
export { resolveTemplateContent } from "./resolve";
