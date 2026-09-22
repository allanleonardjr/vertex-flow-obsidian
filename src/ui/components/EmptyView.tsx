/**
 * The shared empty state for a view that has nothing to show — a List/Board
 * with no matching tasks, or a Dashboard that no longer exists.
 *
 * Deliberately small: an icon, a one-line title, an optional note (a hint), an
 * optional "New task" button for the cases where creating one is the obvious
 * next move, an optional extra `action` button (e.g. "Clear filters"), and an
 * optional link-style `secondaryAction` beneath it. Callers decide which of
 * those apply.
 */

import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyView({
  icon,
  iconFallback,
  title,
  note,
  onNewTask,
  action,
  secondaryAction,
  className,
}: {
  icon?: string;
  iconFallback: string;
  title: string;
  note?: ReactNode;
  onNewTask?: () => void;
  /** An extra call-to-action, rendered as a button like "New task". */
  action?: { label: string; onClick: () => void };
  /** A quieter, link-style alternative to `action` (e.g. "Cancel", "Open Settings"). */
  secondaryAction?: { label: string; onClick: () => void };
  /** Extra class on the root, for a caller that needs to scope CSS (e.g. an animation) to its own usage without touching every other empty state. */
  className?: string;
}) {
  return (
    <div className={`vf-app-background vf-view-empty${className ? ` ${className}` : ""}`}>
      <span className="vf-view-empty-icon" aria-hidden>
        <Icon id={icon} fallback={iconFallback} size={33} />
      </span>
      <p className="vf-view-empty-title">{title}</p>
      {note != null && <p className="vf-empty-note">{note}</p>}
      {onNewTask && (
        <button
          type="button"
          className="vf-empty-cta mod-cta"
          onClick={onNewTask}
        >
          New task
        </button>
      )}
      {action && (
        <button
          type="button"
          className="vf-empty-cta mod-cta"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
      {secondaryAction && (
        <button
          type="button"
          className="vf-link-button"
          onClick={secondaryAction.onClick}
        >
          {secondaryAction.label}
        </button>
      )}
    </div>
  );
}
