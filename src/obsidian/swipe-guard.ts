import { Platform, type App, type Plugin } from "obsidian";

/**
 * Obsidian detects single-finger horizontal swipes anywhere in the app
 * itself, in its own JavaScript, and fires
 * `workspace.trigger("swipe", { direction, points, targetEl, ... })`, which
 * something else listens to in order to open/close the side panels. This
 * runs independently of the browser's native touch handling, so CSS
 * `touch-action` has no effect on it at all — dragging Vertex Flow's own
 * interactive surfaces (Canvas's pan/zoom, any resize handle) triggers this
 * same event, sliding Obsidian's side panels into view mid-drag.
 *
 * Wraps `Workspace.prototype.trigger` and swallows only that specific case
 * — a one-finger horizontal swipe whose target is inside one of Vertex
 * Flow's own interactive elements — letting every other swipe through
 * completely untouched.
 */
const OWN_INTERACTIVE_SELECTOR =
  ".vf-canvas, .vf-canvas-zoom-slider, .vf-sidebar-resize, .vf-help-resize, .vf-resize-handle";

interface SwipeEventData {
  direction?: string;
  points?: number;
  targetEl?: unknown;
}

function isOwnHorizontalSwipe(eventName: string, data: unknown): boolean {
  if (eventName !== "swipe") return false;
  const d = data as SwipeEventData;
  return (
    d?.direction === "x" &&
    d?.points === 1 &&
    d.targetEl instanceof HTMLElement &&
    d.targetEl.closest(OWN_INTERACTIVE_SELECTOR) !== null
  );
}

export function installSwipeGuard(app: App, plugin: Plugin): void {
  if (!Platform.isMobile) return;

  const proto = Object.getPrototypeOf(app.workspace) as {
    trigger: (eventName: string, data?: unknown, ...rest: unknown[]) => unknown;
  };
  const original = proto.trigger;

  const wrapped = function (
    this: unknown,
    eventName: string,
    data?: unknown,
    ...rest: unknown[]
  ) {
    if (isOwnHorizontalSwipe(eventName, data)) return undefined;
    return original.apply(this, [eventName, data, ...rest]);
  };

  proto.trigger = wrapped;

  plugin.register(() => {
    if (proto.trigger === wrapped) proto.trigger = original;
  });
}
