/**
 * View and Dashboard draft keyboard shortcuts (`Alt+S`, `Alt+Shift+S`, `Alt+R`).
 *
 * Intercepts `Alt`/`Option` modifier chords for saving, cloning, or resetting
 * active draft state across Views, Dashboards, Projects, and System views:
 *   - Option/Alt + S        -> Save draft (when `dirty` and `canSave !== false`)
 *   - Option/Alt + Shift + S -> Save As (opens prompt to clone view or dashboard)
 *   - Option/Alt + R        -> Reset / discard unsaved changes
 *
 * Uses physical key codes (`event.code === "KeyS"` / `"KeyR"`) to prevent macOS
 * `Option` key character mutations (e.g. `ß`, `®`) from breaking key lookups.
 * Stashes options in a ref for a stable capture-phase window listener, and
 * guards against firing while focused inside text fields or content-editable elements.
 */
import { useEffect, useRef } from "react";
import { Notice } from "obsidian";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(
    el?.isContentEditable ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement,
  );
}

export interface DraftShortcutOptions {
  dirty: boolean;
  canSave?: boolean;
  onSave?: () => void | Promise<void>;
  onSaveAs?: () => void;
  onReset?: () => void;
}

/**
 * Draft keyboard shortcuts matching the Option/Alt modifier space:
 *   - Option/Alt + S        -> Save
 *   - Option/Alt + Shift + S -> Save As
 *   - Option/Alt + R        -> Reset / Discard changes
 */
export function useDraftShortcuts(opts: DraftShortcutOptions): void {
  // Stash options in a ref so listener identity is stable and avoids effect re-binding on state churn
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Require Alt/Option; ignore Cmd/Ctrl
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (isTypingTarget(event.target)) return;

      // Match event.code ("KeyS", "KeyR") to bypass macOS Option character mutation
      if (event.code === "KeyS") {
        if (event.shiftKey) {
          // Option/Alt + Shift + S -> Save As
          if (optsRef.current.onSaveAs) {
            event.preventDefault();
            event.stopPropagation();
            optsRef.current.onSaveAs();
          }
          return;
        }

        // Option/Alt + S -> Save
        if (
          optsRef.current.dirty &&
          optsRef.current.canSave !== false &&
          optsRef.current.onSave
        ) {
          event.preventDefault();
          event.stopPropagation();
          void optsRef.current.onSave();
          new Notice("Saved changes");
        }
        return;
      }

      if (event.code === "KeyR" && !event.shiftKey) {
        // Option/Alt + R -> Reset / Discard
        if (optsRef.current.dirty && optsRef.current.onReset) {
          event.preventDefault();
          event.stopPropagation();
          optsRef.current.onReset();
          new Notice("Discarded unsaved changes");
        }
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
