/**
 * Vault-root folder where workspace templates live.
 *
 * This is where "Export Workspace as Template" defaults and the New Workspace
 * gallery looks for user-authored templates. `Templates/` remains a legacy
 * discovery target so templates exported before this folder existed (or written
 * by hand there) keep showing up — but the canonical one is `Vertex Flow
 * Templates/`.
 */
export const WORKSPACE_TEMPLATES_FOLDER = "Vertex Flow Templates";

/** Legacy location still discovered, never the export default. */
export const LEGACY_WORKSPACE_TEMPLATES_FOLDER = "Templates";