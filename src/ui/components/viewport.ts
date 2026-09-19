/**
 * The visible viewport area, accounting for the mobile on-screen keyboard.
 *
 * `window.innerWidth`/`innerHeight` reflect the *layout* viewport, which the
 * keyboard does not resize (per the CSS spec) — `window.visualViewport` is
 * the one API that shrinks when the keyboard opens. Portaled menus that clamp
 * or flip against `window.innerHeight` size themselves as if the keyboard
 * weren't there; they need these numbers instead.
 */
export function getVisibleViewport(): { width: number; height: number } {
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

/**
 * Subscribes to everything that can change the visible viewport: `window`'s
 * own `resize`/`scroll` (desktop, pane resizing) plus `visualViewport`'s
 * `resize`/`scroll` (mobile keyboard open/close). iOS only reliably fires the
 * latter — it pans/resizes the visual viewport without firing `window`
 * `resize` — so both pairs are needed. Returns a single cleanup that removes
 * all four listeners.
 */
export function subscribeToViewportChanges(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  window.addEventListener("scroll", onChange, true);
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("scroll", onChange, true);
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
  };
}
