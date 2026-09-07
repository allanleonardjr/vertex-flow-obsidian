/**
 * Recurring tasks — the pure engine. Nothing here imports the Obsidian API.
 *
 * The Obsidian glue layer (`src/obsidian/mutations.ts`) calls this the engine
 * for inspection, and `reconcilePlans` drives the one post-rebuild reconcile
 * pass that actually spawns notes. UI surfaces (Repeat editor, Series popover,
 * Overview modal) build on `describeRecurrence`, `chainMembers` and
 * `recurringOverview`.
 */

export * from "./engine";
export * from "./chain";
export * from "./spawn";
export * from "./describe";
export * from "./overview";
export * from "./project";