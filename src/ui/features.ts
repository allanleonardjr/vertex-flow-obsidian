/**
 * V1 scope gates.
 *
 * V1 ships with Workspace → Project → Task only. Initiatives and Cycles are
 * built end to end — serialization, core hierarchy, mutations, browse screens,
 * the sample generator — but deliberately not surfaced in the UI yet. Because
 * the hierarchy lives in frontmatter links (CLAUDE.md Golden Rules), turning
 * either back on is a display concern, never a migration: flip the flag here
 * and every entry point below reappears.
 *
 * Kept as a build-time constant rather than a workspace setting on purpose —
 * exposing a toggle is itself surfacing the feature, which is what v1 is
 * choosing not to do.
 */
export const FEATURES = {
	/** Initiatives browse screen, sidebar nav, and Parent-picker options. */
	initiatives: false,
	/** Cycles nav, the per-task Cycle field, and the Cycles settings section. */
	cycles: false,
} as const;
