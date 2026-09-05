import { COLOR_PALETTE } from "./color";

/**
 * Deterministic accent color for a workspace, derived from its `root` path.
 * No state, no config — same root always yields the same palette color for
 * the life of this hash function. Two workspaces may legitimately collide
 * on the same color; callers should not assume uniqueness.
 */
export function workspaceAccentColor(root: string): string {
  let hash = 0;
  for (let i = 0; i < root.length; i++) {
    hash = (hash << 5) - hash + root.charCodeAt(i);
    hash |= 0; // force 32-bit int
  }
  const index = Math.abs(hash) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
}
