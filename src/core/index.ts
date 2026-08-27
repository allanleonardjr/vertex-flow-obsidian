/**
 * Pure domain logic. Nothing here may import the Obsidian API (Golden Rule) —
 * that constraint is what keeps this layer unit-testable in isolation, and it
 * covers the majority of what makes the plugin correct.
 */

export * from "./types";
export * from "./links";
export * from "./ids";
export * from "./ranking";
export * from "./taxonomy";
export * from "./hierarchy";
export * from "./views";
export * from "./serialization";
